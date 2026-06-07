# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on http://localhost:3001
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run prettier     # Format all files
npm test             # Run Jest tests
```

Run a single test file: `npx jest src/__tests__/markdownLivePreview.test.ts`

After changing `package.json` `overrides` (or any dependency shift that deduplicates a nested package), run `rm -rf .next` before the next `npm run build` / `npm run dev`. The Webpack cache stores resolved module paths and will keep looking for the old nested location (e.g. `node_modules/refractor/node_modules/prismjs/...`) until it is cleared.

## Architecture

**Next.js 15 / React 19 app.** Single-page layout in `src/app/page.tsx`: a `<Sidebar>` on the left, the `<Editor>` (which renders 1–2 panes of tabs) on the right, modals at the root.

### Implemented feature surface (don't re-propose these as "missing")

This file historically undersold the product. The following are **already
shipped** — verify against the code before adding any of them to a backlog:

- **Block references** `^block-id` — `src/utils/blockRef.ts`
- **Note aliases** + alias-aware wikilink resolution — `src/utils/aliases.ts`, `src/components/editor/linksLivePreview.tsx`
- **Backlinks panel** — `src/components/sidebar/BacklinksView.tsx` (right sidebar). NOTE: a force-directed **graph view** is NOT yet built.
- **Bases / properties** — query blocks + table views + frontmatter UI: `src/utils/basesQuery.ts`, `src/components/editor/BasesBlock.tsx`, `basesLivePreview.tsx`, `FrontmatterPanel.tsx`, `src/components/sidebar/PropertiesPanel.tsx`
- **Recurring tasks** (`🔁`) — `src/utils/recurrence.ts`, `src/components/modals/TaskEditModal.tsx`
- **Outline pane** — `src/utils/outline.ts`
- **Random note** — `src/utils/randomNote.ts`
- **Bookmarks / pinned notes** — in `useUIStore` / `useSettingsStore`
- **AI client + embeddings + semantic search** — `src/utils/aiClient.ts`, `src/utils/embeddings.ts`, `src/__tests__/semanticSearch.test.tsx`. NOTE: a conversational "chat / ask-your-notes" (RAG) UI on top of this is NOT yet built.
- **Plugin host** — `src/components/editor/PluginCodeBlock.tsx`, `src/components/modals/PluginsSettingsPanel.tsx`, `PluginInstallConfirmModal.tsx`
- **Local-folder sync** (File System Access API) — `src/utils/localFolderSync.ts`, `src/utils/fsaFs.ts` (alongside the GitHub sync)

### State management (Zustand)

All state lives in `src/stores/`. Most stores use `zustand/middleware/persist` to write to `localStorage` under the key prefix `noteser-*`:

| Store | Persist key | What it holds |
|---|---|---|
| `useNoteStore` | `noteser-notes` (v2) | `notes[]`, `selectedNoteId` |
| `useFolderStore` | `noteser-folders` (v2) | `folders[]`, `activeFolderId`, `expandedFolders` |
| `useTagStore` | `noteser-tags` | Legacy entity store — kept only because old data may reference it; new code derives tags from `#word` patterns in note bodies via `src/utils/tags.ts` |
| `useUIStore` | `noteser-ui` | Sidebar collapse/width, preview mode, modal state, current view, `renameRequest` |
| `useGitHubStore` | `noteser-github` | OAuth token, GitHub user, vault `syncRepo`, `lastCommitSha`, `lastSyncedAt` |
| `useWorkspaceStore` | `noteser-workspace` (v2) | `panes[]` (max 2 horizontal), `activePaneId`, `mergeAppliedCount`. Only note-kind tabs are persisted — merge-conflict tabs are point-in-time |

**Hydration pattern.** Persisted stores cause SSR/client mismatches. Use `useHydration()` (returns `false` until `useEffect` fires) to defer rendering of persisted values.

### Workspace, tabs, panes

- The editor area is one or two horizontal panes (`PaneState`), each with its own `tabs[]` and `activeTabId`.
- Tabs are either `note` (with `noteId` + `isPreview` for VS Code-style preview tabs) or `merge-conflict` (with one `conflict` payload).
- `openNote(noteId, { preview })`: single-click in sidebar opens as preview (italic); double-click pins; typing into the note auto-promotes preview → pinned via `promoteTab(tabId)`.
- `moveTab(tabId, toPaneId, toIdx)` handles drag-and-drop reorder + cross-pane move.
- `splitTabRight(tabId)` creates a second pane to the right with that tab.
- `pruneStaleTabs()` runs once after hydration to drop tabs whose underlying note was deleted.

### Components

- `src/components/sidebar/` — `Sidebar`, `FolderTree`, `CalendarView`, `ContextMenu`
- `src/components/editor/` — `Editor`, `Pane`, `TabBar`, `EditorHeader`, `EditorFooter`, `EditorContent`, `MergeEditorView`, `CodeMirrorEditor`, `markdownLivePreview`
- `src/components/modals/` — `SearchModal`, `DeleteConfirmModal`, `ShortcutsModal`, `TemplatesModal`, `ExportModal`, `GitHubAuthModal`, `GitHubRepoModal`
- `src/components/ui/` — `Button`, `Input`, `Modal`, `Badge`, `EmptyState`
- `src/components/shared/` — `EditableText` (controlled by `useUIStore.renameRequest`; no double-click-to-edit)

