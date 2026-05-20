// Last-pushed content cache (109).
//
// To power the editor's gutter diff markers we need to know what the
// user's note looked like at the time of the last successful push.
// We can't reliably re-fetch from GitHub on every edit (network + rate
// limits + offline), so we cache the content client-side. Storage
// trade-off: one extra IDB entry per note, but it lets the gutter
// stay live without any network calls.
//
// Keys are `noteser-lpc-<noteId>`. Stored as plain strings (no
// metadata) — the size match between this and the note's current body
// is what matters; staleness is fine (we'll just paint a few lines as
// modified that aren't, until the next push).

import { get, set, del, keys } from 'idb-keyval'

const PREFIX = 'noteser-lpc-'

function keyFor(noteId: string): string {
  return `${PREFIX}${noteId}`
}

export async function getLastPushedContent(noteId: string): Promise<string | null> {
  const v = await get<string>(keyFor(noteId))
  return v ?? null
}

export async function setLastPushedContent(noteId: string, content: string): Promise<void> {
  await set(keyFor(noteId), content)
}

export async function deleteLastPushedContent(noteId: string): Promise<void> {
  await del(keyFor(noteId))
}

// Drop every cached snapshot — used by the reset / wipe helpers and
// available to a future "Reset gutter diff" admin action.
export async function clearAllLastPushedContent(): Promise<void> {
  const allKeys = await keys()
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith(PREFIX)) await del(k)
  }
}
