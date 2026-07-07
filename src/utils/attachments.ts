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
import { useSettingsStore } from '@/stores/settingsStore'
import { attachmentsFolder } from './systemFolder'
import { STORAGE_KEYS } from './storageKeys'
import {
  DEFAULT_ATTACHMENT_FILENAME_PATTERN,
  resolveAttachmentFilename,
} from './attachmentFilename'

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

// ── Synchronous known-path index ────────────────────────────────────────────
// The IDB store is async, but the rendered/live preview resolves embeds
// synchronously. We keep an in-memory mirror of every stored attachment path
// so callers can map a bare Obsidian filename (`![[Pasted image …png]]`) to
// the actual stored path (`Files/Pasted image …png`) without awaiting IDB.
//
// It is best-effort: seeded by listAttachmentPaths/listAttachmentMeta (which
// FolderTree runs on mount + on every ATTACHMENTS_CHANGED_EVENT) and kept in
// sync by the save/put/move/delete mutators below. A bare filename may map to
// more than one stored path (same name in two folders); we keep the set and
// resolve to the first match — collisions are rare and the alternative
// (showing nothing) is worse.
const knownPaths = new Set<string>()

function indexPath(path: string): void {
  knownPaths.add(path)
}

function unindexPath(path: string): void {
  knownPaths.delete(path)
}

// Replace the whole index from an authoritative path list (a full IDB scan).
function reindexPaths(paths: Iterable<string>): void {
  knownPaths.clear()
  for (const p of paths) knownPaths.add(p)
}

// The basename (final path segment) of an attachment path, lower-cased for
// case-insensitive matching — Obsidian itself matches filenames loosely.
function basenameKey(pathOrName: string): string {
  const base = pathOrName.split('/').pop() ?? pathOrName
  return base.toLowerCase()
}

// Every stored attachment path currently known (sync). Best-effort mirror of
// IDB — may be empty until the first listAttachmentPaths/Meta call seeds it.
export function getKnownAttachmentPaths(): string[] {
  return [...knownPaths]
}

// True iff `path` is an exact, currently-known stored attachment path. Unlike
// isAttachmentPath (which matches the configured attachments FOLDER prefix),
// this recognises a blob stored under any folder — e.g. Obsidian's `Files/`
// — as long as the index has been seeded. Used by the image renderer so a
// `Files/foo.png` embed still resolves to its IDB blob.
export function isKnownAttachmentPath(path: string): boolean {
  return knownPaths.has(path)
}

// Resolve a bare attachment name (or path) to a stored attachment path by
// matching on basename. Returns null when nothing matches. If the input is
// already a known full path it is returned as-is. Exact-path matches win over
// basename matches.
export function resolveAttachmentPath(nameOrPath: string): string | null {
  if (!nameOrPath) return null
  if (knownPaths.has(nameOrPath)) return nameOrPath
  const wantKey = basenameKey(nameOrPath)
  for (const p of knownPaths) {
    if (basenameKey(p) === wantKey) return p
  }
  return null
}

// Bound an IDB op so a stalled IndexedDB (seen on mobile Safari) degrades
// gracefully instead of wedging the sync. On timeout we resolve to `fallback`
// and warn once. Attachment comparison during pull is best-effort: degrading
// lets notes sync even if IDB stalls. The happy path is untouched — the promise
// resolves normally well before the timeout and the timer is cleared.
const IDB_TIMEOUT_MS = 8_000
let idbTimeoutWarned = false

// Tracked variant: same degrade-to-fallback behaviour, but also reports
// WHETHER the fallback fired. The push path needs this — "timed out, unknown
// local state" and "genuinely resolved to an empty/false/null value" must not
// be conflated into the same push decision (see listAttachmentPathsTracked
// and friends below).
function withTimeoutTracked<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  return new Promise(resolve => {
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
      resolve({ value: fallback, timedOut: true })
    }, ms)
    promise.then(
      value => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ value, timedOut: false })
      },
      () => {
        // An IDB rejection is also best-effort: degrade rather than reject.
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ value: fallback, timedOut: true })
      },
    )
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return withTimeoutTracked(promise, ms, fallback).then(r => r.value)
}

