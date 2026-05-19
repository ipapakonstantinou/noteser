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

import { get, set, del } from 'idb-keyval'

const PREFIX = 'noteser-attachment:'
export const ATTACHMENT_DIR = 'attachments'

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
  return path.startsWith(`${ATTACHMENT_DIR}/`)
}

// Save a blob under a unique, timestamped path. Sub-second collisions append a
// counter to the stem so the path stays unique even when two drops fire in the
// same wall-clock second.
export async function saveAttachment(
  blob: Blob,
  originalName: string,
  now: Date = new Date(),
): Promise<string> {
  const safeName = sanitizeAttachmentName(originalName)
  const ts = timestamp(now)
  let path = `${ATTACHMENT_DIR}/${ts}-${safeName}`
  let counter = 1
  while ((await get(PREFIX + path)) !== undefined) {
    const dotIdx = safeName.lastIndexOf('.')
    const stem = dotIdx === -1 ? safeName : safeName.slice(0, dotIdx)
    const ext = dotIdx === -1 ? '' : safeName.slice(dotIdx)
    path = `${ATTACHMENT_DIR}/${ts}-${stem}-${counter}${ext}`
    counter++
  }
  const record: StoredAttachment = {
    blob,
    mime: blob.type || 'application/octet-stream',
    originalName,
    createdAt: Date.now(),
  }
  await set(PREFIX + path, record)
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
}

// Test-only: drop the in-memory URL cache without touching IDB. Tests that
// stub idb-keyval need a way to reset state between cases.
export function _clearAttachmentUrlCache(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}
