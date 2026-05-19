# Architecture

How the code is organized and why. Read this before making non-trivial
changes. For Claude Code conventions specifically, see
[`CLAUDE.md`](../CLAUDE.md).

## Stack

- **Next.js 15** (App Router) + **React 19**.
- **TypeScript**, strict mode. Path alias `@/` → `src/`.
- **Zustand** for state. Five (functional) stores, each persisted to
  `localStorage` under a `noteser-*` key.
- **CodeMirror 6** for the editor (via `@uiw/react-codemirror`).
- **Tailwind CSS** with an Obsidian-inspired dark palette.
- **Jest** + `jest-environment-jsdom` for tests.
- **Vercel** for hosting (deploys auto-trigger on push to `main`).

## High-level shape

One page (`src/app/page.tsx`). On the left: `<Sidebar>` with folder tree,
calendar, tags view, ribbon, and search/menu modals. On the right:
`<Editor>` rendering 1–2 horizontal panes of tabs. Modals are rendered at
the root.

```
┌─────────────────────────────────────────────────────────┐
│ Sidebar         │ Editor                                 │
│ ┌─────────────┐ │ ┌──────────────────┬───────────────┐   │
│ │ Ribbon      │ │ │ Pane 1: tabs[]   │ Pane 2: tabs[]│   │
│ │ Folders     │ │ │                  │               │   │
│ │ Calendar    │ │ │ (active tab's    │               │   │
│ │ Tags        │ │ │  CodeMirror      │               │   │
│ │ Search      │ │ │  editor)         │               │   │
│ └─────────────┘ │ └──────────────────┴───────────────┘   │
└─────────────────────────────────────────────────────────┘
                  Modals overlay everything ↑
```

## State (Zustand stores)

All stores live in `src/stores/`. All persist to `localStorage` except
where noted.

| Store | Persist key (version) | Holds |
| --- | --- | --- |
| `useNoteStore` | `noteser-notes` (v2) | `notes[]`, `selectedNoteId` |
| `useFolderStore` | `noteser-folders` (v2) | `folders[]`, `activeFolderId`, `expandedFolders` |
| `useTagStore` | `noteser-tags` | Legacy entity store — kept only because old data may reference it; new code derives tags from `#word` patterns in note bodies via `src/utils/tags.ts` |
| `useUIStore` | `noteser-ui` | Sidebar collapse/width, preview mode, modal state, current view, `renameRequest` |
| `useGitHubStore` | `noteser-github` | OAuth token, GitHub user, vault `syncRepo`, `lastCommitSha`, `lastSyncedAt` |
| `useWorkspaceStore` | `noteser-workspace` (v2) | `panes[]` (max 2 horizontal), `activePaneId`, `mergeAppliedCount`. Only note-kind tabs are persisted — merge-conflict tabs are point-in-time |

### Hydration

Persisted stores cause SSR/client mismatches. Components that read
persisted state should call `useHydration()` (`src/hooks/useHydration.ts`)
which returns `false` until the first `useEffect` fires. Render a
skeleton until then.

### Migrations

Two layers:

1. **Pre-typed legacy keys**: `migrateOldData()` in `src/app/page.tsx`
   runs on mount, copies pre-TypeScript localStorage keys (`notes`,
   `folders`) into the versioned keys (`noteser-notes` v2,
   `noteser-folders` v2).
2. **Per-store migrations**: each Zustand `persist` config can declare a
   `migrate(persisted, version)` that bumps schema. `useWorkspaceStore`
   has a v1 → v2 (wraps the old flat `tabs[]` into a single pane).

## Workspace: panes and tabs

The editor area is 1 or 2 `PaneState` objects. Each pane has its own
`tabs[]` and `activeTabId`.

Tabs are typed:

- **`note` tab** — has `noteId` and `isPreview`. Preview tabs render the
  title in italic (VS Code convention). Typing into a preview note
  auto-promotes it to a pinned tab via `promoteTab(tabId)`.
- **`merge-conflict` tab** — has a `conflict` payload (the sync engine
  creates these; see [sync.md](./sync.md)).

Key actions on `useWorkspaceStore`:

- `openNote(noteId, { preview })`: single-click in sidebar passes
  `preview: true`, double-click passes `preview: false`.
- `moveTab(tabId, toPaneId, toIdx)`: drag-and-drop reorder + cross-pane.
- `splitTabRight(tabId)`: creates the second pane to the right with the
  given tab as its only one.
- `pruneStaleTabs()`: runs once after hydration to drop tabs whose
  underlying note was deleted.

## Editor (CodeMirror 6)

`src/components/editor/CodeMirrorEditor.tsx` mounts the editor view.
Extensions:

- `markdown({ base: markdownLanguage })` — syntax tree.
- `markdownLivePreview` — our custom StateField that styles markdown
  inline (headings size up, bold/italic markers hide when off-line,
  tasks render styled checkboxes, etc). See
  `src/components/editor/markdownLivePreview.ts`.
