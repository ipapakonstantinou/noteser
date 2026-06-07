// Pure helpers extracted from pluginHostSingleton.ts so they can be
// unit-tested in isolation. The singleton wires these into the live
// host; this file owns the walking + filtering logic that survives
// without a window / Zustand stores / toast adapter.
//
// See docs/plugins-v1.2-plan.md section 4.3 and
// docs/plugins-v1.2-impl-notes.md PR E.

import { MAX_DIRECTORY_ENTRIES } from './protocol'

/** Minimal typing of the File System Access API directory handle shape
 *  we touch. The full DOM lib's `FileSystemDirectoryHandle` is not in
 *  every TS lib build (it landed in 2023), so we keep a local interface
 *  the walker accepts. The shape matches the spec subset we read. */
export interface FileSystemDirectoryHandleLike {
  kind: 'directory'
  name: string
  values(): AsyncIterable<FileSystemHandleLike>
}
export type FileSystemHandleLike =
  | FileSystemDirectoryHandleLike
  | { kind: 'file'; name: string; getFile(): Promise<File> }

/** Build a case-insensitive suffix matcher from the optional
 *  `extensions` arg the plugin passed. Leading dots are normalised.
 *  An empty / missing list matches every file. */
export function buildExtensionMatcher(
  extensions: string[] | undefined,
): (name: string) => boolean {
  if (!extensions || extensions.length === 0) return () => true
  const norm = extensions.map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase())
  return (name: string) => {
    const lower = name.toLowerCase()
    for (const e of norm) {
      if (lower.endsWith(e)) return true
    }
    return false
  }
}

/** Recursively walk a `FileSystemDirectoryHandle`, returning every
 *  file under it. Iterative DFS to avoid blowing the call stack on a
 *  deep vault. Stops walking once the cap is crossed so a 1M-file
 *  pick does not block the main thread for minutes — the caller turns
 *  the over-cap return into a "Directory too large" error.
 *
 *  Symlink loops cannot recurse: the File System Access API does not
 *  follow symlinks by spec. We also de-dupe on handle identity as a
 *  defensive belt-and-braces (a future spec change cannot quietly
 *  re-enable infinite recursion). */
export async function walkDirectoryHandle(
  root: FileSystemDirectoryHandleLike,
  matcher: (name: string) => boolean,
): Promise<Array<{ name: string; path: string; blob: Blob }>> {
  const out: Array<{ name: string; path: string; blob: Blob }> = []
  const visited = new Set<FileSystemDirectoryHandleLike>()
  const stack: Array<{ handle: FileSystemDirectoryHandleLike; prefix: string }> = [
    { handle: root, prefix: '' },
  ]
  while (stack.length > 0) {
    if (out.length > MAX_DIRECTORY_ENTRIES) return out
    const { handle, prefix } = stack.pop() as {
      handle: FileSystemDirectoryHandleLike
      prefix: string
    }
    if (visited.has(handle)) continue
    visited.add(handle)
    for await (const child of handle.values()) {
      if (child.kind === 'directory') {
        stack.push({
          handle: child,
          prefix: prefix ? `${prefix}/${child.name}` : child.name,
        })
        continue
      }
      if (!matcher(child.name)) continue
      const file = await child.getFile()
      out.push({
        name: child.name,
        path: prefix ? `${prefix}/${child.name}` : child.name,
        blob: file as Blob,
      })
      if (out.length > MAX_DIRECTORY_ENTRIES) return out
    }
  }
  return out
}
