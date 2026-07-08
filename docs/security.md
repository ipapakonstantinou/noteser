# Security model + audit notes

Reference for the threat model + what's been hardened. Updated alongside
each release that touches an attack surface.

## Threat model

Noteser is a **personal vault tool**, not a multi-tenant SaaS. The threat
model reflects that:

- A single user controls their own browser + their own GitHub repo.
- Content rendered in the editor is content the user wrote, or content
  the user pulled from their own GitHub.
- `/share` URLs are a deliberate exception: the content there can come
  from anyone. We treat it as untrusted (read-only render, no execution).

**Out of scope:**
- Multi-user collaboration security beyond opt-in Yjs.
- Server-side compromise of a noteser-hosted instance.
- Compromise of the user's GitHub account itself.

## Hardening already in place

### Network + transport

- **Content-Security-Policy** in `next.config.mjs` — explicit
  `default-src 'self'`, allowlisted image sources, `frame-ancestors 'none'`.
- **`X-Frame-Options: DENY`** + `X-Content-Type-Options: nosniff` +
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **`Permissions-Policy`** disables camera, microphone, geolocation, and
  the third-party-cookie federation experiment.
- **`/api/github/*` proxy routes** rate-limited per-IP via
  `src/utils/rateLimit.ts`.

### Token storage

- GitHub OAuth token + AI API key live in `localStorage`. Documented as
  the same trust model the Obsidian Git plugin uses.
- A successful XSS would exfiltrate either. Mitigation: keep the editor
  rendering path tight (see "Rendering" below).
- The `/share` payload is in the URL fragment only — fragments never
  reach the server, so hosting providers don't see shared content.

### Rendering

- **ReactMarkdown** (with `remarkGfm`) — no `rehype-raw`, so raw HTML in
  notes does NOT execute. JavaScript URLs in `[text](url)` are filtered
  by ReactMarkdown's default urlTransform.
- **Custom code blocks** (`TaskQueryBlock`, `BasesBlock`,
  `AttachmentImage`) only consume data from the local note store. No
  remote fetches from arbitrary URLs.
- **Wikilink hrefs** are routed through `WikilinkAnchor`, which only
  handles `wikilink://...` (custom scheme). External hrefs render as
  plain anchors with `rel="noopener noreferrer"`.
- **Frontmatter parser** is a subset YAML parser — no `eval`, no script
  execution paths.

### Sync correctness

- `gitBlobSha` requires `crypto.subtle` (secure context). Loud error
  message when missing instead of silent fallback to a broken sync —
  prevents the "I thought it synced but it didn't" footgun.
- Three-way merge uses `gitLastPushedSha` as the ancestor. Conflicts
  surface as merge tabs the user resolves explicitly — no silent
  overwrites.

### Recovery

- `?reset=1` URL flag wipes local state cleanly.
- `PERSISTED_RESET_VERSION` kill-switch lets us force a one-time wipe
  on the next user visit when we ship a fix that needs a clean slate.

## Known limitations (NOT fixed)

- **No revocation for `/share` URLs.** Anyone with the URL has the
  content forever. Surfaced in the UI footer of the /share page.
- **AI API key in localStorage.** Same XSS exposure as the GitHub token.
  Acceptable for a personal tool; not for a hosted SaaS.
- **Yjs collaboration token has no real auth.** The optional `AUTH_TOKEN`
  ships inline in the client bundle (`NEXT_PUBLIC_YJS_WS_URL`) — it is
  structurally public, not a secret, so it gates nothing an attacker
  couldn't read out of the page source. The room UUID is the real
  credential: anyone who knows a room's id on the configured Yjs server
  can read/write that room's CRDT. The default is no server
  (collaboration disabled), so this only bites users who explicitly set
  `NEXT_PUBLIC_YJS_WS_URL` AND share a room id. `collab-server/` now caps
  message size, connections per room, and messages per second (2026-07-06)
  to bound DoS/storage-bloat from a client that *does* have a room id, but
  none of that is confidentiality — treat a room id like a `/share` link.

## Audit log

| Date | Change | Notes |
|---|---|---|
| 2026-07-06 | collab-server: size/rate/connection-cap limits + first test suite; `/share` img-src drops the `https:` wildcard; `.github/dependabot.yml` added (covers root + collab-server); collab-server wired into CI | 2026-07-06 deep security review |
| 2026-05-20 | Initial security audit doc written | sh3d |
| 2026-05-20 | `crypto.subtle` secure-context check + clear error | (LAN-over-HTTP regression) |
| 2026-05-20 | `PERSISTED_RESET_VERSION` kill-switch + `?reset=1` | recovery for sync drift |
| 2026-05-19 | CSP + rate-limited proxy routes | initial hardening |
| 2026-05-19 | Yjs default URL removed (was public wss://demos.yjs.dev) | Anyone could read/write |

## Things to do if/when we go multi-tenant

1. Move the GitHub OAuth token off `localStorage` into a server-side
   session.
2. Add per-user storage isolation in `useNoteStore` (today: one global
   bucket per browser).
3. Audit the `/api/github/*` proxy for any path-traversal in the
   zipball route (currently passes the user's owner/name through).
4. Server-side input validation on every API route — the client is
   currently the trust boundary.
