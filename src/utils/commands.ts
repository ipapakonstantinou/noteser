/**
 * commands.ts
 *
 * The command palette feeds off a single flat `Command[]` list. We assemble
 * that list lazily each time it's requested so the contents always reflect
 * the current state of every store (which shortcuts are bound, whether
 * GitHub is connected, what notes exist, …).
 *
 * Three sources are mixed:
 *   1. Every entry in SHORTCUTS — each shortcut already has an id, label,
 *      and active combo, and the keyboard hook already knows how to dispatch
 *      its action. We just call the same dispatcher here so behaviour is
 *      identical whether the user hits the key or picks the row.
 *   2. Hand-coded extras that don't belong in SHORTCUTS — "Open Settings",
 *      "Connect / Disconnect from GitHub", "Sync now", "Reset all settings"…
 *      These appear/disappear based on the current state (e.g. "Sync now"
 *      only when a repo is connected).
 *   3. Every active note rendered as "Open: <title>" so the palette doubles
 *      as a note picker (Obsidian-style). Capped to keep memory bounded on
 *      large vaults.
 */

import { useUIStore } from '@/stores/uiStore'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGitHubStore } from '@/stores/githubStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  SHORTCUTS,
  activeComboFor,
  comboToDisplay,
  type ShortcutDef,
} from '@/utils/shortcuts'

export interface Command {
  id: string
  label: string
  description?: string
  /** Extra fuzzy-match tokens (synonyms, related verbs). The palette feeds
   *  these to Fuse so e.g. "git" finds "Sync now". */
  keywords?: string[]
  /** Human-readable accelerator like "Ctrl+Shift+P". Optional. */
  combo?: string
  /** Display group. Defaults to "Commands". Notes use "Notes". */
  group?: string
  run(): void | Promise<void>
}

/** Max number of notes added to the command list. Keeps the Fuse index
 *  bounded for very large vaults. */
export const MAX_NOTE_COMMANDS = 500

/** Build the command list. Pure function over the current store snapshots.
 *  Each call returns a fresh array — cheap enough that we don't bother
 *  memoising; the palette only calls this when it opens or filters. */
