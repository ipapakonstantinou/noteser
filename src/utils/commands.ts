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

  // Share — generate a self-contained URL for the currently-open note.
  // Available whenever the workspace has an active note.
  const ws = useWorkspaceStore.getState()
  const activePane = ws.panes.find(p => p.id === ws.activePaneId) ?? ws.panes[0]
  const activeTab = activePane?.tabs.find(t => t.id === activePane?.activeTabId)
  const activeNoteId = activeTab?.kind === 'note' ? activeTab.noteId : null
  if (activeNoteId) {
    out.push({
      id: 'app.shareNote',
      label: 'Copy share link for current note',
      description: 'Generate a self-contained read-only URL — no backend needed.',
      keywords: ['publish', 'public', 'share', 'link', 'url'],
      group: 'Commands',
      run: async () => {
        const note = useNoteStore.getState().notes.find(n => n.id === activeNoteId)
        if (!note) return
        const { encodeShareLink, estimateShareLinkSize } = await import('@/utils/shareLink')
        const url = encodeShareLink(note.title || 'Untitled', note.content ?? '')
        const sz = estimateShareLinkSize(note.title || '', note.content ?? '')
        if (sz > 8000 && !window.confirm(
          `This share URL will be roughly ${(sz / 1024).toFixed(1)} KB — some email clients and chat apps truncate long URLs. Copy anyway?`,
        )) return
        try {
          await navigator.clipboard.writeText(url)
          alert('Share link copied to clipboard. The URL itself contains the note — anyone with the link can read it.')
        } catch {
          window.prompt('Copy this share link:', url)
        }
      },
    })
  }

  // bc3v — Copy block ref for the current line in the focused editor.
  // Idempotent: appends a `^id` to the line only if one isn't there.
  if (activeNoteId) {
    out.push({
      id: 'app.copyBlockRef',
      label: 'Copy block ref for current line',
      description: 'Copy a [[Note#^block-id]] link to clipboard. Mints a fresh id if the line doesn\'t already end with one.',
      keywords: ['block', 'ref', 'anchor', '^', 'link', 'paragraph'],
      group: 'Commands',
      run: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('noteser:copy-block-ref'))
        }
      },
    })
  }

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

  // z0e6 — Note-level AI actions in the command palette. Gated on a
  // configured provider (no point listing them when AI is off) AND on
  // an active note in the workspace (each action needs a target).
  if (activeNoteId) {
    const aiProvider = useSettingsStore.getState().aiProvider
    if (aiProvider !== 'off') {
      // Lazy-imported so non-AI users don't pay the runNoteAIAction
      // module weight just for opening the palette.
      const dispatchAction = async (
        actionId: 'summarize' | 'extractTasks' | 'suggestTags' | 'rewriteClarity' | 'translate',
        extra?: string,
      ) => {
        const { runNoteAIAction } = await import('@/utils/runNoteAIAction')
        await runNoteAIAction({ actionId, noteId: activeNoteId, extraInput: extra })
      }
      const aiKeywords = ['ai', 'assistant', 'llm', 'gpt', 'claude']
      out.push({
        id: 'app.ai.summarize',
        label: 'AI: Summarize note',
        description: '3-5 sentence summary of the active note.',
        keywords: [...aiKeywords, 'summary', 'tldr'],
        group: 'AI',
        run: () => { void dispatchAction('summarize') },
      })
      out.push({
        id: 'app.ai.extractTasks',
        label: 'AI: Extract tasks',
        description: 'Pull actionable items out of the note as a markdown checklist.',
        keywords: [...aiKeywords, 'todo', 'tasks', 'action', 'items'],
        group: 'AI',
        run: () => { void dispatchAction('extractTasks') },
      })
      out.push({
        id: 'app.ai.suggestTags',
        label: 'AI: Suggest tags',
        description: 'Suggest 3-7 #tags based on the note content.',
        keywords: [...aiKeywords, 'tags', 'labels', 'categorize'],
        group: 'AI',
        run: () => { void dispatchAction('suggestTags') },
      })
      out.push({
        id: 'app.ai.rewriteClarity',
        label: 'AI: Rewrite for clarity',
        description: 'Rewrite the note for clearer, more concise prose without changing meaning.',
        keywords: [...aiKeywords, 'rewrite', 'edit', 'clarity', 'polish'],
        group: 'AI',
        run: () => { void dispatchAction('rewriteClarity') },
      })
      out.push({
        id: 'app.ai.translate',
        label: 'AI: Translate…',
        description: 'Translate the note into a target language you specify.',
        keywords: [...aiKeywords, 'translate', 'language', 'i18n'],
        group: 'AI',
        run: () => {
          const target = window.prompt('Translate into which language?', 'Spanish')
          if (!target) return
          void dispatchAction('translate', target)
        },
      })
    }
  }

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