- `tasksLivePreview` — replaces ```tasks code fences with a React-rendered
  `TaskQueryBlock` widget. See `tasksLivePreview.tsx`.
- Custom `keymap` for `Ctrl+E` (toggle preview), `Alt+L` (task line
  toggle), `Alt+Shift+L` (check/uncheck with ✅ date).
- DOM event handlers for checkbox click toggle, Ctrl/Cmd+click wikilink
  navigation.

The rendered preview (`Ctrl+E`) is a separate React tree using
`react-markdown` + `remark-gfm`, with custom renderers for `code` (syntax
highlighting + `tasks` fence), `a` (wikilink resolver), and `li`
(checkbox click handler with date-stamping).

## Components

Grouped by area:

- `src/components/sidebar/` — `Sidebar`, `Ribbon`, `FolderTree`,
  `FolderTreeToolbar`, `CalendarView`, `ContextMenu`.
- `src/components/editor/` — `Editor`, `Pane`, `TabBar`, `EditorHeader`,
  `EditorFooter`, `EditorContent`, `MergeEditorView`, `CodeMirrorEditor`,
  `markdownLivePreview`, `tasksLivePreview`, `TaskQueryBlock`,
  `WikilinkAutocomplete`.
- `src/components/modals/` — `SearchModal`, `DeleteConfirmModal`,
  `ShortcutsModal`, `TemplatesModal`, `ExportModal`, `GitHubAuthModal`,
  `GitHubRepoModal`.
- `src/components/ui/` — `Button`, `Input`, `Modal`, `Badge`,
  `EmptyState`.
- `src/components/shared/` — `EditableText` (controlled by
  `useUIStore.renameRequest`; no double-click-to-edit — rename is always
  driven from the context menu or shortcut).

## Data model

`src/types/index.ts` holds the canonical types: `Note`, `Folder`, `Tag`,
`Template`, `SyncRepo`, `GitHubUser`, `GitHubRepo`. UUIDs for `Note.id`
and `Folder.id`.

Notes carry soft-delete (`isDeleted`/`deletedAt`), pin (`isPinned`), and
GitHub sync fields (`gitPath`, `gitLastPushedSha`). The legacy
`Note.tags: string[]` field is being phased out — new UI reads tags
from `extractTags(content)` in `src/utils/tags.ts`.

## Tags (derived, not stored)

Tags come from `#word` patterns in note bodies. They are NOT entity-
stored. `src/utils/tags.ts` exposes:

- `extractTags(content: string): string[]` — pulls every `#word` match.
- `collectAllTags(notes: Note[]): TagCount[]` — aggregates across notes,
  with counts.

The sidebar Tags view, the live preview's `#tag` styling, and the
rendered preview's `.preview-tag` spans all derive from these utilities.

## Tasks

`src/utils/tasks.ts`:

- `extractTasks(notes)` — returns all `- [ ]` / `- [x]` lines as
  `Task` objects. Currently `-` bullets only (intentional — that's the
  canonical Tasks listing).
- `toggleTaskLine(content, lineIdx, now?)` — whole-content toggle, used
  by `TaskQueryBlock`.
- `toggleTaskLineText(lineText, now?)` — single-line toggle, broader
  bullet set (`-`, `*`, `+`, numbered). Used by every checkbox click
  handler and `Alt+Shift+L`. Stamps ✅ date on check, strips it on
  uncheck — Obsidian Tasks-plugin format.
- `removeTaskPrefixFromLine(lineText)` — strips just the `- [ ]`
  prefix, keeps the body (incl. any ✅ date) intact. Powers
  `Alt+Shift+L` in preview mode.

`src/utils/taskQuery.ts` — the ```tasks fence parser + executor. Splits
the source into filter / group / option lines, applies them across
extracted tasks, returns grouped results for `TaskQueryBlock` to render.

## Drag-and-drop

- **Notes/folders in the sidebar** — handled in `FolderTree` via React
  drag events. The drop targets are folder rows.
- **Tabs between panes / to create a split** — uses
  `TAB_DRAG_MIME = 'application/x-noteser-tab'`. The
  `useTabDragActive()` hook listens window-level for that mime so
  drop zones only mount during an active drag (avoids intercepting
  unrelated clicks).

## Search

`src/utils/search.ts` uses **Fuse.js** with a singleton index, lazily
rebuilt when notes hash changes. Weights: title 0.7, content 0.3,
tags 0.2.

The `SearchModal` opens via `Ctrl+K`, debounces input, and renders the
top-N matches with a snippet.

## Export / import

`src/utils/export.ts` handles markdown / JSON / HTML export via
`file-saver` and `jszip`. Two filename-sanitizer functions live there:

- `sanitizeFilename(name)` — destination-side; collapses whitespace and
  strips filesystem-unsafe chars. Used on export.
- `sanitizeTitleInput(name)` — input-side; only strips filesystem-unsafe
  chars. Used when the user types a title.

## Styling

Tailwind with an Obsidian-inspired dark palette in `tailwind.config.js`
(`obsidianBlack`, `obsidianGray`, `obsidianText`, `obsidianAccentPurple`,
etc.). `@tailwindcss/typography` for rendered markdown (`.prose`).

Live-preview CSS is bundled in the CodeMirror extension via
`EditorView.baseTheme` — see `markdownLivePreview.ts`. This keeps the
extension self-contained and avoids globals.css load-order issues.

## Path conventions

- Path alias `@/` → `src/` (configured in `tsconfig.json` and Next.js).
- Tests in `src/__tests__/*.test.ts(x)`, co-located helpers inside the
  test file (no premature `test-utils/` abstraction).

## Where to read next

- [`sync.md`](./sync.md) — the GitHub sync pipeline, pull/merge/push,
  conflict resolution, three-way merge.
- [`user-guide.md`](./user-guide.md) — what users see; useful for
  understanding which surface a change will affect.
- [`CLAUDE.md`](../CLAUDE.md) — engineering conventions when working
  with Claude Code on this repo.
- [`agent-orchestration-research.md`](./agent-orchestration-research.md) —
  why the `.claude/orchestrator/` and `.claude/agents/` setup exists.