export interface StoredAttachment {
  blob: Blob
  mime: string
  originalName: string
  createdAt: number
  // do-not-sync (#179): an app-local attachment that must NEVER be pushed to
  // the user's vault repo (e.g. the seeded feature-tour demo screenshots).
  // The push path skips flagged records entirely — no blob upload, no tree
  // entry. `undefined` means "syncs normally" (back-compat for all records
  // stored before this field existed).
  doNotSync?: boolean
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

// Save a blob under a filename generated from the configured attachment
// filename pattern (#124) — see utils/attachmentFilename.ts for the token
// grammar and collision policy. New saves land under the currently-configured
// attachments folder; old saves remain at their original path.
export async function saveAttachment(
  blob: Blob,
  originalName: string,
  now: Date = new Date(),
  noteTitle: string = '',
): Promise<string> {
  const dir = attachmentsFolder.get()
  const pattern = useSettingsStore.getState().attachmentFilenamePattern
    || DEFAULT_ATTACHMENT_FILENAME_PATTERN
  const filename = await resolveAttachmentFilename(
    pattern,
    { now, noteTitle, originalName },
    async (name) => (await get(PREFIX + `${dir}/${name}`)) !== undefined,
  )
  const path = `${dir}/${filename}`
  const record: StoredAttachment = {
    blob,
    mime: blob.type || 'application/octet-stream',
    originalName,
    createdAt: Date.now(),
  }
  await set(PREFIX + path, record)
  indexPath(path)
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
  unindexPath(path)
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
  unindexPath(oldPath)
  indexPath(newPath)
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
  knownPaths.clear()
}

// Wipe EVERY attachment in IDB plus the tombstone list and the in-memory URL
// cache. Used by the fresh-clone repo switch (switchVault) so no binary from
// the previous vault leaks into the new repo — attachments are stored under a
// GLOBAL prefix, not per-repo, so a plain notes/folders reset would leave the
// old files behind (the "Files (165)" ghost folder + sync timeouts).
//
// Resilient by design: an IndexedDB stall or rejection must NOT block the
// switch. We swallow errors (best-effort) so the caller can proceed to
// re-clone — a leftover blob is far less bad than a wedged switch.
export async function clearAllAttachments(): Promise<void> {
  try {
    const allKeys = await keys()
    for (const k of allKeys) {
      if (typeof k !== 'string') continue
      if (k.startsWith(PREFIX)) {
        await del(k)
      }
    }
    knownPaths.clear()
    await del(TOMBSTONE_KEY)
  } catch (err) {
    console.warn('[attachments] clearAllAttachments failed (continuing):', err)
  } finally {
    // Always drop the in-memory URL cache: even if the IDB wipe partly
    // failed, the stale blob: URLs point at the old vault's content.
    _clearAttachmentUrlCache()
  }
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

// PUSH-only variant: a timeout here must NOT be read as "zero local
// attachments" (the push would then silently upload nothing and look
// successful). syncPush uses `timedOut` to abort the whole attachment
// section for this cycle instead of trusting the `[]` fallback.
export function listAttachmentPathsTracked(): Promise<{ value: string[]; timedOut: boolean }> {
  return withTimeoutTracked(listAttachmentPathsUnbounded(), IDB_TIMEOUT_MS, [])
}

async function listAttachmentPathsUnbounded(): Promise<string[]> {
  const allKeys = await keys()
  const out: string[] = []
  for (const k of allKeys) {
    if (typeof k !== 'string') continue
    if (k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length))
  }
  // Seed the synchronous index from this authoritative scan so embed/orphan
  // resolution can map bare filenames to stored paths without awaiting IDB.
  reindexPaths(out)
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

// do-not-sync (#179): read a stored attachment's doNotSync flag. The push
// path calls this per local attachment to skip flagged records before any
// hashing/upload work. Bounded like the other sync-time readers — a stalled
// IDB degrades to `false`, which is safe because the subsequent
// getAttachmentGitSha read for the same path degrades to null and the push
// loop skips the file anyway.
export function getAttachmentDoNotSync(path: string): Promise<boolean> {
  return withTimeout(
    get<StoredAttachment>(PREFIX + path).then(record => record?.doNotSync === true),
    IDB_TIMEOUT_MS,
    false,
  )
}

// PUSH-only variant — see listAttachmentPathsTracked for why the push path
// needs to distinguish "genuinely false" from "timed out".
export function getAttachmentDoNotSyncTracked(
  path: string,
): Promise<{ value: boolean; timedOut: boolean }> {
  return withTimeoutTracked(
    get<StoredAttachment>(PREFIX + path).then(record => record?.doNotSync === true),
    IDB_TIMEOUT_MS,
    false,
  )
}

// do-not-sync (#179): set/clear the doNotSync flag on an EXISTING stored
// attachment. No-op when the path is unknown or the flag already matches.
// Used by the feature-tour seeder's healing pass and the one-time boot
// migration that retro-flags legacy tour screenshots.
export async function setAttachmentDoNotSync(path: string, value: boolean): Promise<void> {
  const record = await get<StoredAttachment>(PREFIX + path)
  if (!record) return
  if ((record.doNotSync === true) === value) return
  const next: StoredAttachment = { ...record }
  if (value) next.doNotSync = true
  else delete next.doNotSync
  await set(PREFIX + path, next)
}

// Compute the git blob SHA for a stored attachment, so the sync layer can
// decide whether to upload it. Returns null if the path is unknown.
export function getAttachmentGitSha(path: string): Promise<string | null> {
  // Bounded so a stalled `get()` / `arrayBuffer()` degrades to null. The caller
  // (pull's attachment comparison) skips the update when the SHA is null, so a
  // stall means "don't re-download" rather than wedging the sync.
  return withTimeout(getAttachmentGitShaUnbounded(path), IDB_TIMEOUT_MS, null)
}

// PUSH-only variant — see listAttachmentPathsTracked for why the push path
// needs to distinguish "genuinely null" from "timed out".
export function getAttachmentGitShaTracked(
  path: string,
): Promise<{ value: string | null; timedOut: boolean }> {
  return withTimeoutTracked(getAttachmentGitShaUnbounded(path), IDB_TIMEOUT_MS, null)
}

async function getAttachmentGitShaUnbounded(path: string): Promise<string | null> {
  const record = await get<StoredAttachment>(PREFIX + path)
  if (!record) return null
  const bytes = new Uint8Array(await record.blob.arrayBuffer())
  return gitBlobShaBytes(bytes)
}

// Save a blob at a specific path (vs. saveAttachment which mints a fresh
// timestamped path). Used by sync apply when pulling remote attachments —
// the path is dictated by the remote tree, not the wall clock — and by the
// feature-tour seeder (which passes `doNotSync: true` so demo screenshots
// never push to the user's real vault repo, #179).
export async function putAttachmentAtPath(
  path: string,
  blob: Blob,
  originalName: string = path.split('/').pop() ?? path,
  options?: { doNotSync?: boolean },
): Promise<void> {
  // Preserve an existing record's doNotSync flag on overwrite (sync apply
  // re-writes a drifted attachment through this path and must not silently
  // strip the flag) unless the caller states it explicitly.
  const existing = await get<StoredAttachment>(PREFIX + path)
  const doNotSync = options?.doNotSync ?? existing?.doNotSync
  const record: StoredAttachment = {
    blob,
    mime: blob.type || 'application/octet-stream',
    originalName,
    createdAt: Date.now(),
    ...(doNotSync ? { doNotSync: true } : {}),
  }
  await set(PREFIX + path, record)
  indexPath(path)
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
