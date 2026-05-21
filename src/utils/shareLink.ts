// Read-only share links — encode a note's title + body into the URL hash
// fragment of a /share page. No backend required: the URL itself IS the
// payload. The hash fragment never leaves the browser, so it's not
// visible in server access logs.
//
// Trade-offs vs. a hosted shortener:
//   + Zero infra. No database. No expiry to manage server-side.
//   + Works offline (recipient gets the bytes the moment the URL loads).
//   - URL length grows linearly with note size. Most browsers tolerate
//     up to ~8KB; very long notes will hit that ceiling.
//   - "Revoke" doesn't exist — anyone with the URL has the content
//     forever. v2 adds optional client-enforced expiry + burn-after-
//     read to soften that, but those are HONOR-SYSTEM checks the
//     recipient's browser performs; a determined attacker who modifies
//     the local clock or decodes the URL by hand can still read.
//     Surface that nuance in the UI.

export interface SharePayload {
  v: 1 | 2              // schema version
  title: string
  content: string
  ts: number            // when the link was generated (informational only)
  expiresAt?: number    // v2: absolute ms epoch; link invalid past this
  burn?: boolean        // v2: recipient browser marks consumed on first view
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

export interface EncodeOpts {
  // Days until the link expires. 0 / undefined = no expiry. The
  // expiresAt timestamp is baked into the payload; the recipient's
  // /share page refuses to render past it.
  expiryDays?: number
  // Mark the link burn-after-read. First successful decode on the
  // recipient browser flips a localStorage flag (keyed on a hash of
  // the payload) so a re-visit shows "this link was burned."
  burn?: boolean
}

export function encodeShareLink(
  title: string,
  content: string,
  optsOrOrigin?: EncodeOpts | string,
  originArg?: string,
): string {
  // Back-compat with the older 3-arg form: encodeShareLink(title, content, origin?).
  let opts: EncodeOpts = {}
  let origin: string | undefined = originArg
  if (typeof optsOrOrigin === 'string') {
    origin = optsOrOrigin
  } else if (optsOrOrigin) {
    opts = optsOrOrigin
  }

  const now = Date.now()
  const payload: SharePayload = {
    v: 2,
    title,
    content,
    ts: now,
  }
  if (opts.expiryDays && opts.expiryDays > 0) {
    payload.expiresAt = now + opts.expiryDays * 24 * 60 * 60 * 1000
  }
  if (opts.burn) payload.burn = true

  const encoded = utf8ToB64(JSON.stringify(payload))
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/share#${encoded}`
}

// Decode the hash fragment into the original payload. Returns null on any
// failure (malformed input, wrong version, partial decode) — caller shows
// a "this link is invalid" message. Accepts both v1 and v2 payloads; the
// returned object always has a `.v` so callers can branch if needed.
export function decodeShareFragment(fragment: string): SharePayload | null {
  if (!fragment) return null
  // Strip a leading `#` if the caller passed location.hash verbatim.
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  try {
    const json = b64ToUtf8(raw)
    const parsed = JSON.parse(json) as SharePayload
    if (parsed.v !== 1 && parsed.v !== 2) return null
    if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

// Derive the per-link "this has been burned" localStorage key from a
// SHA-256 digest of the fragment, truncated to 128 bits (16 bytes) and
// base64url-encoded. 128 bits is well past the collision horizon for
// any realistic number of share links — vs. the old FNV-1a 32-bit,
// which has a ~1-in-4-billion pairwise collision rate. We don't store
// the full fragment as a key because it can be many KB (the whole note
// is encoded in there).
export async function shareLinkBurnKey(fragment: string): Promise<string> {
  // crypto.subtle is available in any secure context (https or
  // localhost) and in Node 20+ (which is what Jest's jsdom env runs
  // on). If we're somehow without it, fall back to the raw fragment
  // prefix — different fragments still produce different keys, just
  // without the privacy property of hashing the URL.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return `noteser-share-burned-${fragment.slice(0, 64)}`
  }
  const bytes = new TextEncoder().encode(fragment)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  // First 16 bytes (128 bits) is plenty; encode as URL-safe base64
  // without padding to keep the localStorage key short.
  const truncated = new Uint8Array(digest).slice(0, 16)
  let bin = ''
  for (const b of truncated) bin += String.fromCharCode(b)
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `noteser-share-burned-${b64}`
}

// Has the recipient's browser already consumed this link? Used to
// honor the burn flag across page reloads. Server has no view of
// this — it's all in localStorage of the device that opened it.
export async function isShareLinkBurned(fragment: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const key = await shareLinkBurnKey(fragment)
    return window.localStorage.getItem(key) !== null
  } catch { return false }
}

export async function markShareLinkBurned(fragment: string): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const key = await shareLinkBurnKey(fragment)
    window.localStorage.setItem(key, String(Date.now()))
  } catch { /* quota */ }
}

// Has the link expired? Returns true only when expiresAt is set AND
// in the past. Payloads without expiresAt (v1 or v2 with no expiry)
// never expire.
export function isShareLinkExpired(payload: SharePayload, now = Date.now()): boolean {
  return typeof payload.expiresAt === 'number' && payload.expiresAt > 0 && now > payload.expiresAt
}

// Helper for the UI: rough byte length of the encoded URL so we can warn
// the user before they try to send a 50KB blob through Slack.
export function estimateShareLinkSize(title: string, content: string): number {
  const json = JSON.stringify({ v: 2, title, content, ts: 0, expiresAt: 0, burn: false })
  // Base64 is ~4/3 the size of the source bytes, plus the prefix.
  return Math.ceil(json.length * 4 / 3) + 32
}
