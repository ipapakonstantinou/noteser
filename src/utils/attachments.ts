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
import { useSettingsStore } from '@/stores/settingsStore'
import { useFolderStore } from '@/stores/folderStore'

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

// Historical attachments folder. Always recognised in path-prefix checks
// (back-compat: old notes reference `attachments/foo.png` and must keep
// resolving even after the user picks a new folder).
export const DEFAULT_ATTACHMENT_DIR = 'attachments'

// Sanitise user input from the Settings folder field. Strips slashes that
// would create accidental root paths, collapses repeated separators, trims
// whitespace, and falls back to the default when the result is empty.
export function normalizeAttachmentDir(input: string | undefined | null): string {
  if (!input) return DEFAULT_ATTACHMENT_DIR
  const trimmed = input
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/')
  return trimmed || DEFAULT_ATTACHMENT_DIR
}

// Folder currently used for NEW attachments. Reads the latest setting at
// call time so changes apply immediately without re-mounting consumers.
// Wrapped in try/catch so non-browser test environments without the store
// initialised fall back to the default rather than throw.
export function getAttachmentDir(): string {
  try {
    return normalizeAttachmentDir(useSettingsStore.getState().attachmentsFolder)
  } catch {
    return DEFAULT_ATTACHMENT_DIR
  }
}

// Path prefixes a file could have to be considered an attachment. Always
// includes the historical default so old refs keep working; adds the
// currently configured folder when it differs.
export function getAttachmentPrefixes(): string[] {
  const current = getAttachmentDir()
  if (current === DEFAULT_ATTACHMENT_DIR) return [`${DEFAULT_ATTACHMENT_DIR}/`]
  return [`${current}/`, `${DEFAULT_ATTACHMENT_DIR}/`]
}

// Back-compat alias — older imports still pull this name. New code should
// call getAttachmentDir() since the value can change at runtime.
export const ATTACHMENT_DIR = DEFAULT_ATTACHMENT_DIR

const PREFIX = 'noteser-attachment:'
// Tombstones: paths the user explicitly deleted locally. The next sync's
// push consumes this list to also remove the file from the remote tree —
// otherwise pull would re-download them every cycle.
const TOMBSTONE_KEY = 'noteser-attachment-tombstones'

const urlCache = new Map<string, string>()

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
  return getAttachmentPrefixes().some(prefix => path.startsWith(prefix))
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
  const dir = getAttachmentDir()
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
export async function listAttachmentPaths(): Promise<string[]> {
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
export async function getAttachmentGitSha(path: string): Promise<string | null> {
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
