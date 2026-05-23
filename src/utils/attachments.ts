// IndexedDB-backed attachment store for image drag-and-drop into notes.
//
// Storage layout: every blob lives at the idb-keyval key
// `noteser-attachment:<path>` where <path> is the user-facing reference written
// into the markdown — e.g. `attachments/20260519095612-screenshot.png`. The
// markdown stays portable (a normal relative image link); the binary lives
// browser-side until GitHub binary sync ships.
//
// Object URLs are minted on demand and cached in a module-scoped Map so the
// same path doesn't burn through `URL.createObjectURL` calls on every preview
// re-render. The cache is best-effort: a page reload re-mints URLs.

import { get, set, del, keys } from 'idb-keyval'
import { gitBlobShaBytes } from './github'
import { ATTACHMENTS_CHANGED_EVENT } from './events'
import { useFolderStore } from '@/stores/folderStore'
import { attachmentsFolder } from './systemFolder'
import { STORAGE_KEYS } from './storageKeys'

// Materialise the parent folder of an attachment path as a real Folder
// entity. Without this, attachment files would appear "orphaned" — the
// sidebar tree only renders items belonging to known folders.
function ensureAttachmentParentFolder(path: string): void {
  try {
    const parts = path.split('/')
    parts.pop() // drop the filename
    if (parts.length === 0) return
    useFolderStore.getState().ensureFolderPath(parts)
  } catch {
    // Outside a browser / test environment without the store wired up.
  }
}

// Notify any listening UI (FolderTree, Settings) that the attachment store
// changed. No-op outside a browser environment.
function notifyAttachmentsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ATTACHMENTS_CHANGED_EVENT))
}

// Thin re-exports of the attachments SystemFolder. Kept as standalone
// functions so existing call sites don't have to change; new code can
// also call `attachmentsFolder.get()` etc. directly via `./systemFolder`.

export const DEFAULT_ATTACHMENT_DIR = attachmentsFolder.defaultName
// Back-compat alias — pre-refactor name. Equal to DEFAULT_ATTACHMENT_DIR.
export const ATTACHMENT_DIR = attachmentsFolder.defaultName

export function normalizeAttachmentDir(input: string | undefined | null): string {
  return attachmentsFolder.normalize(input)
}

export function getAttachmentDir(): string {
  return attachmentsFolder.get()
}

export function getAttachmentPrefixes(): string[] {
  return attachmentsFolder.prefixes()
}

const PREFIX = STORAGE_KEYS.attachmentPrefix
// Tombstones: paths the user explicitly deleted locally. The next sync's
// push consumes this list to also remove the file from the remote tree —
// otherwise pull would re-download them every cycle.
const TOMBSTONE_KEY = STORAGE_KEYS.attachmentTombstones

const urlCache = new Map<string, string>()