### Data model

`src/types/index.ts`. Key types: `Note`, `Folder`, `Tag`, `Template`, `SyncRepo`, `GitHubUser`, `GitHubRepo`. Notes carry soft-delete (`isDeleted`/`deletedAt`), pin (`isPinned`), and GitHub sync fields (`gitPath`, `gitLastPushedSha`). UUIDs for `Note.id` and `Folder.id`. The legacy `Note.tags: string[]` field is being phased out — new UI reads tags from `extractTags(content)` in `src/utils/tags.ts`.

### Tags (Obsidian-style)

Tags come from `#word` patterns in note bodies — they are NOT entity-stored. `src/utils/tags.ts` exposes `extractTags(content)` and `collectAllTags(notes)`. The sidebar Tags view aggregates from all active notes; the live-preview and rendered-preview both style `#tag` matches inline (`.cm-lp-tag` and `.preview-tag`).

### GitHub sync

Two thin Next.js API routes proxy the OAuth device-flow endpoints (which lack CORS): `src/app/api/github/device-code/route.ts` and `.../access-token/route.ts`. They forward the request to `github.com` and return the JSON; no token storage server-side.

Once authorized, the browser talks directly to `api.github.com` (CORS-friendly). `src/utils/github.ts` wraps the Git Data API; `src/utils/githubSync.ts` orchestrates pull-then-push:

1. **Pull**: fetch the branch ref → commit → tree (recursive) → classify each `.md` file:
   `unchanged`, `remoteCreated`, `remoteUpdated`, `remoteDeleted`, `conflict`, `conflictDeleted`. Three-way merge using `Note.gitLastPushedSha`.
2. **Apply non-conflicts** via `src/utils/syncApply.ts` (creates folders/tags, updates notes, soft-deletes).
3. **Conflicts** open as merge-tabs (one per file). `MergeEditorView` does VS Code-style inline merge with line diffs (`src/utils/lineDiff.ts`).
4. **Push**: serialize notes to `.md` (frontmatter only if tags present), compute git blob SHAs client-side, upload only changed blobs, create a single tree + commit, fast-forward the branch.

All wired together by `useGitHubSync` (`src/hooks/useGitHubSync.ts`). The MergeEditorView fires a `noteser:sync-request` event (`src/utils/events.ts`) when the user applies and the last merge tab closes, so the sidebar re-runs sync without needing a manual click.

### Drag-and-drop

- **Notes between folders** — tracked in `FolderTree` via React drag events.
- **Tabs between panes / to create split** — uses `TAB_DRAG_MIME = 'application/x-noteser-tab'`. `useTabDragActive()` listens window-level for that mime so drop zones only mount during an active drag (avoids intercepting unrelated clicks).

### Search

`src/utils/search.ts` uses Fuse.js with a singleton index, lazily rebuilt when notes hash changes. Title weighted 0.7, content 0.3, tags 0.2.

### Export / import

`src/utils/export.ts` handles markdown / JSON / HTML export via `file-saver` and `jszip`. `sanitizeFilename` (destination-side, also collapses whitespace) and `sanitizeTitleInput` (input-side, only strips filesystem-unsafe chars) both live here.

### Styling

Tailwind with an Obsidian-inspired dark palette in `tailwind.config.js` (`obsidianBlack`, `obsidianGray`, `obsidianText`, …). `@tailwindcss/typography` for rendered markdown (`.prose`). Live-preview CSS lives bundled in the CodeMirror extension via `EditorView.baseTheme` — see `src/components/editor/markdownLivePreview.ts`.

### Data migration

`src/app/page.tsx` runs `migrateOldData()` on mount to upgrade pre-TypeScript localStorage keys (`notes`, `folders`) to the versioned format (`noteser-notes` v2, `noteser-folders` v2). `useWorkspaceStore` has its own `migrate` (v1 → v2) that wraps the legacy flat `tabs[]` into a single pane.

### Path alias

`@/` maps to `src/` (configured in `tsconfig.json`).

### QA / Obsidian-parity testing

The `qa-tester` subagent (`.claude/agents/qa-tester.md`) drives Playwright through user-style flows defined in `e2e/obsidian-parity.md`. Invoke it after UI changes when you want a sanity sweep without driving the browser yourself. The agent writes specs into `e2e/parity/`, captures screenshots + traces on failure (already configured in `playwright.config.ts`), and reports in plain language. Graduating a parity spec into the main `e2e/` suite is a manual decision.

### Security notes

- OAuth token stored in `localStorage` — same trust model as Obsidian Git plugin. XSS would exfiltrate it.
- Real-time collaboration is opt-in only; `useCollaboration` doesn't connect anywhere unless `NEXT_PUBLIC_YJS_WS_URL` is set.
- The proxy API routes rate-limit per-IP (see `src/app/api/github/*`).
