# Security audit — 2026-05-21

## Executive summary

The app's XSS defences on the in-app preview and `/share` page are strong: no `rehype-raw`, no `dangerouslySetInnerHTML`, locked wikilink hrefs, and static guard tests that would catch regressions. One high-severity gap exists in the HTML export-to-ZIP path — raw note content is interpolated directly into an HTML template without escaping, so a crafted note produces a self-contained XSS payload in the exported file. The CSP is well-structured but `script-src 'unsafe-inline' 'unsafe-eval'` means it cannot stop script injection if one were ever reached in-app; all weight falls on the render-layer controls, which currently hold.

## Status (verified against the code on 2026-07-29)

This document is an audit snapshot from 2026-05-21, not a list of live vulnerabilities. Five of
the eight findings have since been fixed; the table below was produced by re-reading the current
code for each one, and the technical detail underneath is kept verbatim so the reasoning stays
auditable.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | XSS in ZIP HTML export | high | **FIXED** — `escapeHTML` at `src/utils/export.ts:274`, locked by `src/__tests__/exportXssGuard.test.ts` |
| 2 | GitHub OAuth token in localStorage with full `repo` scope | medium | **OPEN, ACCEPTED** — scope allow-list added, `repo` still the default |
| 3 | In-memory rate limiter resets on cold start | medium | **OPEN, ACCEPTED** — throughput concern only |
| 4 | `X-Forwarded-For` caller-controlled | medium | **FIXED** — `TRUSTED_PROXY_COUNT` in `src/utils/rateLimit.ts` |
| 5 | `connect-src wss: ws:` wildcard | medium | **FIXED** — ws origin derived and scoped in `src/utils/csp.ts` |
| 6 | `script-src 'unsafe-inline' 'unsafe-eval'` | low | **FIXED** — nonce + `strict-dynamic` (`src/utils/csp.ts`, `src/middleware.ts`), locked by `src/__tests__/cspHeader.test.ts`; `unsafe-eval` remains in non-production only |
| 7 | OAuth Client ID is public | low | **OPEN, BY DESIGN** — inherent to device flow; no fix exists within that model |
| 8 | Share-link burn key uses 32-bit FNV-1a | low | **FIXED** — SHA-256 via `crypto.subtle` at `src/utils/shareLink.ts:116` |

## Findings

### 1. XSS in ZIP HTML export — unescaped note content [severity: high]

**Status: FIXED.** `src/utils/export.ts:274` now reads `convertMarkdownToHTML(escapeHTML(note.content))`,
matching `buildPrintableHtml` at line 162. `src/__tests__/exportXssGuard.test.ts` scans the source
statically, so a regression fails the suite rather than waiting to be noticed in an exported file.

**Where:** `src/utils/export.ts:269`

**What:**
`convertToHTML` (invoked at line 67 when `options.format === 'html'`) passes `note.content` raw — without calling `escapeHTML` — to `convertMarkdownToHTML`:

```ts
${convertMarkdownToHTML(note.content)}   // line 269 — unescaped
```

`convertMarkdownToHTML` is a naive regex converter that does not strip HTML tags before emitting output. A note containing `<script>alert(1)</script>` or `<img src=x onerror=alert(document.cookie)>` has those strings written verbatim into the exported `.html` file inside the ZIP archive.

By contrast, `buildPrintableHtml` (used by the standalone HTML export and PDF paths, lines 154/157) correctly calls `convertMarkdownToHTML(escapeHTML(n.content))`. The inconsistency means the ZIP export silently regressed while the standalone export path stayed safe.

**Why it matters:**
The exported HTML file is a self-contained XSS payload that executes when the recipient opens it in any browser. If the note was synced from GitHub, an attacker who can push to the vault repo can plant the payload. A shared `/share` URL can carry the content that gets imported and later ZIP-exported by the recipient. Severity is high because the vector requires no server-side access and produces a weaponised artefact delivered to a third party.

