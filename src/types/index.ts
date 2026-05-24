// Core data types for Noteser

export interface Note {
  id: string
  title: string
  content: string
  folderId: string | null
  // Note: tags are derived from `#word` patterns in `content` via
  // src/utils/tags.ts. The legacy `tags: string[]` field was removed; old
  // localStorage data may still carry it but new code does not read it.
  createdAt: number
  updatedAt: number
  isDeleted: boolean
  deletedAt: number | null
  isPinned: boolean
  templateId: string | null
  // GitHub sync tracking — set after a successful push, used to detect
  // renames/moves on the next sync (delete old path, write new).
  gitPath?: string | null
  // Blob SHA of the CANONICAL LOCAL bytes for this note — i.e.
  // `gitBlobSha(serializeNote(note))`. Pull compares the freshly-computed local
  // blob SHA against this to decide whether the LOCAL side changed:
  //   match + remote unchanged  → unchanged
  //   match + remote changed    → take remote (remoteUpdated)
  //   mismatch + remote unchanged → push (no conflict)
  //   mismatch + remote changed → 3-way merge / conflict
  // IMPORTANT: this must equal `gitBlobSha(serializeNote(note))` for an
  // untouched, in-sync note. It describes bytes the app can reproduce, NOT the
  // raw remote file (which may carry frontmatter we strip on apply). See
  // gitRemoteBaseSha below for the actual remote blob used as a merge ancestor.
  gitLastPushedSha?: string | null
  // Blob SHA of the actual REMOTE blob this note last synced against — the
  // three-way merge ANCESTOR, fetchable via getBlobContent. This is distinct
  // from gitLastPushedSha because a remote `.md` that arrives with YAML
  // frontmatter is stored locally in a TRANSFORMED form (frontmatter stripped,
  // tags inlined as `#tag`), so the canonical local bytes hash to a different
  // SHA than the raw remote file. After a push the two coincide (the remote
  // file IS serializeNote(note)); after a pull they differ for frontmatter
  // notes. Undefined on notes synced before this field existed — the classifier
  // falls back to gitLastPushedSha for them until their next sync rewrites both.
  gitRemoteBaseSha?: string | null
  // Stable room identity for live collaboration (Phase B). Generated
  // lazily the first time a note enters a collab session (see
  // ensureCollabId in noteStore) and used as the y-websocket room name.
  // Decoupled from `id`/`title`/`gitPath` on purpose so a shared room
  // survives note renames and folder moves. Optional: notes persisted
  // before this field existed (and notes that never collaborated) simply
  // don't carry it — the field rides along the existing v2 persisted shape
  // with no migration needed. Only meaningful when collaboration is
  // enabled via NEXT_PUBLIC_YJS_WS_URL.
  collabId?: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
  isDeleted: boolean
  deletedAt: number | null
  order: number
}

export interface Tag {
  id: string
  name: string
  color: string
  createdAt: number
}

export interface Template {
  id: string
  name: string
  content: string
  description: string
  icon: string
  createdAt: number
}

export interface SearchResult {
  noteId: string
  title: string
  content: string
  matches: readonly {
    indices: readonly [number, number][]
    value?: string
    key?: string
  }[]
  score: number
}

export interface ExportOptions {
  format: 'markdown' | 'json' | 'html' | 'pdf'
  includeMetadata: boolean
  includeTags: boolean
}

export interface ImportResult {
  success: boolean
  notesImported: number
  foldersImported: number
  errors: string[]
}

export type ContextMenuState = {
  x: number
  y: number
  type: 'note' | 'folder' | 'tag'
  id: string
} | null

export interface ModalState {
  type: 'delete' | 'template' | 'export' | 'import' | 'settings' | 'shortcuts' | 'github-auth' | 'github-repo' | 'task-edit' | 'command-palette' | 'bug-report' | 'ai-result' | 'vault-settings-conflict' | 'file-history' | 'publish-gist' | 'vault-encryption' | 'revert-to-commit' | 'local-folder-import' | 'discard-local-changes' | null
  data?: Record<string, unknown>
}

