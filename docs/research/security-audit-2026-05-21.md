# Security audit — 2026-05-21

## Executive summary

The app's XSS defences on the in-app preview and `/share` page are strong: no `rehype-raw`, no `dangerouslySetInnerHTML`, locked wikilink hrefs, and static guard tests that would catch regressions. One high-severity gap exists in the HTML export-to-ZIP path — raw note content is interpolated directly into an HTML template without escaping, so a crafted note produces a self-contained XSS payload in the exported file. The CSP is well-structured but `script-src 'unsafe-inline' 'unsafe-eval'` means it cannot stop script injection if one were ever reached in-app; all weight falls on the render-layer controls, which currently hold.

## Findings

### 1. XSS in ZIP HTML export — unescaped note content [severity: high]

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

**Where:** `src/stores/githubStore.ts:94-102` (persist partializer), `src/app/api/github/device-code/route.ts:41`

**What:**
The OAuth token is persisted in `localStorage` under the Zustand `persist` key `noteser-github`. The device-code route requests the `repo` scope (line 41), which grants read/write access to all private and public repositories on the user's GitHub account — not only the vault repo.

**Why it matters:**
Any successful XSS on the noteser origin (however unlikely given current render hardening) exfiltrates a token capable of pushing to, reading, or deleting every private repo the user owns. The blast radius is the user's entire GitHub account, not just their notes.

**Suggested fix:**
For users syncing only a public repo, request `public_repo` instead of `repo`. For private repos, guide users to create a fine-grained PAT scoped to the specific vault repository. GitHub's device-flow supports fine-grained PATs. Longer-term, if the app becomes multi-tenant, move the token to an HttpOnly server-side session cookie.

---

### 3. In-memory rate limiter resets on every serverless cold start [severity: medium]

**Where:** `src/utils/rateLimit.ts:13`

**What:**
The `BUCKETS` Map is module-level in-process state. On Vercel (or any serverless runtime), each function instance is isolated; a new cold-started instance begins with an empty `BUCKETS`. The file comment acknowledges this: "Survives the lifetime of one Node process — it'll reset when the instance recycles." Under autoscaling, multiple concurrent instances each maintain independent counters, and the effective per-IP limit across the fleet is `max × instance_count`.

**Why it matters:**
The `/api/github/access-token` route returns the OAuth token in the response body to the poller that knows the device_code. The intended 10-requests-per-5-seconds limit per IP becomes trivially bypassable across instances, marginally increasing the chance of a device_code being harvested via brute-force polling before the user revokes it.

**Suggested fix:**
Replace the in-memory `BUCKETS` Map with Vercel KV or Upstash Redis for production deployments. The `checkRateLimit` call-sites are already abstracted — only the bucket store implementation needs to change.

---

### 4. `X-Forwarded-For` is caller-controlled in non-Vercel deployments [severity: medium]

**Where:** `src/utils/rateLimit.ts:52-53`

**What:**
`getClientIp` reads `x-forwarded-for` and trusts the leftmost value (`xff.split(',')[0].trim()`). On Vercel, this header is set authoritatively by the edge network. However, if the app is deployed behind a reverse proxy that does not overwrite or strip the header, a caller can send `X-Forwarded-For: <fabricated-ip>` and rotate to a fresh rate-limit bucket on every request.

**Why it matters:**
Rate-limit bypass enables brute-force polling of `/api/github/access-token`. Risk is low on the canonical Vercel deployment but becomes medium for self-hosted instances.

**Suggested fix:**
Add a `TRUSTED_PROXY_COUNT` env var and strip that many left-hand XFF values before trusting the IP, or accept only `cf-connecting-ip` / `x-real-ip` which reverse proxies set from authoritative sources. Document the Vercel-specific trust assumption in the rate-limiter comment.

---

### 5. `connect-src wss: ws:` allows WebSocket exfiltration to any host [severity: medium]

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

**Where:** `src/app/api/github/device-code/route.ts:30`, `.env.local:1`

**What:**
`NEXT_PUBLIC_GITHUB_CLIENT_ID` is baked into the browser bundle. The proxy routes also read it server-side. The device-flow specification does not require a client secret for the initiation step, so anyone who extracts the Client ID from the bundle can initiate device flows that display "Noteser" as the requesting application.

**Why it matters:**
A third party can consume the Noteser OAuth App's GitHub API rate quota, or craft phishing flows where a user is shown a legitimate-looking "Authorize Noteser" GitHub page for a code the attacker controls. The origin allowlist prevents abuse via the Noteser proxy routes specifically but does not prevent direct calls to `github.com/login/device/code`.

**Suggested fix:**
No complete fix exists within the device-flow model, which is designed for public clients. Monitoring the OAuth App's GitHub analytics for unusual volumes is the practical mitigation. If the threat materialises, migrate to a server-side web-application flow (authorization code + PKCE with a Client Secret stored server-side, never in the bundle).

---

### 8. Share-link burn key uses 32-bit FNV-1a (collision risk) [severity: low]

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

- `feat/security-html-export-escape` — one-line fix for Finding 1 (`convertToHTML` line 269); high priority.
- `feat/security-csp-websocket-scope` — narrow `wss: ws:` to a specific host or remove when Yjs is not configured (Finding 5).
- `feat/security-rate-limit-redis` — replace in-memory `BUCKETS` with Vercel KV / Upstash for multi-instance correctness (Finding 3).
- `feat/security-csp-nonce` — investigate nonce-based `script-src` to retire `'unsafe-inline'`/`'unsafe-eval'` in production (Finding 6).
- `feat/security-oauth-scope` — request `public_repo` or guide users to a fine-grained PAT scoped to the vault repo only (Finding 2).
- `feat/security-share-burn-hash` — replace FNV-1a burn key with raw fragment prefix or SHA-256 (Finding 8; low priority).
