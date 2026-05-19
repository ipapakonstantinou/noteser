# GitHub sync

A deep dive into how noteser syncs with GitHub. For the user-facing
overview, see [`user-guide.md`](./user-guide.md#github-sync). For the
top-level architecture, see [`architecture.md`](./architecture.md).

## Goals

- Use any GitHub repo (public or private) as a vault.
- Round-trip cleanly with hand edits (commits made via the GitHub web
  editor, another Obsidian client, or a CLI all merge correctly).
- One commit per sync. No noisy per-note commits.
- Three-way merge that resolves changes on one side automatically, and
  flags only true line-level conflicts to the user.

## OAuth: device flow with a thin proxy

GitHub's OAuth Device Flow endpoints
(`https://github.com/login/device/code` and
`/login/oauth/access_token`) do not return CORS headers, so the browser
can't call them directly. We proxy through two thin Next.js API routes:

- `src/app/api/github/device-code/route.ts` — forwards the
  `client_id` + `scope` request, returns the device code + user code.
- `src/app/api/github/access-token/route.ts` — polls the access-token
  endpoint until the user has approved the code.

Both routes:

- Live server-side (no token persisted in the route handler).
- Apply per-IP rate limiting via `src/utils/rateLimit.ts` to stop abuse.
- Forward the JSON verbatim; no shaping.

Once the access token is in hand, all subsequent calls go **direct from
the browser to `api.github.com`** — which IS CORS-friendly. The token
lives in `localStorage` under `noteser-github`; same trust model as the
Obsidian Git plugin.

## Sync pipeline

`useGitHubSync()` (`src/hooks/useGitHubSync.ts`) is the user-facing
entry point. One **Sync** click runs this pipeline:

```
┌─────────────────┐
│ 1. Pull         │  fetch ref → commit → tree → classify each .md
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. Apply        │  non-conflict outcomes applied locally:
│    non-conflicts│   remoteCreated → create note + folders
│                 │   remoteUpdated → patch note content
│                 │   remoteDeleted → soft-delete note
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Conflicts?   │  if yes: open one merge-tab per conflicting file;
│                 │  pause sync until all are resolved
└────────┬────────┘
         │ (all resolved)
         ▼
┌─────────────────┐
│ 4. Push         │  diff local notes vs last-pushed SHAs;
│                 │  create blobs/tree/commit; fast-forward branch
└─────────────────┘
```

## 1. Pull and classify

`pullFromGitHub()` in `src/utils/githubSync.ts` walks the Git Data API:

1. `getBranchRefSha(branch)` → commit SHA at the tip.
2. `getCommitTreeSha(commitSha)` → root tree SHA.
3. `getTreeMap(treeSha)` → recursive flat map of `path → blob SHA` for
   every entry in the tree.
4. For each `.md` blob, fetch its content (`getBlobContent`) and
   `parseNote()` it (split frontmatter from body if present).
5. Compare every remote `.md` against the local note set (matched by
   `gitPath`) and classify.

Six `PullClassification` kinds — the union type lives at
`src/utils/githubSync.ts:113`:

| Kind | Local state | Remote state | Action |
| --- | --- | --- | --- |
| `unchanged` | identical | identical | skip |
| `remoteCreated` | absent | present | create note locally |
| `remoteUpdated` | present, not edited since last push | present, changed | overwrite local |
| `remoteDeleted` | present, not edited since last push | absent | soft-delete locally |
| `conflict` | present, edited since last push | present, also changed | open merge tab |
| `conflictDeleted` | present, edited since last push | absent (was deleted remotely) | open merge tab with deletion choice |

The classification key is `Note.gitLastPushedSha` — the blob SHA we
recorded the last time we pushed this note. If the local content's blob
SHA matches `gitLastPushedSha`, the local side is "untouched since last
push" and the remote can win without prompting. If both sides differ
from `gitLastPushedSha`, it's a true conflict.

## 2. Apply non-conflicts

`applyNonConflicts(classifications)` in `src/utils/syncApply.ts` walks
the classification list and applies the deterministic ones in a single
pass:

- For `remoteCreated`: `ensureFolderPath(segments)` creates the folder
  tree from the file's path components, then `addNote` with the parsed
  title and body. Tags inline-injected if the frontmatter declared them
  (`bodyWithInlineTags`) so the body is the source of truth (matches the
  "tags derive from `#word` in body" convention).
- For `remoteUpdated`: `updateNote(id, { content: remoteContent })`.
- For `remoteDeleted`: soft-delete (set `isDeleted: true`, `deletedAt`).

`conflict` and `conflictDeleted` are left for the user.

## 3. Conflict resolution UI

Each conflict becomes a `merge-conflict` tab via
`useWorkspaceStore.openMergeConflict(conflict)`. The tab renders
`<MergeEditorView>` (`src/components/editor/MergeEditorView.tsx`) which:

- Runs `lineDiff(localContent, remoteContent)` from
  `src/utils/lineDiff.ts` — a Myers-style line diff that groups changes
  into hunks.
- Renders each hunk with three buttons: **Accept Yours**, **Accept
  Theirs**, **Keep Both** (stacks remote-after-local).
- Once every hunk has a chosen side, the tab's footer **Apply** button
  calls `applyConflictResolution()` (or `applyMergedConflict` for the
  edited-text case) which writes the merged content back to the note.

When the **last** merge tab is closed, `MergeEditorView` fires the
`noteser:sync-request` custom event (see `src/utils/events.ts`). The
sidebar listens for it and re-runs sync without the user clicking Sync
again. This makes "resolve conflicts, push" feel like one continuous
action.

## 4. Push

`syncToGitHub(input)` builds a single commit:

1. For each non-deleted local note, compute its target `gitPath` and
   serialize it with `serializeNote()`. Frontmatter is only emitted if
   the note has tags (avoids noise on tag-less notes).
2. Compute the blob SHA *client-side* via `gitBlobSha(content)` — uses
   the same `blob <length>\0<content>` SHA-1 algorithm Git uses
   internally. This lets us detect "content identical to remote" without
   uploading.
3. Diff against the remote tree map from step 1 of the pull. For
   every changed blob:
   - `createBlob(content)` → returns the SHA.
   - (Otherwise reuse the existing SHA.)
4. `createTree(entries, baseTreeSha)` builds the new root tree.
5. `createCommit(message, treeSha, parentSha)` creates the commit on top
   of the parent we pulled.
6. `updateBranchRef(commitSha)` fast-forwards the branch.

The commit SHA is stored back in `useGitHubStore.lastCommitSha` and each
pushed note's `gitLastPushedSha` is updated to its new blob SHA. Those
two fields are what the next sync's classification uses to detect
"untouched since last push".

The push step is best-effort idempotent: if any GitHub call fails
mid-batch, the local notes are unchanged and the user can re-Sync. We
don't write half a commit — the tree → commit → ref steps each either
fully succeed or get retried on next attempt.

## Failure modes and limits

- **Rate limits**: `api.github.com` allows 5 000 authenticated requests
  per hour. A heavy first-time pull on a large vault can spike usage;
  the proxy routes' per-IP limiter cuts off abuse early.
- **Large vaults**: every `.md` blob is fetched individually. There's a
  zipball-based shortcut (`pullFromZipball`) for the create-from-empty
  case — see `src/utils/githubSync.ts:257`. The incremental sync path
  is still per-blob.
- **Network partial-failures**: pull is atomic from the user's POV (we
  classify then apply in one pass); push is best-effort idempotent.
