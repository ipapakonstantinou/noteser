# Release process

How we ship code to production. Two modes — current (development) and
post-go-live (when we want to protect production users from broken
deploys).

## Current mode — direct-to-main (development phase)

While the only user is the project owner, this is fine:

1. Land changes directly on `main`.
2. Run `npm run typecheck && npm test && npm run build` before pushing.
3. Push. Vercel auto-deploys `main` → noteser.thetechjon.com.
4. If the deploy fails, fix-forward — push another commit.

Why this works in dev: blast radius is one person, and that person
chose to take the risk. Cost of a broken deploy is "refresh the tab in
5 minutes."

## Go-live mode — branch-per-feature with preview URLs

Switch to this **before** we publicly announce or onboard anyone other
than the owner.

### Workflow

1. **One branch per feature.** Convention: `feat/<orchestrator-id>` or
   `fix/<short-name>`. Examples: `feat/d6v8-database-view`,
   `fix/sync-storm`.
2. **Push the branch.** Vercel auto-generates a unique preview URL
   (`noteser-<branch>-<user>.vercel.app`). Visible under the project's
   Deployments tab in the Vercel dashboard.
3. **Open a PR.** Vercel auto-comments the preview URL on the PR
   description.
4. **Owner reviews the preview URL.** Manual smoke through the
   feature-test-checklist for the affected area.
5. **Merge** when the preview looks right. Vercel deploys `main` →
   production. If something breaks, revert the merge commit — preview
   stays alive for diagnostics.

### Guardrails

- **CI required before merge.** Add a GitHub Actions workflow that
  runs `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
  on every PR. Block merge on red. (See `docs/release-process.md`
  follow-up: `ci-checks` task.)
- **Skew Protection on.** Vercel project setting → Functions. Prevents
  the "old client JS calling new server" failure mode that can happen
  mid-deploy.
- **Manual smoke checklist.** Walk through `docs/feature-test-checklist.md`
  for any touched area before merging a PR. For Settings or sync
  changes, also try the recovery flow (`?reset=1`).
- **Database / persisted-state migrations require a version bump.** Any
  change that breaks the shape of localStorage / IDB needs a
  `PERSISTED_RESET_VERSION` bump (see `src/utils/reset.ts`). Document
  the bump in the PR description.

### Hot-fix path

For production-down emergencies:

1. Branch off `main`: `git checkout -b hotfix/<thing>`.
2. Fix forward (minimal change). Add a regression test.
3. Push + open PR. **Don't wait for the standard checklist**, but DO
   wait for CI green.
4. Merge. Verify production resolved.
5. Backport the fix to any in-flight feature branches that diverged.

### Anti-patterns to avoid

- **Long-lived feature branches.** Anything past ~1 week starts to drift.
  Merge incrementally behind a beta flag instead.
- **Force-pushing to main.** Don't. Even revert via a new commit.
- **Skipping CI with `--no-verify`.** If a hook is wrong, fix the hook.
  Bypassing it loses the safety guarantee.
- **"Just one tiny fix on main."** Every one-off shortcut becomes the
  habit. Use the branch flow once we're live.

### When to flip the switch

Triggers for moving from current → go-live mode:

- Public announcement (Twitter / Reddit / HN).
- The first non-owner user starts depending on the production URL.
- We start charging or collecting any kind of data.
- Whichever comes first.

When the switch flips: this section becomes the canonical workflow,
the "current mode" section moves to a "Historical" subheading.

## LAN access from another PC

The dev script binds to `0.0.0.0:3001`, so the app is reachable from any
device on the same network via the host's LAN IP — e.g.
`http://192.168.2.23:3001`. Useful for testing the UI from a phone or a
second laptop without rebuilding.

**Important caveat**: GitHub sync needs the Web Crypto API
(`crypto.subtle.digest`), which browsers only expose in a *secure
context* — HTTPS, or `http://localhost` on the same machine. Hitting the
LAN IP over plain HTTP from another PC means `crypto.subtle` is
undefined, and the first sync call throws. Three ways to fix:

1. **Use the production HTTPS URL.** `https://noteser.thetechjon.com` is
   the simplest path — sync works because the browser sees a secure
   context.
2. **SSH tunnel.** From the secondary PC:
   `ssh -L 3001:localhost:3001 <user>@<host-lan-ip>` then visit
   `http://localhost:3001`. The browser treats `localhost` as secure.
3. **Dev server with HTTPS.** `next dev --experimental-https -H 0.0.0.0 -p 3001`
   produces a self-signed cert; click through the browser warning once.

`src/utils/github.ts:gitBlobShaBytes` throws a clear "Web Crypto API
unavailable" error pointing here when the API is missing, so the
symptom is obvious instead of the cryptic
`Cannot read properties of undefined (reading 'digest')`.

## Vercel-specific notes

- **Custom domain.** `noteser.thetechjon.com` points at the
  `main` production deploy.
- **Preview URLs.** Auto-generated per non-main branch.
- **Build command.** `next build` (default).
- **Output.** `.next/` — not committed; built fresh per deploy.
- **Required env vars.** `NEXT_PUBLIC_GITHUB_CLIENT_ID` (and optionally
  `NEXT_PUBLIC_YJS_WS_URL`) under Project Settings → Environment
  Variables.
- **Node version.** Pinned to `22.x` via `engines.node` in
  `package.json` to silence the Vercel "Project Setting overridden"
  warning.