**Suggested fix:**
Change line 269 from `convertMarkdownToHTML(note.content)` to `convertMarkdownToHTML(escapeHTML(note.content))`, matching the established pattern in `buildPrintableHtml`. The `escapeHTML` helper is already defined in the same file (line 423).

---

### 2. GitHub OAuth token in localStorage with full `repo` scope [severity: medium]

**Status: OPEN, ACCEPTED.** `repo` is still the default scope requested at sign-in
(`src/utils/github.ts:88` → `src/app/api/github/device-code/route.ts`). Accepted because Noteser
is a single-user personal vault tool and the vault repo is usually private, which `public_repo`
cannot reach at all — narrowing the scope would break the product's main use case rather than
harden it. The residual risk is bounded by the render-layer XSS controls that finding 1 and
findings 5/6 have since tightened, and an attacker needs script execution on the origin before
the token is reachable at all.

Partially mitigated since the audit: the proxy now enforces an `ALLOWED_SCOPES` allow-list
(`{'repo', 'repo gist'}`) so a caller cannot coax it into requesting `admin:org` or
`delete_repo`, and `gist` is requested on demand the first time a user publishes a gist rather
than granted to everyone at sign-in.

**Where:** `src/stores/githubStore.ts:94-102` (persist partializer), `src/app/api/github/device-code/route.ts:41`

**What:**
The OAuth token is persisted in `localStorage` under the Zustand `persist` key `noteser-github`. The device-code route requests the `repo` scope (line 41), which grants read/write access to all private and public repositories on the user's GitHub account — not only the vault repo.

**Why it matters:**
Any successful XSS on the noteser origin (however unlikely given current render hardening) exfiltrates a token capable of pushing to, reading, or deleting every private repo the user owns. The blast radius is the user's entire GitHub account, not just their notes.

**Suggested fix:**
For users syncing only a public repo, request `public_repo` instead of `repo`. For private repos, guide users to create a fine-grained PAT scoped to the specific vault repository. GitHub's device-flow supports fine-grained PATs. Longer-term, if the app becomes multi-tenant, move the token to an HttpOnly server-side session cookie.

---

### 3. In-memory rate limiter resets on every serverless cold start [severity: medium]

**Status: OPEN, ACCEPTED.** `BUCKETS` is still a module-level `Map` at `src/utils/rateLimit.ts:13`.
Accepted because this is a throughput control, not a confidentiality one: a bypassed limit lets a
caller poll `/api/github/access-token` faster, but it still cannot read a token without already
knowing the `device_code`, which is only ever shown to the user who started the flow. For a
single-user personal vault the fleet never scales past a handful of instances, so the effective
limit stays in the same order of magnitude as the intended one.

Adding Vercel KV or Upstash to fix it properly means a new paid dependency and a new failure mode
in the OAuth path, which is a poor trade against a DoS-throughput concern on a single-user app.
Revisit if Noteser ever becomes multi-tenant.

**Where:** `src/utils/rateLimit.ts:13`

**What:**
The `BUCKETS` Map is module-level in-process state. On Vercel (or any serverless runtime), each function instance is isolated; a new cold-started instance begins with an empty `BUCKETS`. The file comment acknowledges this: "Survives the lifetime of one Node process — it'll reset when the instance recycles." Under autoscaling, multiple concurrent instances each maintain independent counters, and the effective per-IP limit across the fleet is `max × instance_count`.

**Why it matters:**
The `/api/github/access-token` route returns the OAuth token in the response body to the poller that knows the device_code. The intended 10-requests-per-5-seconds limit per IP becomes trivially bypassable across instances, marginally increasing the chance of a device_code being harvested via brute-force polling before the user revokes it.

**Suggested fix:**
Replace the in-memory `BUCKETS` Map with Vercel KV or Upstash Redis for production deployments. The `checkRateLimit` call-sites are already abstracted — only the bucket store implementation needs to change.

---

### 4. `X-Forwarded-For` is caller-controlled in non-Vercel deployments [severity: medium]

