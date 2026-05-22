# GitHub integration — gap analysis 2026-05-22

User brief (Telegram): "We must do better the GitHub integration."
Sync engine itself is technically solid. The user-facing gaps are
around **history, sharing, and seeing what was synced**.

## Already shipped (don't reinvent)

- Pull / push pipeline with 3-way auto-merge + per-hunk conflict editor (`githubSync.ts`, `MergeEditorView.tsx`)
- Merge-batch summary for ≥3 conflicts (`MergeBatchView.tsx`)
- VS Code-style Source Control panel with A/M/D tree + commit message textarea (`SourceControlPanel.tsx`)
- Editor gutter diff (green/yellow lines vs last push, `diffGutter.ts`)
- AI-drafted commit messages (Settings → AI toggle)
- Auto-sync on startup + periodic interval (`useAutoSync.ts`); pull-only-on-startup mode
- Reset-to-remote escape hatch (`resetToRemote.ts`)
- Vault encryption (PBKDF2 + AES-GCM) on push/pull
- Vault settings sync (`.noteser/settings.json`); `.gitignore` overlay editor
- Typed `GitHubAPIError`, 403 + rate-limit retry, telemetry
- Zipball fast path for first-clone
- In-tab upload SHA cache for partial-failure recovery
- Push progress callbacks ("uploading 47/200 blobs")

## Candidate improvements

| # | Candidate | Severity | Build cost | Notes |
|---|---|---|---|---|
| 1 | Per-note commit history + restore | High | Medium | Directly answers "give me the note from 3 days ago" |
| 2 | Publish as Gist | Med-High | Small | Same token, same CORS pattern; needs `gist` OAuth scope |
| 3 | Commit log panel in Source Control | Medium | Small | Completes the "feels like VS Code" arc |
| 4 | Branch switching | Medium | Medium-Large | Re-seeds whole vault; data model not ready |
| 5 | Link note to GitHub Issue | Low | Medium | Niche; can paste URL today |
| 6 | GitHub Actions status badge | Low | Small | Informational only |
| 7 | Selective per-file staging | Low | Large | Fights single-commit-per-sync abstraction |
| 8 | Diff-vs-last-commit on github.com | Low | Tiny | Already reachable via `html_url` |

## Recommended next 2–3

### Pick 1 — Per-note commit history + one-click restore (HIGH)

The single most-requested "I wish I had this" moment. Edit a note for a week, realize you deleted a paragraph three days ago, no path back without cloning the repo locally.

- Endpoint: `GET /repos/{owner}/{repo}/commits?path={gitPath}&per_page=30` → list of `{sha, commit.message, commit.author.date, html_url}`.
- Then `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` for the historical content (or use `git/blobs` via the tree).
- Both calls Bearer-auth, no proxy — same pattern as the existing `getBlobContent`.

Files: new `src/utils/githubHistory.ts` (two thin helpers), a new `FileHistoryModal` under `src/components/modals/`, a "View history" item in the note context menu, a `restoreNoteToVersion` action somewhere. Guard the whole surface behind `note.gitPath != null`.

### Pick 2 — Publish note as GitHub Gist (MEDIUM-HIGH)

Smallest code change with a different user value: share a single note without making the whole vault public.

- `POST https://api.github.com/gists` with `{ public, files: { "<title>.md": { content } } }` → `{ html_url, id }`.
- Bearer auth, no proxy.
- **Caveat:** current OAuth scope is `repo` only. Adding `gist` requires either a re-auth prompt or bumping the device-flow scope to `repo gist`.

Files: `createGist` in `src/utils/github.ts` (~25 lines), context-menu item in `ContextMenu.tsx` or `ExportModal.tsx`. Decide on scope bump.

### Pick 3 — Commit log panel in Source Control (MEDIUM)

Rounds out the source-control sidebar: pending above, recent commits below.

- `GET /repos/{owner}/{repo}/commits?per_page=15`.
- Extend `SourceControlPanel.tsx` with a `RecentCommits` sub-component. Render short SHA + message + relative time. Click → open `html_url`.
- ~80 lines.

## Researched but NOT recommended right now

**Branch switching.** Niche; would require re-seeding the whole vault since `gitPath`/`gitLastPushedSha` are scoped to one branch. Skip until the data model is refactored.

**Issues / PRs / Actions / Discussions integration.** Product-feature integration, not note-feature. UI complexity with low activation rate. Users can paste an issue URL as a wikilink today.

**Selective per-file staging.** Fights noteser's single-commit-per-sync abstraction. High build cost; the target user doesn't think in git hunks.

## Sources

- [Obsidian Git plugin (Vinzent03)](https://github.com/Vinzent03/obsidian-git)
- [GitHub REST — Commits](https://docs.github.com/en/rest/commits/commits)
- [GitHub REST — CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)
- [Version History Diff plugin (kometenstaub)](https://github.com/kometenstaub/obsidian-version-history-diff)
- noteser internal: `docs/research/obsidian-reddit-insights.md`, `docs/sync.md`, `docs/roadmap.md`
