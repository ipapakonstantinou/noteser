/**
 * dailyNotes.test.ts
 *
 * openTodayNote should:
 *   - reuse an existing daily note if one matches the formatted date title
 *   - create a new note inside the configured folder otherwise
 *   - seed the new note's content from the configured template (when set)
 *
 * listTemplateNotes should:
 *   - return only notes whose folder path equals or is under the
 *     configured templates folder
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { openTodayNote, listTemplateNotes } from '../utils/dailyNotes'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useSettingsStore.setState({
    dailyNotesFolder: 'Notes/Daily',
    dailyNoteDateFormat: 'YYYY-MM-DD',
    templatesFolder: 'Templates',
    dailyNoteTemplateId: null,
  })
  // Reset workspace to a single empty pane.
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: null,
  })
})

describe('openTodayNote', () => {
  test('creates a new daily note in the configured folder when none exists', () => {
    const today = new Date(2026, 4, 19)
    openTodayNote(today)
    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('2026-05-19')
    // The daily-notes folder hierarchy should have been auto-materialised.
    // Default is "Notes/Daily" → two folders (parent "Notes", child "Daily").
    // The new note lives in the child.
    const folders = useFolderStore.getState().folders
    const parent = folders.find(f => f.name === 'Notes' && f.parentId == null)
    const child = folders.find(f => f.name === 'Daily' && f.parentId === parent?.id)
    expect(parent).toBeDefined()
    expect(child).toBeDefined()
    expect(notes[0].folderId).toBe(child!.id)
    // Workspace opened the new note.
    const pane = useWorkspaceStore.getState().panes[0]
    expect(pane.tabs).toHaveLength(1)
    expect(pane.activeTabId).toBe(pane.tabs[0].id)
  })

  test('reuses an existing daily note instead of creating a duplicate', () => {
    const today = new Date(2026, 4, 19)
    // First call creates.
    const firstId = openTodayNote(today)
    expect(useNoteStore.getState().notes).toHaveLength(1)
    // Second call must reuse.
    const secondId = openTodayNote(today)
    expect(secondId).toBe(firstId)
    expect(useNoteStore.getState().notes).toHaveLength(1)
  })

  test('seeds content from the configured template (by path) when set', () => {
    // Set up: a Templates folder + a template note + the setting pointing at
    // its stable repo path.
    const templateFolder = useFolderStore.getState().addFolder({ name: 'Templates' })
    useNoteStore.getState().addNote({
      title: 'Daily',
      folderId: templateFolder.id,
      content: '# Daily template\n\n- [ ] morning routine\n',
    })
    useSettingsStore.setState({ dailyNoteTemplatePath: 'Templates/Daily.md' })

    openTodayNote(new Date(2026, 4, 19))

    const created = useNoteStore.getState().notes.find(n => n.title === '2026-05-19')
    expect(created?.content).toBe('# Daily template\n\n- [ ] morning routine\n')
  })

  test('template still resolves after a sync changes the note id (the bug)', () => {
    // Reproduces the reported bug: a sync regenerates the template note's id.
    // A path-based reference must survive it; an id-based one would not.
    const templateFolder = useFolderStore.getState().addFolder({ name: 'Templates' })
    useNoteStore.getState().addNote({
      title: 'Daily',
      folderId: templateFolder.id,
      content: 'TPL-BODY',
    })
    useSettingsStore.setState({ dailyNoteTemplatePath: 'Templates/Daily.md' })

    // Simulate the pull: same path + content, brand-new id (as syncApply mints).
    const tpl = useNoteStore.getState().notes[0]
    useNoteStore.setState({
      notes: [{ ...tpl, id: 'regenerated-after-sync' }],
    })

    openTodayNote(new Date(2026, 4, 19))
    const created = useNoteStore.getState().notes.find(n => n.title === '2026-05-19')
    expect(created?.content).toBe('TPL-BODY')
  })

  test('migrates a legacy id-based template setting to its path', () => {
    const templateFolder = useFolderStore.getState().addFolder({ name: 'Templates' })
    const tplNote = useNoteStore.getState().addNote({
      title: 'Daily',
      folderId: templateFolder.id,
      content: 'LEGACY-BODY',
    })
    // Old setting shape: id only, no path.
    useSettingsStore.setState({ dailyNoteTemplateId: tplNote.id, dailyNoteTemplatePath: null })

    openTodayNote(new Date(2026, 4, 19))

    const created = useNoteStore.getState().notes.find(n => n.title === '2026-05-19')
    expect(created?.content).toBe('LEGACY-BODY')
    // The resolve lazily migrated the setting to the stable path and cleared id.
    expect(useSettingsStore.getState().dailyNoteTemplatePath).toBe('Templates/Daily.md')
    expect(useSettingsStore.getState().dailyNoteTemplateId).toBeNull()
  })

  test('honours a custom date format', () => {
    useSettingsStore.setState({ dailyNoteDateFormat: 'YYYY-MM-DD - dddd' })
    openTodayNote(new Date(2026, 4, 19)) // Tuesday
    expect(useNoteStore.getState().notes[0].title).toBe('2026-05-19 - Tuesday')
  })
})

describe('listTemplateNotes', () => {
  test('returns notes inside the templates folder (sorted by title)', () => {
    const tpls = useFolderStore.getState().addFolder({ name: 'Templates' })
    useNoteStore.getState().addNote({ title: 'Zeta', folderId: tpls.id, content: 'z' })
    useNoteStore.getState().addNote({ title: 'Alpha', folderId: tpls.id, content: 'a' })

    // A note outside Templates must be excluded.
    useNoteStore.getState().addNote({ title: 'Outside', folderId: null, content: 'x' })

    const out = listTemplateNotes()
    expect(out.map(t => t.title)).toEqual(['Alpha', 'Zeta'])
  })

  test('matches notes in subfolders of the templates folder', () => {
    const tpls = useFolderStore.getState().addFolder({ name: 'Templates' })
    const sub = useFolderStore.getState().addFolder({ name: 'Daily', parentId: tpls.id })
    useNoteStore.getState().addNote({ title: 'Plain', folderId: tpls.id, content: '' })
    useNoteStore.getState().addNote({ title: 'Nested', folderId: sub.id, content: '' })

    const out = listTemplateNotes()
    expect(out.map(t => t.title).sort()).toEqual(['Nested', 'Plain'])
    expect(out.find(t => t.title === 'Nested')?.repoPath).toBe('Templates/Daily')
  })

  test('honours a configured templates folder', () => {
    useSettingsStore.setState({ templatesFolder: 'MyTpls' })
    const t = useFolderStore.getState().addFolder({ name: 'MyTpls' })
    useNoteStore.getState().addNote({ title: 'A', folderId: t.id, content: '' })

    expect(listTemplateNotes().map(t => t.title)).toEqual(['A'])
  })
})
