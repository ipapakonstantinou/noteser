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
npm run test:watch   # Jest in watch mode
npm run test:coverage
```

Run a single test file: `npx jest src/__tests__/useNotesStorage.test.js`

## Architecture

**Next.js 15 / React 19 app** — single-page layout in `src/app/page.tsx` composed of a collapsible `<Sidebar>` and an `<Editor>`, with modals rendered at the root level.

### State management (Zustand)

All state lives in `src/stores/`. Each store uses `zustand/middleware/persist` to write to `localStorage` under the key prefix `noteser-*`:

| Store | Key | What it holds |
|---|---|---|
| `useNoteStore` | `noteser-notes` | Notes array, selectedNoteId |
| `useFolderStore` | `noteser-folders` | Folders, activeFolderId, expandedFolders |
| `useTagStore` | `noteser-tags` | Tags array |
| `useUIStore` | `noteser-ui` | Sidebar state, preview mode, modals, current view |
| `useCollaborationStore` | (no persist) | Yjs presence/room state in memory |

**Hydration pattern:** Persisted stores cause SSR/client mismatches. Use the `useHydration()` hook (returns `false` until `useEffect` fires) to defer rendering of persisted values.

### Components

- `src/components/sidebar/` — `Sidebar`, `FolderTree`, `ContextMenu`
- `src/components/editor/` — `Editor`, `EditorHeader`, `EditorContent`, `CollaboratorAvatars`
- `src/components/modals/` — `SearchModal`, `DeleteConfirmModal`, `ShortcutsModal`, `TemplatesModal`, `ExportModal`
- `src/components/ui/` — generic primitives (`Button`, `Input`, `Modal`, `Badge`, `EmptyState`)
- `src/components/shared/` — `EditableText`

### Data model

Defined in `src/types/index.ts`. Key types: `Note`, `Folder`, `Tag`, `Template`, `User`, `Presence`. Notes support soft-delete (`isDeleted` / `deletedAt`), pinning, and folder/tag associations. Both `Note.id` and `Folder.id` are UUID strings.

### Collaboration (Yjs)

`useCollaboration` and `useLocalCollaboration` in `src/hooks/useCollaboration.ts` wrap Yjs (`y-websocket` + `y-indexeddb`). The default WebSocket server points to `wss://demos.yjs.dev`. Collaboration state (rooms, presence) lives in `useCollaborationStore` which is not persisted.

### Search

`src/utils/search.ts` uses Fuse.js with a singleton index. The index is lazily rebuilt when the notes hash changes. Title is weighted 0.7, content 0.3, tags 0.2.

### Export / import

`src/utils/export.ts` handles markdown, JSON, and HTML export using `file-saver` and `jszip`.

### Styling

Tailwind CSS with a custom Obsidian-inspired dark palette defined in `tailwind.config.js` (`obsidianBlack`, `obsidianGray`, `obsidianText`, etc.). The `@tailwindcss/typography` plugin is used for rendered Markdown.

### Data migration

`src/app/page.tsx` runs `migrateOldData()` on mount to upgrade data from the pre-TypeScript localStorage keys (`notes`, `folders`) to the current versioned format (`noteser-notes` v2, `noteser-folders` v2).

### Path alias

`@/` maps to `src/` (configured in `tsconfig.json`).