// Bound an IDB op so a stalled IndexedDB (seen on mobile Safari) degrades
// gracefully instead of wedging the sync. On timeout we resolve to `fallback`
// and warn once. Attachment comparison during pull is best-effort: degrading
// lets notes sync even if IDB stalls. The happy path is untouched — the promise
// resolves normally well before the timeout and the timer is cleared.
const IDB_TIMEOUT_MS = 8_000
let idbTimeoutWarned = false

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      if (!idbTimeoutWarned) {
        idbTimeoutWarned = true
        console.warn(
          `[attachments] IndexedDB op exceeded ${ms}ms — degrading gracefully (sync continues).`,
        )
      }
      resolve(fallback)
    }, ms)
    promise.then(
      value => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        // An IDB rejection is also best-effort: degrade rather than reject.
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

export interface StoredAttachment {
  blob: Blob
  mime: string
  originalName: string
  createdAt: number
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function timestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

// Strip directory components and characters that don't survive on either
// Windows or Unix-ish filesystems. We also collapse runs of whitespace so the
// markdown reference stays readable.
export function sanitizeAttachmentName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  const cleaned = base.replace(/[<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
  return cleaned || 'image'
}

export function isAttachmentPath(path: string): boolean {
  return attachmentsFolder.matchesPath(path)
}

// Save a blob under a unique, timestamped path. Sub-second collisions append a
// counter to the stem so the path stays unique even when two drops fire in the
// same wall-clock second. New saves land under the currently-configured
// attachments folder; old saves remain at their original path.
export async function saveAttachment(
  blob: Blob,
  originalName: string,
  now: Date = new Date(),
): Promise<string> {
  const dir = attachmentsFolder.get()
  const safeName = sanitizeAttachmentName(originalName)
  const ts = timestamp(now)
  let path = `${dir}/${ts}-${safeName}`
  let counter = 1
  while ((await get(PREFIX + path)) !== undefined) {
    const dotIdx = safeName.lastIndexOf('.')
    const stem = dotIdx === -1 ? safeName : safeName.slice(0, dotIdx)
    const ext = dotIdx === -1 ? '' : safeName.slice(dotIdx)
    path = `${dir}/${ts}-${stem}-${counter}${ext}`
    counter++
  }
  const record: StoredAttachment = {
    blob,
    mime: blob.type || 'application/octet-stream',
    originalName,
    createdAt: Date.now(),
  }
  await set(PREFIX + path, record)
  ensureAttachmentParentFolder(path)
  notifyAttachmentsChanged()
  return path
}

export async function getAttachmentBlob(path: string): Promise<Blob | null> {
  const record = await get<StoredAttachment>(PREFIX + path)
  return record?.blob ?? null
}

// Returns a blob: URL for the attachment, or null if the path is unknown.
// Caches the URL so repeated reads (e.g. preview re-renders) reuse the same
// handle. Caller must NOT revoke the returned URL — deleteAttachment handles
// the revocation.
export async function getAttachmentUrl(path: string): Promise<string | null> {
  const cached = urlCache.get(path)
  if (cached) return cached
  const blob = await getAttachmentBlob(path)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(path, url)
  return url
}

export async function deleteAttachment(path: string): Promise<void> {
  await del(PREFIX + path)
  const url = urlCache.get(path)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(path)
  }
  await addAttachmentTombstone(path)
  notifyAttachmentsChanged()
}

// ── Tombstone helpers ────────────────────────────────────────────────────
// Tombstones survive page reloads and apply on the next sync's push so an
// explicit local delete propagates to the remote vault. The sync layer is
// expected to call `clearAttachmentTombstones` once the push has applied
// the deletions — otherwise we'd keep trying to delete the same paths on
// every subsequent sync.

export async function getAttachmentTombstones(): Promise<string[]> {
  const stored = await get<string[]>(TOMBSTONE_KEY)
  return Array.isArray(stored) ? stored.slice() : []
}

export async function addAttachmentTombstone(path: string): Promise<void> {
  const current = await getAttachmentTombstones()
  if (current.includes(path)) return
  current.push(path)
  await set(TOMBSTONE_KEY, current)
}

export async function clearAttachmentTombstones(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const current = await getAttachmentTombstones()
  const remaining = current.filter(p => !paths.includes(p))
  if (remaining.length === current.length) return
  await set(TOMBSTONE_KEY, remaining)
}

// Move an attachment from one path to another inside IDB. Throws if there's
// already an attachment at the target path (callers should disambiguate by
// adjusting the filename). Note references are NOT rewritten here — see
// `rewriteAttachmentRefs` for that, and `moveAttachmentAndRewriteRefs` for
// the full "drag to folder" operation.
export async function moveAttachment(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) return
  const record = await get<StoredAttachment>(PREFIX + oldPath)
  if (!record) throw new Error(`No attachment at ${oldPath}`)
  const existing = await get(PREFIX + newPath)
  if (existing !== undefined) {
    throw new Error(`An attachment already exists at ${newPath}`)
  }
  await set(PREFIX + newPath, record)
  await del(PREFIX + oldPath)
  // Drop the cached URL — the new path will mint its own next read.
  const oldUrl = urlCache.get(oldPath)
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl)
    urlCache.delete(oldPath)
  }
  ensureAttachmentParentFolder(newPath)
  notifyAttachmentsChanged()
}