export function getAllCommands(): Command[] {
  const out: Command[] = []

  // ── 1. SHORTCUTS-backed commands ───────────────────────────────────────
  const overrides = useSettingsStore.getState().shortcutOverrides
  for (const def of SHORTCUTS) {
    const combo = comboToDisplay(activeComboFor(def, overrides))
    out.push({
      id: `shortcut.${def.id}`,
      label: def.label,
      description: def.description,
      combo,
      group: 'Commands',
      run: () => dispatchShortcut(def),
    })
  }

  // ── 2. Hand-coded extras ──────────────────────────────────────────────
  const ui = useUIStore.getState()
  const github = useGitHubStore.getState()
  const isConnected = Boolean(github.token && github.user)

  out.push({
    id: 'app.openSettings',
    label: 'Open Settings',
    description: 'Show the Settings modal.',
    keywords: ['preferences', 'options', 'config'],
    group: 'Commands',
    run: () => ui.openModal({ type: 'settings' }),
  })

  out.push({
    id: 'app.openShortcutsModal',
    label: 'Open shortcuts modal',
    description: 'Show the keyboard-shortcuts cheat sheet.',
    keywords: ['keys', 'cheatsheet', 'help'],
    group: 'Commands',
    run: () => ui.openModal({ type: 'shortcuts' }),
  })

  out.push({
    id: 'app.openExport',
    label: 'Export notes',
    description: 'Open the export modal.',
    keywords: ['download', 'backup', 'markdown', 'json', 'html'],
    group: 'Commands',
    run: () => ui.openModal({ type: 'export' }),
  })

  out.push({
    id: 'app.reportBug',
    label: 'Report a bug',
    description: 'File a GitHub issue from inside Noteser.',
    keywords: ['issue', 'feedback', 'github', 'support'],
    group: 'Commands',
    run: () => ui.openModal({ type: 'bug-report' }),
  })

  out.push({
    id: 'app.openTemplates',
    label: 'Open templates',
    description: 'Browse templates and create a note from one.',
    keywords: ['template', 'snippet', 'boilerplate'],
    group: 'Commands',
    run: () => ui.openModal({ type: 'template' }),
  })

  out.push({
    id: 'app.togglePreview',
    label: 'Toggle preview',
    description: 'Toggle between live and rendered preview in the active editor.',
    keywords: ['render', 'view'],
    group: 'Commands',
    run: () => ui.togglePreview(),
  })

  // Periodic notes (week / month). Daily lives in SHORTCUTS as `openToday`.
  out.push({
    id: 'app.openThisWeek',
    label: 'Open this week (Weekly note)',
    description: 'Open or create this week\'s note.',
    keywords: ['weekly', 'periodic', 'review', 'week'],
    group: 'Commands',
    run: () => import('@/utils/periodicNotes').then(({ openThisWeekNote }) => { openThisWeekNote() }),
  })
  out.push({
    id: 'app.openThisMonth',
    label: 'Open this month (Monthly note)',
    description: 'Open or create this month\'s note.',
    keywords: ['monthly', 'periodic', 'review', 'month'],
    group: 'Commands',
    run: () => import('@/utils/periodicNotes').then(({ openThisMonthNote }) => { openThisMonthNote() }),
  })

  if (isConnected) {
    out.push({
      id: 'github.sync',
      label: 'Sync now',
      description: 'Pull from GitHub then push local changes.',
      keywords: ['git', 'push', 'pull', 'commit'],
      group: 'Commands',
      run: () => {
        // We dispatch a window event the sidebar listens for so we don't
        // have to recreate the full useGitHubSync hook outside of React.
        if (typeof window !== 'undefined') {
          import('@/utils/events').then(({ SYNC_REQUEST_EVENT }) => {
            window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
          })
        }
      },
    })
    out.push({
      id: 'github.disconnect',
      label: 'Disconnect from GitHub',
      description: 'Forget the current GitHub session and sync repo.',
      keywords: ['logout', 'sign out', 'git'],
      group: 'Commands',
      run: () => github.disconnect(),
    })
  } else {
    out.push({
      id: 'github.connect',
      label: 'Connect to GitHub',
      description: 'Authorize with GitHub to enable sync.',
      keywords: ['login', 'sign in', 'auth', 'git'],
      group: 'Commands',
      run: () => ui.openModal({ type: 'github-auth' }),
    })
  }

  out.push({
    id: 'app.resetSettings',
    label: 'Reset all settings',
    description: 'Restore every Settings value to its default. Irreversible.',
    keywords: ['defaults', 'wipe'],
    group: 'Commands',
    run: () => useSettingsStore.getState().reset(),
  })

  // ── 3. Notes as "Open: <title>" commands ──────────────────────────────
  const activeNotes = useNoteStore.getState().notes.filter(n => !n.isDeleted)
  // Most-recently-updated first — that's likely what the user wants when
  // they don't type a query yet.
  const sorted = activeNotes.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  for (const note of sorted.slice(0, MAX_NOTE_COMMANDS)) {
    out.push({
      id: `note.${note.id}`,
      label: `Open: ${note.title || 'Untitled Note'}`,
      keywords: [note.title || 'Untitled Note'],
      group: 'Notes',
      run: () => useWorkspaceStore.getState().openNote(note.id, { preview: false }),
    })
  }

  return out
}

/** Mirror the dispatch logic in useKeyboardShortcuts so picking a row in the
 *  palette behaves exactly like pressing the bound combo. Kept in sync with
 *  the switch in the hook — when a new ShortcutAction is added there it
 *  must be added here too (TypeScript's exhaustiveness check on the union
 *  catches any miss at build time). */
function dispatchShortcut(def: ShortcutDef): void | Promise<void> {
  const ui = useUIStore.getState()

  switch (def.action) {
    case 'newNote': {
      const note = useNoteStore.getState().addNote({ folderId: null })
      useWorkspaceStore.getState().openNote(note.id, { preview: false })
      return
    }
    case 'openSearch':
      ui.openSearch()
      return
    case 'toggleSidebar':
      ui.toggleSidebar()
      return
    case 'togglePreview':
      ui.togglePreview()
      return
    case 'newFolder':
      useFolderStore.getState().addFolder({ parentId: null })
      return
    case 'deleteNote': {
      const id = useNoteStore.getState().selectedNoteId
      if (!id) return
      ui.openModal({ type: 'delete', data: { type: 'note', id } })
      return
    }
    case 'openToday':
      return import('@/utils/dailyNotes').then(({ openTodayNote }) => {
        openTodayNote()
      })
    case 'focusSidebar': {
      if (typeof document !== 'undefined') {
        const tree = document.querySelector<HTMLElement>('[data-testid="folder-tree"]')
        tree?.focus()
      }
      return
    }
    case 'openCommandPalette':
      ui.openModal({ type: 'command-palette' })
      return
  }
}
