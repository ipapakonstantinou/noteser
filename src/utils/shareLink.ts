// Read-only share links — encode a note's title + body into the URL hash
// fragment of a /share page. No backend required: the URL itself IS the
// payload. The hash fragment never leaves the browser, so it's not
// visible in server access logs.
//
// Trade-offs vs. a hosted shortener:
//   + Zero infra. No database. No expiry to manage.
//   + Works offline (recipient gets the bytes the moment the URL loads).
//   - URL length grows linearly with note size. Most browsers tolerate
//     up to ~8KB; very long notes will hit that ceiling.
//   - "Revoke" doesn't exist — anyone with the URL has the content
//     forever. Surface this in the UI.

interface SharePayload {
  v: 1                  // schema version
  title: string
  content: string
  ts: number            // when the link was generated (informational only)
}

// Base64-encode a UTF-8 string. Uses TextEncoder + the standard
// btoa/atob pair (which only handle Latin-1, hence the encode step).
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
    .replace(/\+/g, '-')   // URL-safe base64
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function b64ToUtf8(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64.length % 4) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeShareLink(title: string, content: string, origin?: string): string {
  const payload: SharePayload = { v: 1, title, content, ts: Date.now() }
  const encoded = utf8ToB64(JSON.stringify(payload))
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/share#${encoded}`
}

// Decode the hash fragment into the original payload. Returns null on any
// failure (malformed input, wrong version, partial decode) — caller shows
// a "this link is invalid" message.
export function decodeShareFragment(fragment: string): SharePayload | null {
  if (!fragment) return null
  // Strip a leading `#` if the caller passed location.hash verbatim.
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  try {
    const json = b64ToUtf8(raw)
    const parsed = JSON.parse(json) as SharePayload
    if (parsed.v !== 1) return null
    if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

// Helper for the UI: rough byte length of the encoded URL so we can warn
// the user before they try to send a 50KB blob through Slack.
export function estimateShareLinkSize(title: string, content: string): number {
  const json = JSON.stringify({ v: 1, title, content, ts: 0 })
  // Base64 is ~4/3 the size of the source bytes, plus the prefix.
  return Math.ceil(json.length * 4 / 3) + 32
}
