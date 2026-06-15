// Host-side snapshot of the vault, packaged for the `vault.read.all`
// capability. The plugin Worker has no access to `useNoteStore` /
// IndexedDB / the DOM; this module sits on the main thread and turns
// the Zustand store into a plain-object array the host can post to the
// worker bridge.
//
// Performance contract (docs/plugins-v1.2-plan.md §4.1 + perf #79):
//   - The first call walks every non-deleted note and parses its
//     frontmatter. On a 5000-note vault that is the dominant cost; the
//     work is chunked over `requestIdleCallback` slices in the stream
//     path so the main thread is never blocked for >50ms.
//   - We cache the assembled array keyed by a vault snapshot SHA. A
//     second `getAllNotes()` call within the same SHA returns the
//     cached array instantly. The SHA is a cheap rolling hash of the
//     `(id, updatedAt)` pairs of every note + every folder — not a
//     cryptographic digest, just an identity key.
//
// What this module does NOT do:
//   - It does not post any messages itself. PluginHost handles the
//     protocol; this module hands it a plain array.
//   - It does not honour the `vault.read.all` permission gate — that
//     check lives in PluginHost, before this module is reached.

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { parseFrontmatter } from '@/utils/frontmatter'
import { yieldToMain } from '@/utils/bootTrace'
import type { Note, Folder } from '@/types'
import type { NoteWithBodyWire } from './protocol'

/** Max projected serialised payload for `getAllNotes()` before the
 *  host forces the plugin to use `stream()`. Two orders of magnitude
 *  more than `MAX_ENVELOPE_BYTES` is intentional — `getAllNotes` is
 *  meant for small vaults and dev plugins; the stream path is for the
 *  general case. */
export const MAX_GET_ALL_BYTES = 4 * 1024 * 1024 // 4 MiB

/** Cached snapshot, keyed by the vault SHA. */
let cached: { sha: string; notes: ReadonlyArray<NoteWithBodyWire> } | null = null

/** Identity-cached folder-path map. Recomputed when the folders array
 *  identity changes (Zustand replaces it on every mutation). */
let folderPathCache: { folders: ReadonlyArray<Folder>; byId: Map<string, string> } | null = null

/**
 * Build a cheap identity hash from the live store's `(id, updatedAt)`
 * pairs plus folder ids. NOT cryptographic — only used to detect
 * whether the cached snapshot is still valid.
 */
export function computeVaultSha(): string {
  const notes = useNoteStore.getState().notes
  const folders = useFolderStore.getState().folders
  // FNV-1a 32-bit. Fast, deterministic, plenty for cache-key duty.
  let h = 0x811c9dc5
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = (h + ((h << 1) | 0) + ((h << 4) | 0) + ((h << 7) | 0) + ((h << 8) | 0) + ((h << 24) | 0)) | 0
    }
  }
  mix(`n:${notes.length}`)
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (n.isDeleted) continue
    mix(`${n.id}|${n.updatedAt}|`)
  }
  mix(`f:${folders.length}`)
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i]
    mix(`${f.id}|${f.parentId ?? '_'}|${f.name}|`)
  }
  // Force unsigned, hex-encode.
  return ((h >>> 0) >>> 0).toString(16)
}

/** Reset the cache. Tests + the host invalidate this on permission
 *  revocation so a follow-up call rebuilds against the live store. */
export function resetVaultSnapshotCacheForTests(): void {
  cached = null
  folderPathCache = null
}

/**
 * Synchronously snapshot the entire (non-deleted) vault into wire
 * objects. Cheap when the cache is warm (single SHA compare); ~tens of
 * ms on a 5000-note cold call because frontmatter parsing dominates.
 *
 * For large vaults the caller should prefer the streaming path so the
 * main thread is never blocked for >50ms — `streamVaultSnapshot`
 * cooperatively yields between chunks.
 */
export function snapshotAllNotes(): ReadonlyArray<NoteWithBodyWire> {
  const sha = computeVaultSha()
  if (cached && cached.sha === sha) return cached.notes

  const notes = useNoteStore.getState().notes
  const folders = useFolderStore.getState().folders
  const byId = getFolderPathMap(folders)
  const out: NoteWithBodyWire[] = []
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (n.isDeleted) continue
    out.push(noteToWire(n, byId))
  }
  cached = { sha, notes: out }
  return out
}

/**
 * Stream the vault in chunks. Each chunk is `chunkSize` notes (the
 * plan's section 4.1 caps this at 500; the SDK defaults to 100). The
 * caller awaits `onChunk` between pages, so a slow consumer (the
 * worker bridge under back-pressure) throttles the iterator naturally.
 *
 * The iterator yields to the main thread between every chunk via
 * `queueMicrotask`. A 5000-note vault with chunkSize=100 yields 50
 * times during the walk, each chunk costing well under 50ms. The cap
 * lives in `MAX_STREAM_CHUNK_SIZE`; values above it are clamped.
 */
