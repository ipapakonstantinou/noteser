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
- **Origin allow-list** (`src/utils/originAllowlist.ts`) on every proxy
  route: same-origin, `localhost`/`127.0.0.1`, RFC1918 LAN IPs, plus
  exact origins from `NEXT_PUBLIC_EXTRA_ORIGINS`. No wildcard hostnames —
  in particular NOT `*.vercel.app`, which is a shared namespace anyone can
  get a subdomain on. Vercel preview deploys pass as same-origin, since
  the app calls its own `/api/*` with relative URLs.

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
- **A committed `collabId` is a bearer credential in plaintext, and cannot be
  rotated.** `serializeNote` writes `collabId: <uuid>` into the note's
  frontmatter and the pull adopts the remote value ("repo wins", so
  collaborators converge on one room). Consequences, none of them fixed:
  anyone who can read the repo — including anyone the vault is ever shared
  with, a fork, or a later collaborator who should have lost access — holds
  read/write on that room forever; there is no rotation path, because changing
  the id means every device must agree on the new one through the same file;
  and the Durable Object keeps server-side state keyed on the id, so a leaked
  id also names durable server state.
  - Shipped 2026-07-30 (the cheap half): ids are shape-checked as v4 UUIDs at
    every entry point — `parseNote` drops a non-conforming frontmatter value,
    `parseCollabParam` refuses a bogus `?collab=` link, and `serializeNote`
    will not re-publish an invalid id. That stops an arbitrary string becoming
    a room name; it does NOT make the id less of a credential.
  - **Proposal, not implemented** (deliberately out of scope for the
    2026-07-30 branch): stop treating the committed id as the credential. Keep
    the frontmatter id as a room *name* and derive the joining secret from
    material that is never committed — e.g. a per-room key held only in the
    share link fragment (like `/share` already does) with the server
    accepting a proof derived from it, so repo read access alone grants
    nothing. This changes the wire protocol and the collab-server, needs its
    own plan, and should land before real-time collab is ever default-on.
  - Also NOT implemented: requiring an explicit user action before joining a
    room whose id arrived from the repo. In `per-note` mode (and via a share
    link) an explicit action is already required; only `collaborationMode:
    'repo'` auto-joins every note, and telling a repo-supplied id apart from
    one this device minted needs provenance the store does not keep today.
    Given collab is default-off and `'repo'` is an explicit opt-in, this was
    parked rather than half-built.

## Audit log

| Date | Change | Notes |
|---|---|---|
| 2026-07-29 | `isOriginAllowed` no longer trusts the whole `*.vercel.app` namespace — blanket suffix branch removed, exact-match `NEXT_PUBLIC_EXTRA_ORIGINS` is the only non-same-origin path; 2 new rejection tests | shared namespace: a stranger's free subdomain cleared the check. Real grant was on `/api/git-proxy` (echoes the origin in `Access-Control-Allow-Origin`) |
| 2026-07-29 | Status pass over `docs/research/security-audit-2026-05-21.md`: each of the 8 findings re-verified against current code. 1, 4, 5, 6, 8 FIXED; 2 and 3 marked OPEN, ACCEPTED with rationale; 7 OPEN by design. No code changed | doc was reading as a live vuln list against production |
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
