# Contributing to Noteser

Thanks for taking the time to contribute. Noteser is a browser-first,
Obsidian-style markdown note app. This guide covers how to run it locally,
the branch workflow, and how to open a useful issue or pull request.

## Run it locally

Requirements: Node 22.x (see `package.json` `engines`).

```bash
npm install
npm run dev          # http://localhost:3001
```

GitHub sync needs an OAuth client ID in `.env.local`. The README has the
full walkthrough under **Setting up GitHub sync**. You can skip this for
local-only work; the app runs fine without it.

## Checks before you push

CI runs lint, typecheck, tests, and build on every push and PR
(`.github/workflows/ci.yml`). Run the same checks locally first:

```bash
npm run lint         # ESLint via Next.js
npm run typecheck    # tsc --noEmit
npm test             # Jest (~1879 tests)
npm run build        # production build
npm run prettier     # format all files
```

Run a single test file: `npx jest src/__tests__/markdownLivePreview.test.ts`

There are two end-to-end layers on top of the unit tests:

- `npm run e2e` drives Playwright through user-style flows.
- `npm run e2e:sync` runs the live sync harness (real clone/push/pull/
  round-trip against a test repo). It needs a token and is not part of
  the default loop; touch it only when you change sync logic.

See [`docs/testing.md`](./docs/testing.md) for the full testing process and
the rules every tester follows (unit + E2E).

If you changed `package.json` `overrides` or shifted a nested dependency,
run `rm -rf .next` before the next build so the Webpack cache does not keep
resolving the old module paths.

## Branch workflow

This repo uses branch-per-feature. Do not commit straight to `main`.

| Branch | Purpose |
|---|---|
| `main` | Production, deploys to noteser.app. PR-merge from `dev` or hotfix only. |
| `dev` | Integration / preview. Open feature PRs against this. |
| `feat/*`, `fix/*` | Feature and fix work. Branch off `dev`. |
| `hotfix/*` | Production emergencies. PR straight to `main`. |

1. Branch off `dev` (or `main` for a hotfix).
2. Make your change. Keep commits scoped and the message in the imperative
   ("Add wikilink autocomplete", not "added").
3. Run the checks above.
4. Open a PR against `dev`. The PR template asks what changed, why, and how
   you tested.

## Architecture

Start with these before a non-trivial change:

- [`README.md`](./README.md) — what the app is, the stack, how it runs.
- [`CLAUDE.md`](./CLAUDE.md) — store layout, the workspace/pane model,
  the GitHub sync pipeline, components map.
- [`docs/architecture.md`](./docs/architecture.md) — deeper architecture notes.
- [`docs/sync.md`](./docs/sync.md) — the three-way merge and sync flow.
- [`docs/security.md`](./docs/security.md) — threat model and hardening.
- [`docs/roadmap.md`](./docs/roadmap.md) — Now / Next / Later backlog.

## Opening a good issue

Use the issue templates (Bug report / Feature request). For bugs, include
steps to reproduce, browser/OS, and any console errors. Do not paste private
note contents or a GitHub token. For a security issue, do not open a public
issue — see [`SECURITY.md`](./SECURITY.md).

## Opening a good pull request

- One focused change per PR. Link the issue it closes.
- Confirm lint, typecheck, tests, and build pass locally.
- Add a screenshot or short clip for any UI change.
- Update docs or tests when behavior changes.

By contributing you agree your work is licensed under the project's
[MIT License](./LICENSE), and you agree to the
[Code of Conduct](./CODE_OF_CONDUCT.md).
