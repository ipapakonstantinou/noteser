# Release process

How we ship code to production. **Active mode: branch-per-feature with
preview URLs.** (Flipped on 2026-05-21 — see "Historical" at the
bottom for the prior direct-to-main mode.)

## Branch model

  main      ── production. Auto-deploys to noteser.thetechjon.com.
              Treat as immutable: only landed via PR merge from dev
              or feature branches once the preview has been verified.

  dev       ── integration / staging. Auto-deploys to a Vercel preview
              URL (visible in the Vercel Deployments tab).
              Merge feature branches here first when you want a
              stable preview to share or QA against.

  feat/<x>  ── one branch per feature. Push → Vercel auto-creates a
              per-branch preview URL. Open a PR back to dev (or main
              for hotfixes).

  fix/<x>   ── same as feat/, but for bug fixes.

  hotfix/<x> ── production emergencies only. Branch off main, PR back
              to main, see "Hot-fix path" below.

## Standard workflow

1. **Branch.** `git checkout -b feat/<short-name>` from `dev`.
2. **Build.** Land your work; commit small. CI runs on every push
   (typecheck + lint + test + build).
3. **Push.** Vercel auto-generates a preview URL within ~1-2 minutes
   (`noteser-git-feat-<branch>-<user>.vercel.app` or similar). It's
   shown in the Vercel Deployments tab and as a comment on the PR.
4. **Open a PR.** Target `dev`. The PR description should include
   the manual-test scope and which areas of the app it touches.
5. **Owner reviews the preview URL.** Smoke through the affected
   surface. For Settings or sync changes, also try the recovery flow
   (`?reset=1`).
6. **Merge into `dev`.** Vercel updates the staging preview at
   `dev`'s URL.
7. **Promote to prod.** When `dev` looks right after batching one or
   more features, open a `dev → main` PR. Merge → Vercel deploys to
   `noteser.thetechjon.com`.
8. **If prod breaks**, revert the merge commit on main (creates a
   new "Revert" commit). Preview branches stay alive for diagnostics.

## Guardrails

- **CI runs on every push and PR.** `.github/workflows/ci.yml` runs
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` on
  `main`, `dev`, and any PR targeting either. Watch the badge before
  you merge.
- **Branch protection NOT enforced.** GitHub Pro is required for
  protected branches on private repos and we don't pay for it. The
  rules above are convention-only — direct pushes to main are
  technically possible but rude. Use PRs.
- **Skew Protection on.** Vercel project setting → Functions. Prevents
  the "old client JS calling new server" failure mode that can happen
  mid-deploy.
- **Manual smoke before promoting to main.** Walk through
  `docs/feature-test-checklist.md` for any touched area. For Settings
  or sync changes, also try the recovery flow (`?reset=1`).
- **Database / persisted-state migrations require a version bump.** Any
  change that breaks the shape of localStorage / IDB needs a
  `PERSISTED_RESET_VERSION` bump (see `src/utils/reset.ts`). Document
  the bump in the PR description.

## Hot-fix path

For production-down emergencies:

1. Branch off `main`: `git checkout -b hotfix/<thing>`.
2. Fix forward (minimal change). Add a regression test.
3. Push + open PR **targeting main directly** (not dev). Don't wait
   for the standard checklist, but DO wait for CI green.
4. Merge. Verify production resolved.
5. Backport the fix to `dev` and any in-flight feature branches that
   diverged: `git checkout dev && git cherry-pick <hotfix-sha>`.

## Anti-patterns to avoid

- **Long-lived feature branches.** Anything past ~1 week starts to drift.
  Merge incrementally behind a beta flag instead.
- **Force-pushing to main or dev.** Don't. Revert via a new commit.
- **Skipping CI with `--no-verify`.** If a hook is wrong, fix the hook.
  Bypassing it loses the safety guarantee.
- **"Just one tiny fix on main."** Every one-off shortcut becomes the
  habit. Use the branch flow.

## Historical — direct-to-main (pre 2026-05-21)

Until 2026-05-21 noteser was in single-owner development mode, with
changes landing directly on `main`. That mode is preserved below for
archaeology only:

> 1. Land changes directly on `main`.
> 2. Run `npm run typecheck && npm test && npm run build` before pushing.
> 3. Push. Vercel auto-deploys `main` → noteser.thetechjon.com.
> 4. If the deploy fails, fix-forward — push another commit.

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