export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string
}

// A repo selected as the sync target. 1 vault = 1 repo, notes at the repo root.
export interface SyncRepo {
  owner: string
  name: string
  branch: string
  isPrivate: boolean
}

export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  private: boolean
  default_branch: string
  updated_at: string
}

// Keyboard shortcuts
export interface Shortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  description: string
  action: string
}

// Default templates
export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'Template for meeting notes with attendees and action items',
    icon: '📋',
    content: `# Meeting Notes

## Date
${new Date().toLocaleDateString()}

## Attendees
-

## Agenda
1.

## Discussion Points


## Action Items
- [ ]

## Next Steps

`,
    createdAt: Date.now()
  },
  {
    id: 'daily-journal',
    name: 'Daily Journal',
    description: 'Daily journal entry template',
    icon: '📔',
    content: `# Daily Journal - ${new Date().toLocaleDateString()}

## How am I feeling today?


## What am I grateful for?
1.
2.
3.

## Goals for today
- [ ]
- [ ]
- [ ]

## Reflections


## Tomorrow's priorities

`,
    createdAt: Date.now()
  },
  {
    id: 'project-plan',
    name: 'Project Plan',
    description: 'Template for planning a new project',
    icon: '🚀',
    content: `# Project: [Project Name]

## Overview
Brief description of the project.

## Goals
-

## Timeline
| Phase | Start | End | Status |
|-------|-------|-----|--------|
| Planning | | | |
| Development | | | |
| Testing | | | |
| Launch | | | |

## Resources Needed
-

## Risks & Mitigation


## Success Metrics


## Notes

`,
    createdAt: Date.now()
  },
  {
    id: 'todo-list',
    name: 'Todo List',
    description: 'Simple todo list template',
    icon: '✅',
    content: `# Todo List

## High Priority
- [ ]

## Medium Priority
- [ ]

## Low Priority
- [ ]

## Completed
- [x]

`,
    createdAt: Date.now()
  },
  {
    id: 'weekly-review',
    name: 'Weekly Review',
    description: 'Auto-generated from the last 7 days — open tasks, done tasks, top tags',
    icon: '🗓️',
    // Content is computed at click time from the current notes — the
    // TemplatesModal swaps in `buildWeeklyReview(...)` output before
    // creating the note. This static string is the fallback used when
    // the dynamic builder isn't available (e.g. in unit tests that
    // exercise the noteStore directly).
    content: '# Weekly Review\n\n_(no notes touched this week)_\n',
    createdAt: Date.now()
  },
  {
    id: 'blank',
    name: 'Blank Note',
    description: 'Start with a clean slate',
    icon: '📝',
    content: '',
    createdAt: Date.now()
  }
]

// Default tag colors
export const TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
]

// Keyboard shortcuts configuration
export const KEYBOARD_SHORTCUTS: Shortcut[] = [
  { key: 'k', ctrl: true, description: 'Open search', action: 'openSearch' },
  { key: 'n', alt: true, description: 'New note', action: 'newNote' },
  { key: 'n', ctrl: true, shift: true, description: 'New folder', action: 'newFolder' },
  { key: 's', ctrl: true, description: 'Save note', action: 'saveNote' },
  { key: 'e', ctrl: true, description: 'Toggle preview', action: 'togglePreview' },
  { key: 'b', ctrl: true, description: 'Toggle sidebar', action: 'toggleSidebar' },
  { key: '/', ctrl: true, description: 'Show shortcuts', action: 'showShortcuts' },
  { key: 'Delete', ctrl: true, description: 'Delete note', action: 'deleteNote' },
  { key: 'z', ctrl: true, description: 'Undo', action: 'undo' },
  { key: 'z', ctrl: true, shift: true, description: 'Redo', action: 'redo' },
  { key: '7', ctrl: true, shift: true, description: 'Insert numbered list', action: 'insertNumberedList' },
  { key: 't', ctrl: true, shift: true, description: 'Insert todo item', action: 'insertTodo' },
]