**Status: FIXED.** `getClientIp` now honours a `TRUSTED_PROXY_COUNT` env var and strips that
many right-hand hops before trusting an `x-forwarded-for` value, falling back to `x-real-ip`
and then an unknown sentinel (`src/utils/rateLimit.ts:50-102`). The Vercel trust assumption is
documented in the rate-limiter comment, as the finding asked.

**Where:** `src/utils/rateLimit.ts:52-53`

**What:**
`getClientIp` reads `x-forwarded-for` and trusts the leftmost value (`xff.split(',')[0].trim()`). On Vercel, this header is set authoritatively by the edge network. However, if the app is deployed behind a reverse proxy that does not overwrite or strip the header, a caller can send `X-Forwarded-For: <fabricated-ip>` and rotate to a fresh rate-limit bucket on every request.

**Why it matters:**
Rate-limit bypass enables brute-force polling of `/api/github/access-token`. Risk is low on the canonical Vercel deployment but becomes medium for self-hosted instances.

**Suggested fix:**
Add a `TRUSTED_PROXY_COUNT` env var and strip that many left-hand XFF values before trusting the IP, or accept only `cf-connecting-ip` / `x-real-ip` which reverse proxies set from authoritative sources. Document the Vercel-specific trust assumption in the rate-limiter comment.

---

### 5. `connect-src wss: ws:` allows WebSocket exfiltration to any host [severity: medium]

**Status: FIXED.** The bare `wss: ws:` wildcards are gone. The CSP moved out of
`next.config.mjs` into `src/utils/csp.ts`, which derives a single ws(s) origin from the
configured collaboration endpoint and adds only that to `connect-src`; with no endpoint
configured, no WebSocket origin is permitted at all.

**Where:** `next.config.mjs:25`

**What:**
The `connect-src` directive includes the bare wildcards `wss:` and `ws:` with no hostname constraint, permitting browser-initiated WebSocket connections to any host on any port. All other entries in `connect-src` are narrowly scoped to specific hostnames (`api.github.com`, `api.anthropic.com`, etc.).

**Why it matters:**
If an XSS payload executes, it can open a WebSocket to an attacker-controlled server and stream out `localStorage` contents (GitHub token, AI API keys). The otherwise tight HTTP `connect-src` allowlist provides no benefit if the WebSocket wildcard remains, because WebSocket is a persistent bidirectional channel.

The Yjs collaboration feature (the original motivation for `wss:`) has no active imports in the codebase as of this audit — the feature is dormant by default.

**Suggested fix:**
Remove `wss: ws:` from the default CSP. If Yjs is re-enabled, scope the directive to `wss:${NEXT_PUBLIC_YJS_WS_HOST}` set at build time via an env var, so only the configured collaboration endpoint is permitted.

---

### 6. `script-src 'unsafe-inline' 'unsafe-eval'` renders CSP script control inert [severity: low]

**Status: FIXED.** `script-src` is now `'self' 'nonce-<random>' 'strict-dynamic'` from a
per-request nonce in `src/middleware.ts` (logic in `src/utils/csp.ts`), so `'unsafe-inline'`
is gone from production. `'unsafe-eval'` is added only in non-production for dev HMR.
`src/__tests__/cspHeader.test.ts` locks it. The 2026-05-22 investigation log below records the
first attempt, which failed — it is kept because the failure mode is worth remembering.

**Where:** `next.config.mjs:15`

**What:**
The `script-src` directive includes both `'unsafe-inline'` and `'unsafe-eval'`. These keywords together mean any inline `<script>` block or `eval()` call executes freely regardless of the CSP, so the header provides no script-level XSS backstop. The comment identifies Next.js hydration bootstrap and CodeMirror runtime as the reason.

**Why it matters:**
The app's XSS resistance rests entirely on the render layer (ReactMarkdown without rehype-raw, no dangerouslySetInnerHTML). The CSP cannot catch a regression there. The `markdownXssGuard` test suite is the real safety net.