export const MIN_STREAM_CHUNK_SIZE = 1
export const DEFAULT_STREAM_CHUNK_SIZE = 100
export const MAX_STREAM_CHUNK_SIZE = 500

export async function streamVaultSnapshot(
  opts: {
    chunkSize?: number
    /** Called once per chunk. Resolve before the next chunk emits. */
    onChunk: (notes: ReadonlyArray<NoteWithBodyWire>, chunkIndex: number) => void | Promise<void>
    /** Called once with `0` after the last non-empty chunk. */
    onEnd?: () => void | Promise<void>
    /** Polled before each chunk. Returning true aborts mid-stream and
     *  invokes `onAbort(reason)` instead of `onEnd`. Used by the host
     *  to terminate the iterator on permission revocation. */
    isAborted?: () => string | null
    onAbort?: (reason: string) => void | Promise<void>
  },
): Promise<void> {
  const requested = opts.chunkSize ?? DEFAULT_STREAM_CHUNK_SIZE
  const chunkSize = Math.max(
    MIN_STREAM_CHUNK_SIZE,
    Math.min(MAX_STREAM_CHUNK_SIZE, Math.floor(requested) || DEFAULT_STREAM_CHUNK_SIZE),
  )

  // Take a snapshot of the notes array UP FRONT. Walking the live
  // Zustand array while it mutates would yield stale duplicates or
  // skip entries; the cached snapshot is also handed to `getAllNotes`
  // callers so both paths see the same world.
  const all = snapshotAllNotes()
  let chunkIndex = 0
  for (let i = 0; i < all.length; i += chunkSize) {
    const reason = opts.isAborted?.() ?? null
    if (reason !== null) {
      await opts.onAbort?.(reason)
      return
    }
    chunkIndex++
    const slice = all.slice(i, i + chunkSize)
    await opts.onChunk(slice, chunkIndex)
    // Cooperative yield to a MACROTASK boundary so the host main thread
    // can repaint between chunks. queueMicrotask is NOT enough — the
    // microtask queue drains before any rendering, so the whole loop
    // would run as one blocking task. yieldToMain uses scheduler.postTask
    // (or a 0ms timeout) — a real macrotask yield.
    await yieldToMain()
  }
  await opts.onEnd?.()
}

/**
 * Build a single note's wire object. Used by the `getNote(id)` path on
 * the host. Returns null when the id is unknown or the note is
 * soft-deleted.
 */
export function snapshotNoteById(id: string): NoteWithBodyWire | null {
  const note = useNoteStore.getState().notes.find((n) => n.id === id)
  if (!note || note.isDeleted) return null
  const folders = useFolderStore.getState().folders
  return noteToWire(note, getFolderPathMap(folders))
}

/** Convert one in-memory Note into the wire shape. Frontmatter parses
 *  to a plain object so the worker never sees raw YAML. */
function noteToWire(note: Note, folderPathById: Map<string, string>): NoteWithBodyWire {
  const folderPath = note.folderId !== null ? folderPathById.get(note.folderId) ?? '' : ''
  const { hasFrontmatter, fields, body } = parseFrontmatter(note.content ?? '')
  const frontmatter: Record<string, unknown> | null = hasFrontmatter
    ? fieldsToFrontmatter(fields)
    : null
  return {
    id: note.id,
    title: note.title ?? 'Untitled',
    folderPath,
    body: hasFrontmatter ? body : (note.content ?? ''),
    frontmatter,
    updatedAt: note.updatedAt,
  }
}

function fieldsToFrontmatter(
  fields: ReadonlyArray<{ key: string; value: unknown; isUnknown: boolean }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.isUnknown) continue
    if (!f.key) continue
    // Last-write-wins for repeated keys, matching what the rest of the
    // app does on serialise.
    out[f.key] = f.value
  }
  return out
}

function getFolderPathMap(folders: ReadonlyArray<Folder>): Map<string, string> {
  if (folderPathCache && folderPathCache.folders === folders) return folderPathCache.byId
  const byId = new Map<string, string>()
  const ix = new Map(folders.map((f) => [f.id, f] as const))
  for (const f of folders) {
    const parts: string[] = []
    let cur: string | null = f.id
    // Guard against pathological cycles in the persisted store.
    let hops = 0
    while (cur && hops++ < 256) {
      const cf = ix.get(cur)
      if (!cf) break
      parts.unshift(cf.name)
      cur = cf.parentId
    }
    byId.set(f.id, parts.join('/'))
  }
  folderPathCache = { folders, byId }
  return byId
}

/**
 * Project the serialised payload size of an array of notes. Used to
 * decide whether `getAllNotes()` should reject with "use stream()".
 * JSON.stringify is the same encoding postMessage's structured clone
 * costs at the upper bound, and the value is bounded by the cache so
 * we only pay it on first call per SHA.
 */
export function projectPayloadSize(notes: ReadonlyArray<NoteWithBodyWire>): number {
  try {
    return JSON.stringify(notes).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
