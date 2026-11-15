import { isValidCollabId } from './collabId'

// Feature A — share-session links for live collaboration.
//
// A share link encodes the note's stable collab room id (its `collabId`, an
// unguessable UUID) plus an optional human-readable title into the URL
// FRAGMENT, which the browser never sends to a server (like /share):
//
//   https://<origin>/#collab=<collabId>&title=<url-encoded title>
//
// Links minted before 2026-11-15 carry the same pair in the query string
// (`/?collab=…&title=…`); parseCollabParam still accepts those.
//
// Anyone who opens the link joins the SAME y-websocket room and can edit the
// note live. No shared GitHub repo is required — the room id IS the credential.
// Because the id is a v4 UUID it is not enumerable; the link grants edit access
// to that one room and leaks nothing else.

export interface CollabParam {
  collabId: string
  // The optional note title carried in the link, so a fresh joiner can seed a
  // sensible title before the CRDT content arrives. Null when absent/blank.
  title: string | null
}

// Build the shareable URL. `origin` is normally `window.location.origin`
// (e.g. "https://noteser.app"); passed in so the helper stays pure + testable.
// A trailing slash on the origin is tolerated. The title is omitted entirely
// when blank so we never emit a dangling `&title=`.
export function buildCollabShareLink(
  origin: string,
  collabId: string,
  title?: string | null,
): string {
  const base = origin.replace(/\/+$/, '')
  const params = new URLSearchParams()
  params.set('collab', collabId)
  if (title && title.trim() !== '') params.set('title', title)
  return `${base}/#${params.toString()}`
}

// Parse `#collab=…&title=…` (location.hash) or the legacy `?collab=…`
// (location.search). Returns null when no `collab` param is present, so the
// caller can cheaply short-circuit on a normal load.
export function parseCollabParam(hashOrSearch: string): CollabParam | null {
  const params = new URLSearchParams(hashOrSearch.replace(/^#/, ''))
  const collabId = params.get('collab')
  // A link is an explicit user action, but it is still someone else's string.
  if (!isValidCollabId(collabId)) return null
  const title = params.get('title')
  return { collabId, title: title && title.trim() !== '' ? title : null }
}

// Vercel Analytics reports the full location.href, fragment included. Drop
// the fragment (collab room ids, /share content) and the query params that
// carried the same secrets in older links (collab/title, the /share import).
export function scrubShareSecrets(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    for (const key of ['collab', 'title', 'import']) u.searchParams.delete(key)
    return u.toString()
  } catch {
    return url
  }
}
