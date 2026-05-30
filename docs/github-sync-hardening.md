# GitHub sync hardening — findings and plan

Date: 2026-05-25. Written after Jon hit three issues on the **dev** environment while testing: (1) a fetch produced a "Sync from Noteser (60 changes)" commit (churn), (2) "Revert vault" stuck on "Rewinding…", (3) recurring "401 Bad credentials" on the source-control panel. Production (noteser.app) was not affected.

## What is already solid (do not re-litigate)

- The live sync harness (`npm run e2e:sync`, 15 scenarios) passes 15/15, **including** the anti-churn guards: non-canonical remote → zero pushes, no-churn sync, non-canonical `settings.json` not re-pushed, discard = pull-only (no commit), frontmatter round-trip suppressed.
- The token-refresh change merged to dev did **not** cause the churn: the pull path still only calls `runPull` (no push); it only wraps calls in token refresh.

So the sync *logic* is correct in synthetic scenarios. The dev issues come from (a) gaps the harness does not cover and (b) real-vault content the fixtures do not replicate.

## Symptom 1 — a fetch creates a commit (churn): real-vault byte normalization

**Root cause (hypothesis, well-supported):** the no-churn guard suppresses a re-push only when the client's re-serialized bytes match the remote blob. Jon's *real* vault contains a byte-level difference that the guard does not normalize away, so on a fresh clone every affected file looks "edited" and gets pushed. The 42-file / 65-add / 18-del pattern (small per file) is the signature of a systematic normalization difference, not real edits.

**Top suspects, in order:**
1. **Line endings** — CRLF vs LF. Classic cause of "only whitespace changes" churn in the Obsidian Git plugin.
2. **Unicode NFC vs NFD** — macOS stores text/filenames as NFD; git/Linux use NFC. High probability here because Jon writes in **Greek**; accented/Greek characters differ byte-wise between NFD and NFC.
3. **Trailing newline / final-newline** added or stripped on serialize.
4. **Frontmatter formatting** — key order, quoting, list style, or an injected key.

**Fix direction:**
- **Diagnose first.** For one churned file, compare the remote blob bytes against the client's serialization byte-for-byte and identify the exact difference (eol? NFC/NFD? trailing newline?). Best done by adding a one-shot debug log to the push-decision path that records *why* each file is considered changed.
- **Preferred fix: do not re-serialize unedited notes.** Keep the exact bytes pulled from the remote and only re-serialize when the user genuinely edits the note body. The "changed?" check should compare against the last-pulled/pushed blob bytes, not a re-serialized form.
- **Normalize consistently** as defense in depth: normalize content + paths to Unicode **NFC** on read; add a `.gitattributes` with `* text=auto eol=lf` and `*.md text eol=lf`; standardize the trailing newline.
- **Regression-proof it:** add a harness fixture that replicates Jon's vault pattern (CRLF and/or NFD Greek content, his frontmatter shape) so scenario B (no-churn) catches it next time.

## Symptom 2 — "Revert vault" stuck on "Rewinding…"

**Root cause (confirmed in code):** `src/utils/revertToCommit.ts` fetches every `.md` blob **sequentially** (`for (… of mdPaths) { … await getBlobContent(…) }`, one GitHub round-trip each). On a real vault of dozens-to-hundreds of notes that is dozens-to-hundreds of serial requests, so the modal sits on "Rewinding…" for a long time. The modal's error handling is correct (try/catch/finally surfaces errors and clears busy), and Jon sees no error — so it is **slow, not failed**.

Secondary: the revert path (and file-history, gist publish, "list recent commits", "read ref") call `api.github.com` with the raw token and are **not** wrapped in `withTokenRefresh` (only `useGitHubSync`'s pull/push are). So if the token has expired, those surfaces 401 — which is also the source of the recurring "401 Bad credentials" in the source-control panel.

**Fix direction:**
- **Parallelize blob fetch** with a concurrency cap (e.g. 8–10 in flight) and show progress ("Fetching 23/180…"). This alone fixes the perceived hang.
- **Wrap all GitHub-read surfaces in `withTokenRefresh`**, not just sync/pull: revert, file history, gist, and the source-control panel's list-commits / read-ref. This closes the 401 gap everywhere, not just on sync.

## Symptom 3 — commit message shows `{{date}}` literally

The commit-message box renders the template `Sync from Noteser ({{date}})` without substituting `{{date}}`. Minor: substitute the template (date, and the change-count it already uses on commit) for display and on use, or drop the placeholder from the default.

## Prioritized plan

1. **Token-refresh coverage (small, high value, low risk).** Wrap revert / file-history / gist / list-commits / read-ref in the existing `withTokenRefresh`. Extends a tested mechanism; kills the recurring 401s. Add unit tests mirroring the existing refresh tests.
2. **Revert performance (small, low risk).** Parallelize blob fetch with a concurrency cap + progress indicator. No sync-correctness change.
3. **Churn (medium, needs care + Jon's vault).** Diagnose the exact byte difference on one of his churned files, then fix via byte-exact change detection (never re-serialize unedited notes) plus NFC + `eol=lf` normalization, and add a matching harness fixture. **Validate with the sync harness on a clone of his real vault before prod.**
4. **`{{date}}` template (tiny).** Substitute or remove.

Items 1, 2, 4 are device-independent and harness/test-verifiable. Item 3 needs a clone of Jon's actual vault to reproduce and the sync harness + his device before it ships. Nothing here should go to `main` (prod) without Jon's review on `dev` first.

## Sources

- Obsidian Git line-ending churn and `.gitattributes` / `core.autocrlf` fix: https://forum.obsidian.md/t/solving-git-sync-issues-caused-by-different-system-line-endings/92253
- macOS NFC vs NFD Unicode normalization causing spurious git changes: https://www.git-tower.com/help/guides/faq-and-tips/faq/unicode-filenames/mac
- Real-world NFD vs NFC normalization bug (analogous): https://github.com/navidrome/navidrome/issues/4663
