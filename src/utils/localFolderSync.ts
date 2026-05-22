// File System Access API wrapper for the "local folder" sync mode.
//
// Lets the user pick a directory on disk; noteser mirrors notes ↔ .md
// files in that directory. Chromium-only — Firefox + Safari don't ship
// `window.showDirectoryPicker()` yet. Callers should guard on
// `isLocalFolderSupported()` before exposing UI.
//
// The directory handle is persisted in IDB (handles are structured-
// cloneable). On re-load the app retrieves the handle but the browser
// re-prompts for permission on the first interaction in each session.
// This is the Chromium security model — there's no way to silently
// re-grant.
//
// v1 scope:
//   - List all `.md` files in the folder (one level deep + nested
//     directories).
//   - Read + write file contents.
//   - No external-file-watching — the API has no built-in fs.watch
//     equivalent. The UI surfaces a "Sync from folder" button users
//     can hit after editing files outside the app.
//   - Mutual exclusion with GitHub sync is enforced at the UI layer,
//     not here.

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'

const HANDLE_KEY = 'noteser:local-folder-handle'

export function isLocalFolderSupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

// Prompt the user to pick a folder. Returns the handle or throws on
// cancel / unsupported environment.
export async function pickLocalFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isLocalFolderSupported()) {
    throw new Error('This browser does not support the File System Access API.')
  }
  // The type is loose so we don't need to ship the DOM types for
  // FileSystemAccess just for the picker signature.
  const showDirectoryPicker = (window as unknown as {
    showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker
  return showDirectoryPicker({ mode: 'readwrite' })
}

// Persist the picked handle so it survives page refresh. Handles are
// structured-cloneable; IDB stores them as opaque values that the
// browser re-hydrates with permission still gated.
export async function saveLocalFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(HANDLE_KEY, handle)
}

export async function loadLocalFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY)
  return handle ?? null
}

export async function clearLocalFolderHandle(): Promise<void> {
  await idbDel(HANDLE_KEY)
}

// Re-ask permission for a stored handle. Returns true when the user
// grants (or it was already granted), false when denied. Always call
// before any read/write — the browser raises if permission isn't
// current.
export async function ensureFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // Cast through unknown — DOM types lag the spec for queryPermission /
  // requestPermission. Pattern matches the Chrome docs.
  const h = handle as unknown as {
    queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  }
  const opts = { mode: 'readwrite' as const }
  const current = await h.queryPermission(opts)
  if (current === 'granted') return true
  const next = await h.requestPermission(opts)
  return next === 'granted'
}

export interface LocalFolderEntry {
  // Path within the picked folder, e.g. "Daily/2026-05-22.md".
  path: string
  // The handle of the containing directory — useful when we need to
  // write back to it without re-walking the tree from the root.
  parentHandle: FileSystemDirectoryHandle
  // The filename (last segment of `path`).
  name: string
  // The file handle for read/write operations.
  fileHandle: FileSystemFileHandle
}

// Recursively walk the folder, yielding every `.md` file. Skips
// hidden directories (anything starting with `.`) so we don't slurp
// in `.git/` or `.noteser/` system folders.
export async function listMarkdownFiles(root: FileSystemDirectoryHandle): Promise<LocalFolderEntry[]> {
  const out: LocalFolderEntry[] = []
  await walk(root, '', out)
  return out
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: LocalFolderEntry[],
): Promise<void> {
  // values() is async-iterable — Chromium-supported even though the
  // DOM types may be missing the iterator.
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemHandle>
  }).values()
  for await (const handle of entries) {
    if (handle.name.startsWith('.')) continue
    const subPath = prefix ? `${prefix}/${handle.name}` : handle.name
    if (handle.kind === 'directory') {
      await walk(handle as FileSystemDirectoryHandle, subPath, out)
    } else if (handle.kind === 'file' && handle.name.toLowerCase().endsWith('.md')) {
      out.push({
        path: subPath,
        parentHandle: dir,
        name: handle.name,
        fileHandle: handle as FileSystemFileHandle,
      })
    }
  }
}

// Read a file by relative path. Throws if the file doesn't exist or
// the path traverses outside the picked root.
export async function readFile(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const handle = await resolveFileHandle(root, path, { create: false })
  if (!handle) throw new Error(`Local folder: file not found at ${path}`)
  const file = await handle.getFile()
  return file.text()
}

