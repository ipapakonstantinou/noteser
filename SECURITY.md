# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting: on the repository, go to the
**Security** tab and choose **Report a vulnerability** (this opens a private
advisory only the maintainers can see). Include what you found, how to
reproduce it, and the impact you expect. You will get a response as the report
is reviewed.

## Trust model (important context)

Noteser runs entirely in your browser and talks directly to GitHub:

- Your notes live in the browser (`localStorage` / IndexedDB) and, if you turn
  on sync, in a GitHub repository you own. There is no Noteser server holding
  your notes.
- The GitHub access token is stored in the browser (`localStorage`), the same
  trust model as the Obsidian Git plugin. A successful cross-site-scripting
  (XSS) attack against the app could read that token, so reports of XSS or any
  way to inject script are taken seriously.
- The only server-side code is two thin OAuth proxy routes (`/api/github/*`)
  that forward to GitHub's OAuth endpoints; they store nothing and are
  rate-limited per IP.

## Please never include in a report or an issue

- A real GitHub token or any credential.
- Private note contents.

Redact those before sharing reproduction steps.

## Audit log

A short public log of security-relevant findings and the fixes that
shipped. Entries are append-only.

### 2026-05-30 — git-proxy: missing origin allowlist + rate limit

**Reporter:** external review (shared by maintainer).
**Where:** `src/app/api/git-proxy/[...path]/route.ts`.
**Severity:** infrastructure abuse / bandwidth amplification on our Vercel
account. NOT a token-theft vector (the proxy injects no token, and noteser
stores its token in `localStorage` not in cookies, so a victim's browser
does not auto-attach credentials for an attacker). NOT an SSRF vector
either (the route already restricts forwarding to an `ALLOWED_HOSTS` set
of `github.com` only, with `redirect: 'manual'`).
**Impact:** every other proxy route (`/api/github/device-code`,
`access-token`, `refresh-token`, `zipball`) was already guarded by
`isOriginAllowed()` + `checkRateLimit()`. The git-proxy route, which
handles the heaviest traffic (isomorphic-git push and fetch pack-files),
ran neither check. Anyone on the internet could use noteser.app as a free
unmetered CORS-and-anonymising proxy to github.com.
**Fix:** commit `8854734` adds the same origin check and a per-IP rate
limit (`{ max: 120, windowMs: 60_000 }`) every other route uses. Shipped
to prod the same day in the dev → main merge `2144484`.

### 2026-05-30 — Static-source XSS guard expanded

**Reporter:** same review.
**Where:** `src/__tests__/markdownXssGuard.test.tsx`.
**Severity:** preventive. Closes a gap in the test-time enforcement that
backs the no-raw-HTML promise (the noteser threat model assumes XSS is
impossible because no source file feeds note content into a raw-HTML
sink).
**Impact:** the existing guard already failed loudly on any
`dangerouslySetInnerHTML` use, `rehype-raw` import, or new `rehypePlugins`
attribute. It did not catch direct `.innerHTML =` assignments at the DOM
level — the equivalent sink reachable from any `document.querySelector`
result.
**Fix:** added a fifth test pinning the absence of `.innerHTML =` and
`.innerHTML +=` patterns in all `src/` source files. An ESLint rule was
attempted first but FlatCompat with `next/core-web-vitals` silently drops
the custom rule blocks; the static-source test has equivalent coverage
and runs as part of the standard CI test suite.