- **Same-line conflicts**: detected by line-diff, not character-diff.
  Two edits to the same line always conflict; two edits to different
  lines never do, even when very close in the file.

## Security notes

- The OAuth token in `localStorage` is exfiltratable by any XSS in the
  rendered markdown. We sanitize the rendered HTML via react-markdown's
  default sanitizer, but custom renderers (wikilinks, ```tasks fences)
  must be audited any time they're touched.
- The proxy routes are unauthenticated by design — they need to be
  callable before the user has a token. Per-IP rate limiting + minimal
  attack surface (literally just forwards JSON) keeps this acceptable
  for a personal-vault model. NOT acceptable for a hosted multi-user
  deployment without further hardening.
- Three-way-merge correctness depends on `gitLastPushedSha` being
  accurate. If the localStorage state is wiped or transferred without
  it, the next sync will conservatively treat every local note as
  "potentially edited since last push" — meaning every coincident remote
  change becomes a conflict, not an auto-merge. Annoying but safe.

## Where the tests live

- `src/__tests__/lineDiff.test.ts` — covers the line-diff core. Most
  important sync-adjacent test we have today.
- `src/__tests__/tasks.test.ts` — covers the task helpers that the
  sync round-trips touch (`extractTasks`, `toggleTaskLine`,
  `toggleTaskLineText`, `removeTaskPrefixFromLine`).
- Open backlog: tests for `pullFromGitHub` (mock the GitHub API layer
  and feed canned tree+blob responses) and `applyNonConflicts` (assert
  store mutations for each classification kind). Tracked in
  [`roadmap.md`](./roadmap.md) under "Test coverage".
