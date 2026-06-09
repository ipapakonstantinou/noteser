# Changelog

User-facing release notes for [Noteser](https://noteser.app). For the full
commit log see the [GitHub history](https://github.com/ipapakonstantinou/noteser/commits/main).

## 2026-06-07

- **Public beta channel.** `beta.noteser.app` is now linked from the welcome
  view and from Settings → About. The beta channel tracks the `dev` branch.
  New features land there first; the stable channel at `noteser.app` updates
  when a release is cut.

## 2026-06-01

- **Open your existing vault — top-of-page CTA.** Visitors who already have a
  markdown vault on disk see a one-click "Point at a folder" action above
  every other section on the welcome view.
- **Browser-support hint.** The folder-open card now renders on iOS too,
  dimmed, with a note that desktop Chrome/Edge/Brave is required. iOS users
  no longer feel like the feature is missing.
- **Noteser logo lockup.** The welcome view shows the Noteser apple-icon
  beside the "noteser" wordmark. Same icon the manifest and Buttondown
  emails use.
- **Email signup polish.** Subscribe button renders as a solid card; the
  email input has a dark background so light text reads on iOS Safari.

## 2026-05-31

- **Email signup form (powered by Buttondown).** Drop your address on the
  welcome view or in Settings → About to get an email when something new
  ships. Tagged signups so per-surface attribution lands in the dashboard.
- **Vercel Web Analytics.** Visitor + referrer attribution wired up; custom
  events fire on first-note-created / sync-configured / sync-success so the
  funnel reads as visit → create → connect → push.
- **Community contributions.** Two external PRs merged: README contributing
  section (PR #37, ded-furby) and the lenient "done today" task-query
  setting (PR #36, MFA-G).
- **Two-year HSTS + X-Powered-By suppression.** Standard security-header
  hygiene; HTTPS-only across every subdomain.
- **Git-proxy hardening.** Origin allowlist + per-IP rate limit (120/min) so
  the proxy cannot be abused as a sync amplifier.

## 2026-05-30

- **Mobile keyboard layout.** Welcome and editor views adapt to the on-screen
  keyboard via `h-dvh`. The mobile formatting toolbar was removed in favour
  of the native iOS accessory bar.
- **Coming-from-Obsidian CTA restored** on the welcome view for users
  migrating an existing markdown vault.
- **Feature-tour attachments self-heal.** If IndexedDB loses a tutorial
  image, the editor refetches the public asset and writes it back so the
  walkthrough never breaks.

## 2026-05-29

- **Show HN + Reddit launch.** Posts live at r/SideProject and r/PKMS;
  feedback flowing into GitHub Issues.
- **Demo GIF.** Playwright-recorded 12-second clip of the live-preview
  editor on the landing view.

## 2026-05-25 — sync-safety overhaul

- **Real sync test harness.** `npm run e2e:sync` runs a full clone / push /
  pull / round-trip against a live throwaway GitHub repo. Catches regressions
  the unit tests cannot.
- **Zipball-on-first-pull.** Initial clones use GitHub's zipball endpoint,
  ten times faster than the tree-walk for a 1k-note vault.
- **Pull deduplication.** Repeated pulls no longer create duplicate notes when
  remote and local share a logical path.
- **Hard-reset to remote.** A first-class "reset my vault to whatever is in
  the repo" action; recovery path for "I broke my local state."

## 2026-05-21 → 2026-05-24 — security audit follow-ups

- **Per-request CSP with nonce + strict-dynamic.** Replaced the static CSP
  with a per-request nonce minted in middleware. `unsafe-inline` is gone for
  scripts, `unsafe-eval` is gone in production.
- **WebSocket origin restriction.** Wildcard `wss:` removed; only the
  explicit collab origin is allowed when configured.
- **OAuth proxy hardening.** Per-IP rate limiting plus same-origin checks on
  every proxy route.
- **`.innerHTML` setter pinned.** A static test fails the build if any future
  PR introduces a raw `.innerHTML =` write, closing the most common XSS sink.

## Earlier

For the longer history see the [GitHub commits](https://github.com/ipapakonstantinou/noteser/commits/main).