// Full "drag to folder" operation: rename the IDB key AND rewrite every
// active note's content so `![](old)` → `![](new)`. Critical detail: the
// per-note rewrites are batched into a SINGLE Zustand setState call so
// subscribers (FolderTree, etc.) re-render exactly once. The earlier
// per-note `updateNote` loop caused a render storm that visibly blanked
// the sidebar mid-drag (bug p8j3, regression-tested in
// e2e/attachment-blank.spec.ts).
export async function moveAttachmentAndRewriteRefs(
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return
  await moveAttachment(oldPath, newPath)
  // Dynamic import to avoid a static cycle (attachments.ts ← noteStore.ts
  // imports softDelete + storageKeys but not attachments; static import
  // of noteStore here would create one).
  const { useNoteStore } = await import('@/stores/noteStore')
  const { rewriteAttachmentRefs } = await import('./attachmentRefs')
  const now = Date.now()
  useNoteStore.setState(state => {
    let touched = false
    const nextNotes = state.notes.map(note => {
      if (note.isDeleted) return note
      const next = rewriteAttachmentRefs(note.content, oldPath, newPath)
      if (next === note.content) return note
      touched = true
      return { ...note, content: next, updatedAt: now }
    })
    return touched ? { notes: nextNotes } : state
  })
}

// Test-only: drop the in-memory URL cache without touching IDB. Tests that
// stub idb-keyval need a way to reset state between cases.
export function _clearAttachmentUrlCache(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

// ── Bulk + sync helpers ─────────────────────────────────────────────────────
// These power the Settings panel ("show me everything in the store") and the
// GitHub binary sync flow ("which files changed since the last push?").

// Enumerate every attachment path currently in IDB. Filters by the
// `noteser-attachment:` prefix because idb-keyval shares its database with
// the Zustand persist adapter, so other keys live in the same KV store.
export function listAttachmentPaths(): Promise<string[]> {
  // Bounded so a stalled `keys()` degrades to "no local attachments" (the pull
  // then treats all remote attachments as creates — still correct, just less
  // efficient) instead of hanging the whole sync.
  return withTimeout(listAttachmentPathsUnbounded(), IDB_TIMEOUT_MS, [])
}

async function listAttachmentPathsUnbounded(): Promise<string[]> {
  const allKeys = await keys()
  const out: string[] = []
  for (const k of allKeys) {
    if (typeof k !== 'string') continue
    if (k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length))
  }
  return out.sort()
}

export interface AttachmentMeta {
  path: string
  size: number
  mime: string
  originalName: string
  createdAt: number
}

// Metadata for every attachment in IDB, suitable for the Settings list view.
// Skips the blob itself so we don't pull megabytes into memory just to count.
export async function listAttachmentMeta(): Promise<AttachmentMeta[]> {
  const paths = await listAttachmentPaths()
  const out: AttachmentMeta[] = []
  for (const path of paths) {
    const record = await get<StoredAttachment>(PREFIX + path)
    if (!record) continue
    out.push({
      path,
      size: record.blob.size,
      mime: record.mime,
      originalName: record.originalName,
      createdAt: record.createdAt,
    })
  }
  return out
}

// Compute the git blob SHA for a stored attachment, so the sync layer can
// decide whether to upload it. Returns null if the path is unknown.
export function getAttachmentGitSha(path: string): Promise<string | null> {
  // Bounded so a stalled `get()` / `arrayBuffer()` degrades to null. The caller
  // (pull's attachment comparison) skips the update when the SHA is null, so a
  // stall means "don't re-download" rather than wedging the sync.
  return withTimeout(getAttachmentGitShaUnbounded(path), IDB_TIMEOUT_MS, null)
}

async function getAttachmentGitShaUnbounded(path: string): Promise<string | null> {
  const record = await get<StoredAttachment>(PREFIX + path)
  if (!record) return null
  const bytes = new Uint8Array(await record.blob.arrayBuffer())
  return gitBlobShaBytes(bytes)
}

// Save a blob at a specific path (vs. saveAttachment which mints a fresh
// timestamped path). Used by sync apply when pulling remote attachments —
// the path is dictated by the remote tree, not the wall clock.
export async function putAttachmentAtPath(
  path: string,
  blob: Blob,
  originalName: string = path.split('/').pop() ?? path,
): Promise<void> {
  const record: StoredAttachment = {
    blob,
    mime: blob.type || 'application/octet-stream',
    originalName,
    createdAt: Date.now(),
  }
  await set(PREFIX + path, record)
  // Invalidate the URL cache so the next read mints a fresh blob: URL for
  // the new content (otherwise editors and preview keep showing the old img).
  const oldUrl = urlCache.get(path)
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl)
    urlCache.delete(path)
  }
  ensureAttachmentParentFolder(path)
  notifyAttachmentsChanged()
}
