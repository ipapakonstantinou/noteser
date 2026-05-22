// File-system adapter for isomorphic-git, backed by a FileSystem Access
// API `FileSystemDirectoryHandle`. Lets the in-browser git layer
// operate on the user's picked folder.
//
// Only the subset isomorphic-git actually calls is implemented:
//   readFile, writeFile, unlink, readdir, mkdir, rmdir, stat, lstat,
//   readlink (rejects), symlink (rejects).
//
// All methods accept the `.promises` shape isomorphic-git auto-detects.
// Paths are POSIX-style with leading `/`; we strip the leading slash
// and split on `/` to walk the directory tree.
//
// Symlinks are NOT supported (FSA has no symlink primitives). For
// typical noteser vault use this is fine — git uses symlinks only in
// `.git/objects/pack/` shortcuts and a few esoteric cases we don't
// hit. The adapter throws ENOTSUP if isomorphic-git ever asks.

interface Stat {
  type: 'file' | 'dir' | 'symlink'
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}

function makeStat(kind: 'file' | 'dir', size: number, mtimeMs: number): Stat {
  return {
    type: kind,
    mode: kind === 'dir' ? 0o040755 : 0o100644,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0, gid: 0, dev: 0,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => false,
  }
}

function splitPath(p: string): string[] {
  return p.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
}

class FsError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'FsError'
  }
}

// Walk to the directory containing `filename` in `segments`. Returns
// { parent, name } where parent is the immediate parent directory
// handle and name is the leaf segment.
async function resolveParent(
  root: FileSystemDirectoryHandle,
  segments: string[],
  opts: { create: boolean },
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  if (segments.length === 0) {
    // Caller is asking for the root itself; we return it with empty name.
    return { parent: root, name: '' }
  }
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < segments.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(segments[i], { create: opts.create })
    } catch {
      throw new FsError('ENOENT', `ENOENT: ${segments.slice(0, i + 1).join('/')}`)
    }
  }
  return { parent: dir, name: segments[segments.length - 1] }
}

// Public factory. Returns a `fs` object shaped like isomorphic-git's
// `.promises` interface. The returned reference can be re-used across
// many git operations against the same folder.
export function createFsaFs(root: FileSystemDirectoryHandle) {
  const promises = {
    async readFile(filepath: string, _opts?: { encoding?: string } | string): Promise<Uint8Array | string> {
      const segments = splitPath(filepath)
      const { parent, name } = await resolveParent(root, segments, { create: false })
      let fh: FileSystemFileHandle
      try {
        fh = await parent.getFileHandle(name)
      } catch {
        throw new FsError('ENOENT', `ENOENT: ${filepath}`)
      }
      const file = await fh.getFile()
      const buf = new Uint8Array(await file.arrayBuffer())
      // isomorphic-git passes opts as `{ encoding: 'utf8' }` for text
      // reads (HEAD, config, etc.) and undefined for binary (objects).
      const encoding = typeof _opts === 'string' ? _opts : _opts?.encoding
      if (encoding === 'utf8' || encoding === 'utf-8') {
        return new TextDecoder('utf-8').decode(buf)
      }
      return buf
    },

    async writeFile(filepath: string, data: Uint8Array | string, _opts?: unknown): Promise<void> {
      const segments = splitPath(filepath)
      const { parent, name } = await resolveParent(root, segments, { create: true })
      const fh = await parent.getFileHandle(name, { create: true })
      const writable = await (fh as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
      try {
        // Normalise string → bytes so the on-disk content matches what
        // isomorphic-git expects to read back.
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
        // TS narrows Uint8Array<ArrayBufferLike> in TS 5.7+ which the
        // FileSystemWritableFileStream.write signature rejects. Cast
        // through unknown — at runtime the API accepts any BufferSource.
        await writable.write(bytes as unknown as FileSystemWriteChunkType)
      } finally {
        await writable.close()
      }
    },

    async unlink(filepath: string): Promise<void> {
      const segments = splitPath(filepath)
      const { parent, name } = await resolveParent(root, segments, { create: false })
      try {
        await (parent as unknown as { removeEntry: (n: string) => Promise<void> }).removeEntry(name)
      } catch {
        throw new FsError('ENOENT', `ENOENT: ${filepath}`)
      }
    },

    async readdir(filepath: string): Promise<string[]> {
      const segments = splitPath(filepath)
      let dir: FileSystemDirectoryHandle = root
      for (const seg of segments) {
        try {
          dir = await dir.getDirectoryHandle(seg)
        } catch {
          throw new FsError('ENOENT', `ENOENT: ${filepath}`)
        }
      }
      const out: string[] = []
      const entries = (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()
      for await (const entry of entries) out.push(entry.name)
      return out
    },

    async mkdir(filepath: string): Promise<void> {
      const segments = splitPath(filepath)
      if (segments.length === 0) return
      const { parent, name } = await resolveParent(root, segments, { create: true })
      await parent.getDirectoryHandle(name, { create: true })
    },

    async rmdir(filepath: string): Promise<void> {
      // Pass through to the same removeEntry — recursive false matches
      // node's rmdir semantics (fails on non-empty dirs).
      const segments = splitPath(filepath)
      const { parent, name } = await resolveParent(root, segments, { create: false })
      try {
        await (parent as unknown as { removeEntry: (n: string, opts?: { recursive?: boolean }) => Promise<void> })
          .removeEntry(name)
      } catch {
        throw new FsError('ENOTEMPTY', `ENOTEMPTY: ${filepath}`)
      }
    },

    async stat(filepath: string): Promise<Stat> {
      return inner(filepath, false)
    },

    async lstat(filepath: string): Promise<Stat> {
      return inner(filepath, true)
    },

    async readlink(): Promise<string> {
      throw new FsError('ENOTSUP', 'symlinks not supported on FSA backend')
    },

    async symlink(): Promise<void> {
      throw new FsError('ENOTSUP', 'symlinks not supported on FSA backend')
    },
  }

  // Stat helper. Tries directory first because isomorphic-git often
  // stats `.git` itself before reading any of its files; falling through
  // to file lookup keeps the common-case path short.
  async function inner(filepath: string, _follow: boolean): Promise<Stat> {
    const segments = splitPath(filepath)
    if (segments.length === 0) {
      // Root itself — always a directory.
      return makeStat('dir', 0, 0)
    }
    const { parent, name } = await resolveParent(root, segments, { create: false })
    // Try as directory first.
    try {
      await parent.getDirectoryHandle(name)
      return makeStat('dir', 0, 0)
    } catch {
      /* not a dir, continue */
    }
    // Try as file.
    try {
      const fh = await parent.getFileHandle(name)
      const file = await fh.getFile()
      return makeStat('file', file.size, file.lastModified)
    } catch {
      throw new FsError('ENOENT', `ENOENT: ${filepath}`)
    }
  }

  return { promises }
}

export type FsaFs = ReturnType<typeof createFsaFs>