**Suggested fix:**
For production builds, investigate nonce-based `script-src` via Next.js middleware (`middleware.ts` with a per-request nonce injected into `<script>` tags). This would allow dropping `'unsafe-inline'`. `'unsafe-eval'` may still be required by CodeMirror and warrants a separate evaluation. Until then, the static guard tests remain the primary control and must not be weakened.

**Investigation log (2026-05-22):**
First attempt followed the official Next.js pattern — `src/middleware.ts` generates a per-request base64 nonce, sets `x-nonce` on the forwarded request headers, and writes a `Content-Security-Policy` response header with `script-src 'self' 'nonce-X' 'strict-dynamic' 'unsafe-eval'`. The root layout was switched to `dynamic = 'force-dynamic'` and read the header via `headers().get('x-nonce')`.

Result: build succeeded, middleware emitted a fresh nonce per request, but Next.js 15.5.18 did **not** auto-attribute the nonce to its emitted `<script>` tags (verified via `curl` of the production server — no `nonce="..."` attribute on any of the 17 bootstrap scripts). With `'strict-dynamic'` in effect, `'self'` is ignored by CSP3 browsers, so the external chunks would be blocked → fully broken app. Dropping `'strict-dynamic'` would let the chunks load via `'self'` but the inline `(self.__next_f=…).push(…)` hydration scripts would still be blocked.

Tracked as a follow-up needing a deeper Next.js investigation (or a version bump). Possible angles: explicit `<Script>` tags with `nonce={nonce}` in the layout, the `unstable_*` nonce APIs, or hash-based `script-src` instead of nonce. The exploratory branch `feat/security-csp-nonce` was reverted to avoid shipping a broken CSP.

---

### 7. GitHub OAuth Client ID is public; device-flow can be initiated by third parties [severity: low]

**Status: OPEN, BY DESIGN.** Unchanged and unfixable within the device-flow model, exactly as
the finding itself concluded: the flow is specified for public clients and the Client ID is
necessarily in the bundle. Both proxy routes do enforce an origin allow-list
(`src/utils/originAllowlist.ts`), which stops abuse *through Noteser*; it cannot stop direct
calls to `github.com/login/device/code`.

**Where:** `src/app/api/github/device-code/route.ts:30`, `.env.local:1`

**What:**
`NEXT_PUBLIC_GITHUB_CLIENT_ID` is baked into the browser bundle. The proxy routes also read it server-side. The device-flow specification does not require a client secret for the initiation step, so anyone who extracts the Client ID from the bundle can initiate device flows that display "Noteser" as the requesting application.

**Why it matters:**
A third party can consume the Noteser OAuth App's GitHub API rate quota, or craft phishing flows where a user is shown a legitimate-looking "Authorize Noteser" GitHub page for a code the attacker controls. The origin allowlist prevents abuse via the Noteser proxy routes specifically but does not prevent direct calls to `github.com/login/device/code`.

**Suggested fix:**
No complete fix exists within the device-flow model, which is designed for public clients. Monitoring the OAuth App's GitHub analytics for unusual volumes is the practical mitigation. If the threat materialises, migrate to a server-side web-application flow (authorization code + PKCE with a Client Secret stored server-side, never in the bundle).

---

### 8. Share-link burn key uses 32-bit FNV-1a (collision risk) [severity: low]

**Status: FIXED.** `shareLinkBurnKey` is now async and derives the key from
`crypto.subtle.digest('SHA-256', …)` (`src/utils/shareLink.ts:116-126`), with a documented
non-hashed fallback to the fragment prefix where `crypto.subtle` is unavailable (insecure
context). FNV-1a is gone.

**Where:** `src/utils/shareLink.ts:113-119`

**What:**
`shareLinkBurnKey` derives a `localStorage` key from the share fragment using FNV-1a 32-bit, producing ~4 billion distinct values. Two distinct share fragments can collide with probability 1-in-4-billion per pair, causing an unrelated link to appear "burned" to the recipient.

