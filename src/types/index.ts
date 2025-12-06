// Core data types for Noteser

export interface Note {
  id: string
  title: string
  content: string
  folderId: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
  isDeleted: boolean
  deletedAt: number | null
  isPinned: boolean
  templateId: string | null
  collaborators?: string[]
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

export interface User {
  id: string
  name: string
  email?: string
  color: string
  avatar?: string
}

export interface Presence {
  oderId: string
  name: string
  color: string
  cursor?: {
    line: number
    column: number
  }
  selection?: {
    start: number
    end: number
  }
  lastSeen: number
}

export interface CollaborationRoom {
  noteId: string
  users: Presence[]
  isConnected: boolean
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
  format: 'markdown' | 'json' | 'html'
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
  type: 'delete' | 'template' | 'export' | 'import' | 'settings' | 'shortcuts' | null
  data?: Record<string, unknown>
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
  { key: 'n', ctrl: true, description: 'New note', action: 'newNote' },
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
