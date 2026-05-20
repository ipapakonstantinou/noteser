# Security review — 2026-05-20

Snapshot audit of the markdown render path, the GitHub OAuth proxy
routes, and the credential-storage model. Tracks: what's exposed, what
the current mitigation is, and what changed in this session.

This is a personal-tool review, not a SOC-2 attestation — the codebase
is single-tenant (one vault per browser), runs the OAuth flow client-
side, and stores tokens in localStorage by design.

## Trust model

- **Single-tenant.** Each browser profile holds its own vault and its
  own credentials. There is no shared backend that holds user state.
- **BYO secrets.** The user pastes their GitHub OAuth token + (optional)
  Anthropic / OpenAI API keys into Settings. These live in
  `localStorage` keyed by store namespace (`noteser-github`, settings
  store keys). Same trust model as the Obsidian Git plugin.
- **Server-side surface = two proxy routes.** `/api/github/device-code`
  and `/api/github/access-token` exist only to CORS-proxy the GitHub
  device-flow endpoints (which don't return the right CORS headers).
  Both are stateless, never see the token *after* it lands in the
  browser, and don't talk to the user's notes.

The threat model is XSS: anything that lets attacker JavaScript run in
a noteser page reads every localStorage key. The mitigations below all
trace back to "make it harder for arbitrary JS to execute."

## Markdown render — XSS surface

Two render paths:

- `src/components/editor/EditorContent.tsx` — the in-app preview.
- `src/app/share/page.tsx` — the public `/share` page that decodes a
  note from a URL fragment. **Higher-risk because the input is
  attacker-controlled** (anyone can craft a malicious /share URL).

Both invoke `<ReactMarkdown remarkPlugins={[remarkGfm]}>`. They do
NOT pass any `rehypePlugins`, in particular no `rehype-raw`. Without
`rehype-raw`, react-markdown 10 treats inline HTML as escaped text:

- `<script>...</script>` in markdown → rendered as visible text, not
  parsed as a script tag.
- `<img onerror=...>` → rendered as visible text.
- `<iframe>` → rendered as visible text.
- `[click](javascript:alert(1))` → href is filtered by react-markdown's
  built-in `defaultUrlTransform`, which rejects `javascript:`,
  `data:text/html`, and similar dangerous schemes.

This is locked in by `src/__tests__/markdownXssGuard.test.tsx`:

1. **No source file imports `rehype-raw`** — a regression would
   silently enable raw HTML and bypass every guarantee here.
2. **No source file uses `dangerouslySetInnerHTML`** anywhere.
3. **No `<ReactMarkdown rehypePlugins={...} />`** call exists; any
   future plugin addition lands as a deliberate test edit.
4. **The /share page goes through react-markdown** — never inlines
   user content via `innerHTML`.

A separate static check (`src/__tests__/wikilinkSafety.test.ts`) pins
the wikilink URL encoder so a note titled `javascript:alert(1)` can't
produce a real `javascript:` href.

## GitHub OAuth proxy — origin guard

`POST /api/github/device-code` and `POST /api/github/access-token`
forward to GitHub's OAuth device-flow endpoints. Both are rate-limited
per IP via `src/utils/rateLimit.ts`. The `access-token` route is the
sensitive one: it returns the OAuth token in the response body to a
poller that knows the device code.

**Risk before this session:** a malicious page could in principle
initiate the device flow with the user's IP, trick the user into
approving the code on github.com, and then race-poll our
`/access-token` route to harvest the resulting token.

**Mitigation added 2026-05-20** (`src/utils/originAllowlist.ts`):

Both routes refuse requests whose Origin / Referer header isn't one of:

- the request's own origin (same-origin)
- `http://localhost:*` and `http://127.0.0.1:*` (dev)
- RFC1918 LAN IPs (`10.x`, `172.16-31.x`, `192.168.x`) — covers
  `next dev -H 0.0.0.0` for second-device testing
- `https://*.vercel.app` (preview deploys)
- anything in `NEXT_PUBLIC_EXTRA_ORIGINS` (comma-sep, opt-in)

Anything else → `403 forbidden`. Locked in by 8 cases in
`src/__tests__/originAllowlist.test.ts`.

## Content-Security-Policy

`next.config.mjs` sends a CSP on every response. As of this session:

```
default-src 'self';
script-src  'self' 'unsafe-inline' 'unsafe-eval';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob: https:;
font-src    'self' data:;
connect-src 'self' https://api.github.com https://github.com
            https://api.anthropic.com https://api.openai.com
            wss: ws:;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

Why each line:

- **`'unsafe-inline' 'unsafe-eval'` on script-src.** Required by
  Next.js's hydration bootstrap + the CodeMirror runtime. Tightening
  to a nonce-based CSP would require a custom Next middleware and a
  nonce-aware CodeMirror init; not blocking, but a real follow-up.
- **`img-src 'self' data: blob: https:`.** Users can paste any
  https://… image URL into a note. Allowing `https:` is broader than
  an explicit allowlist would be, but matches the editor's real use
  case. `data:` + `blob:` for IDB-backed attachments.
- **`connect-src` adds `api.anthropic.com` + `api.openai.com`.** Was
  missing before this session — AI features would have been
  CSP-blocked at runtime once a real CSP-enforcing browser tested
  them. Fixed.
- **`object-src 'none'`** + **`frame-ancestors 'none'`** + **`base-uri
  'self'`** + **`form-action 'self'`** — narrow the lateral-movement
  surface a script-injection would otherwise have.

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(),
interest-cohort=()` cover the rest of the OWASP secure-headers
checklist.

## Vault settings JSON — parse safety

The vault settings file (`.noteser/settings.json`) is fetched on every
pull and parsed by `parseVaultSettings` in `src/utils/vaultSettings.ts`.
The parser:

- Rejects non-objects, wrong-version payloads, missing `updatedAt`
- Whitelists incoming keys against `VAULT_SETTING_KEYS` (the single
  source of truth for which prefs are vault-synced). A malicious peer
  who pushes a settings file with `aiApiKey: "..."` cannot inject the
  key into another user's store — the parser drops it.

Vault `.gitignore` is parsed by `src/utils/gitignore.ts`. Patterns are
compiled to regexes via `compilePattern`; regex metacharacters in the
pattern get escaped before substitution, so a malicious pattern can't
craft a catastrophic-backtracking regex against the local matcher.

## Known limits + follow-ups

- **No nonce-based CSP.** `script-src` still uses `'unsafe-inline'
  'unsafe-eval'` because Next.js and CodeMirror both rely on it.
  Future work: add `next-safe-middleware`-style nonces + drop
  unsafe-inline.
- **Tokens in localStorage.** Any successful XSS reads them. The
  defenses above are layered to prevent XSS, not to mitigate it once
  triggered. Worth re-evaluating if noteser ever becomes multi-tenant
  or hosted-with-shared-state.
- **/share URL fragment carries the full note.** Anyone with the link
  reads it. URL is never sent to a server, but link-preview crawlers
  (Slack / iMessage / Twitter) may decode + cache. `shr2` follow-up
  adds optional expiry + burn-after-read flags.
- **AI calls send user content to a third party.** The user opts in
  per provider and pays per request. We don't store the API key
  outside their browser, but a CSP-blocking proxy provider can still
  log everything they receive. The AI Settings panel surfaces this
  explicitly.
- **Live collaboration (Yjs WS, opt-in).** Disabled by default; if a
  user runs a public Yjs server, anyone who knows the room name can
  read + edit. Out of scope today.