**Why it matters:**
Burn-after-read is already documented as an honor-system client-side check. A hash collision is a UX edge case — no attacker gains anything from it. Impact is cosmetic.

**Suggested fix:**
Use the first 64 characters of the URL-safe base64 fragment itself as the localStorage key (guaranteed unique with no hashing). Alternatively, replace FNV-1a with a truncated `crypto.subtle.digest('SHA-256', fragment)` output, consistent with how the codebase already uses SubtleCrypto for blob SHA computation.

---

## Non-findings / verified clean

- **No `dangerouslySetInnerHTML` in `src/`** — confirmed by grep and locked by `src/__tests__/markdownXssGuard.test.tsx:57-64`.
- **No `rehype-raw` import** — raw HTML in markdown is rendered as escaped text, not executed; locked by the same guard test.
- **`javascript:` wikilink titles are percent-encoded** into `wikilink://javascript%3A...` hrefs — confirmed by `src/__tests__/wikilinkSafety.test.ts:13-20`.
- **WikilinkAnchor renders as a `<span>` with onClick**, never as `<a href="wikilink://..."></a>` that the browser interprets as a URL — `src/components/editor/EditorContent.tsx:417-446`.
- **External hrefs get `rel="noopener noreferrer"`** — `EditorContent.tsx:443`.
- **`/api/github/zipball` path-traversal guards** — owner, repo, and ref are validated against allowlist regexes at `src/app/api/github/zipball/route.ts:45-58`; double-dots and leading/trailing slashes in ref are explicitly rejected.
- **Origin allowlist on both OAuth proxy routes** — requests without a matching Origin/Referer are rejected 403; covered by 8 unit-test cases in `src/__tests__/originAllowlist.test.ts`.
- **Share page renders via ReactMarkdown** (not innerHTML) — `src/app/share/page.tsx:124`; locked by `markdownXssGuard` test.
- **AI API keys are sent directly from the browser to provider endpoints** — never proxied through Noteser servers; `src/utils/aiClient.ts:126-137, 165-171`.
- **Vault settings parser whitelist** drops unknown keys including `aiApiKey`, preventing a malicious peer-pushed `.noteser/settings.json` from injecting credentials — documented in `docs/security-review.md`.
- **`X-Frame-Options: DENY`**, **`X-Content-Type-Options: nosniff`**, **`Referrer-Policy: strict-origin-when-cross-origin`**, and **`Permissions-Policy`** disabling camera/mic/geolocation are all present in `next.config.mjs:32-38`.

---

## Suggested follow-up branches

Reviewed 2026-07-29. Nothing here is outstanding work any more — the four security fixes shipped,
and the two remaining findings were decided rather than deferred.

**Shipped:**

- ~~`feat/security-html-export-escape` — Finding 1~~ — shipped; `escapeHTML` at `src/utils/export.ts:274`.
- ~~`feat/security-csp-websocket-scope` — Finding 5~~ — shipped; ws origin derived in `src/utils/csp.ts`.
- ~~`feat/security-csp-nonce` — Finding 6~~ — shipped; nonce + `strict-dynamic`, `'unsafe-inline'` gone from production.
- ~~`feat/security-share-burn-hash` — Finding 8~~ — shipped; SHA-256 via `crypto.subtle`.
- ~~Finding 4 (`X-Forwarded-For`)~~ — shipped as `TRUSTED_PROXY_COUNT`; it never had a branch listed here.

**Not planned (decided, not deferred):**

- `feat/security-oauth-scope` (Finding 2) — **not planned.** `public_repo` cannot reach a private
  vault repo, which is the normal case, so narrowing the scope removes the feature rather than the
  risk. See the finding's status note.
- `feat/security-rate-limit-redis` (Finding 3) — **not planned.** A throughput control on a
  single-user app does not justify a paid dependency in the OAuth path. Revisit if Noteser ever
  becomes multi-tenant.

Finding 7 has no branch because none is possible: a public Client ID is inherent to the OAuth
device flow.
