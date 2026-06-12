// Feature A — share-session links for live collaboration.
//
// A share link encodes the note's stable collab room id (its `collabId`, an
// unguessable UUID) plus an optional human-readable title into a normal URL:
//
//   https://<origin>/?collab=<collabId>&title=<url-encoded title>
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
  return `${base}/?${params.toString()}`
}

// Parse a `?collab=…&title=…` query string (e.g. `window.location.search`).
// Returns null when no `collab` param is present, so the caller can cheaply
// short-circuit on a normal load.
export function parseCollabParam(search: string): CollabParam | null {
  const params = new URLSearchParams(search)
  const collabId = params.get('collab')
  if (!collabId) return null
  const title = params.get('title')
  return { collabId, title: title && title.trim() !== '' ? title : null }
}