// Write a file by relative path. Creates intermediate directories.
// Overwrites existing content.
export async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const handle = await resolveFileHandle(root, path, { create: true })
  if (!handle) throw new Error(`Local folder: could not create file at ${path}`)
  const writable = await (handle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
  await writable.write(content)
  await writable.close()
}

// Delete a file by relative path. No-op if the file doesn't exist.
export async function deleteFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return
  let dir = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    try {
      dir = await dir.getDirectoryHandle(seg)
    } catch {
      return // intermediate dir missing → file doesn't exist
    }
  }
  const filename = segments[segments.length - 1]
  try {
    await (dir as unknown as { removeEntry: (name: string) => Promise<void> }).removeEntry(filename)
  } catch {
    // Either the file didn't exist (fine) or the API rejected the
    // delete (rare in our model — we always create writable handles).
  }
}

// ── high-level sync operations ───────────────────────────────────────────────

import type { Note } from '@/types'
import { parseNote } from '@/utils/githubSync'
import { bodyWithInlineTags } from '@/utils/syncApply'

export interface FolderSyncCounts {
  written: number    // notes written to disk
  removed: number    // local files deleted because the local note is gone
  unchanged: number  // notes whose disk content already matched
}

// Mirror the current noteStore state to the folder: write each
// non-deleted note's content as a `.md` file at its `gitPath` (falls
// back to `<title>.md` at the root for unsynced notes). Files in the
// folder that don't correspond to any local note are LEFT ALONE —
// pushing to a folder doesn't claim ownership of foreign content.
export async function pushNotesToFolder(
  root: FileSystemDirectoryHandle,
  notes: ReadonlyArray<Note>,
): Promise<FolderSyncCounts> {
  let written = 0
  let unchanged = 0
  for (const n of notes) {
    if (n.isDeleted) continue
    const path = noteToPath(n)
    let existing: string | null = null
    try { existing = await readFile(root, path) } catch { /* missing is fine */ }
    if (existing === n.content) {
      unchanged += 1
      continue
    }
    await writeFile(root, path, n.content)
    written += 1
  }
  return { written, removed: 0, unchanged }
}

export interface ImportedNote {
  // Pre-existing local note id if the path matches one (matched on
  // gitPath). Otherwise null — caller treats as a fresh import.
  matchedNoteId: string | null
  path: string
  title: string
  content: string
}

// Read every `.md` file in the folder, parse frontmatter into inline
// tags (same pipeline the GitHub pull uses), and return the result
// for the caller to merge into the noteStore. Doesn't mutate state
// itself — that's the caller's job, since it owns the conflict /
// merge semantics.
export async function importFolderNotes(
  root: FileSystemDirectoryHandle,
  existingNotes: ReadonlyArray<Note>,
): Promise<ImportedNote[]> {
  const byPath = new Map<string, Note>()
  for (const n of existingNotes) {
    if (n.gitPath) byPath.set(n.gitPath, n)
  }
  const files = await listMarkdownFiles(root)
  const out: ImportedNote[] = []
  for (const f of files) {
    const raw = await (await f.fileHandle.getFile()).text()
    const parsed = parseNote(raw)
    const content = bodyWithInlineTags(parsed.body, parsed.tags)
    const matched = byPath.get(f.path) ?? null
    const title = f.path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled'
    out.push({
      matchedNoteId: matched?.id ?? null,
      path: f.path,
      title,
      content,
    })
  }
  return out
}

// Pick the on-disk path for a note. Prefer the gitPath when present
// (so notes synced from GitHub keep the same filesystem layout);
// fall back to a sanitised title at the root.
function noteToPath(n: Note): string {
  if (n.gitPath) return n.gitPath
  const safe = (n.title || 'Untitled').replace(/[\/\\:*?"<>|]+/g, '-').trim() || 'Untitled'
  return `${safe}.md`
}

// Internal — walk to the parent directory, creating it on the way if
// `create` is true. Returns the file handle for read/write.
async function resolveFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  opts: { create: boolean },
): Promise<FileSystemFileHandle | null> {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return null
  let dir = root
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    try {
      dir = await dir.getDirectoryHandle(seg, { create: opts.create })
    } catch {
      return null
    }
  }
  const filename = segments[segments.length - 1]
  try {
    return await dir.getFileHandle(filename, { create: opts.create })
  } catch {
    return null
  }
}
