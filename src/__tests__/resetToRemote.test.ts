/**
 * resetToRemote unit tests.
 *
 * Verifies the local-wipe strategy:
 *   - preserveUnpushed=true (default): drop pushed notes, keep
 *     local-only notes.
 *   - preserveUnpushed=false: nuke everything.
 *   - selectedNoteId is cleared when the selection no longer exists.
 *   - selectedNoteId is preserved when the selection survives the wipe.
 *   - rename-not-delete: folders (+ deletedFolderPaths) and the per-vault
 *     sync bookkeeping are ALSO cleared, so a discard → re-pull rebuilds a
 *     clean vault whose folder-name FORM matches the remote.
 */

// idb-keyval backs clearAllAttachments — give it an in-memory store so the
// async wipe runs (and is exercised) under the test env.
jest.mock('idb-keyval', () => {
  const store = new Map<IDBValidKey, unknown>()
  return {
    get: jest.fn(async (key: IDBValidKey) => store.get(key)),
    set: jest.fn(async (key: IDBValidKey, val: unknown) => { store.set(key, val) }),
    del: jest.fn(async (key: IDBValidKey) => { store.delete(key) }),
    keys: jest.fn(async () => Array.from(store.keys())),
    clear: jest.fn(async () => { store.clear() }),
  }
})

import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useSettingsStore } from '../stores/settingsStore'
import { resetToRemote } from '../utils/resetToRemote'
import type { Note, Folder } from '@/types'

function makeNote(id: string, opts: Partial<Note> = {}): Note {
  return {
    id, title: id, content: '', folderId: null,
    createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
    gitPath: null, gitLastPushedSha: null,
    ...opts,
  }
}

function makeFolder(id: string, name: string): Folder {
  return {
    id, name, parentId: null, createdAt: 0, updatedAt: 0,
    isDeleted: false, deletedAt: null, order: 0,
  }
}

function seed(notes: Note[], selectedNoteId: string | null = null): void {
  useNoteStore.setState({ notes, selectedNoteId })
}

describe('resetToRemote', () => {
  test('default: drops pushed notes, preserves unpushed', async () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: 'B.md' }),
      makeNote('c', { gitPath: null }),
    ])
    const result = await resetToRemote()
    expect(result).toEqual({ pushedDropped: 2, unpushedDropped: 0, preserved: 1 })
    const remaining = useNoteStore.getState().notes.map(n => n.id)
    expect(remaining).toEqual(['c'])
  })

  test('preserveUnpushed=false drops everything', async () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: null }),
    ])
    const result = await resetToRemote({ preserveUnpushed: false })
    expect(result).toEqual({ pushedDropped: 1, unpushedDropped: 1, preserved: 0 })
    expect(useNoteStore.getState().notes).toEqual([])
  })

  test('clears selectedNoteId when selection was a pushed note', async () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: null }),
    ], 'a')
    await resetToRemote()
    expect(useNoteStore.getState().selectedNoteId).toBeNull()
  })

  test('preserves selectedNoteId when selection survives', async () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: null }),
    ], 'b')
    await resetToRemote()
    expect(useNoteStore.getState().selectedNoteId).toBe('b')
  })

  test('empty vault: no-op result', async () => {
    seed([])
    const result = await resetToRemote()
    expect(result).toEqual({ pushedDropped: 0, unpushedDropped: 0, preserved: 0 })
  })

  // rename-not-delete: discard must clear the folder hierarchy (and its
  // tombstones) so the re-clone rebuilds folders from the remote's current
  // name FORM — otherwise a stale dash-form folder name perpetuates the
  // path-form mismatch that turns a remote rename into a delete.
  test('clears folders + deletedFolderPaths + per-vault sync state', async () => {
    seed([makeNote('a', { gitPath: 'A.md' })])
    useFolderStore.setState({
      folders: [makeFolder('f1', 'my-folder'), makeFolder('f2', 'another-folder')],
      activeFolderId: 'f1',
      expandedFolders: { f1: true },
      deletedFolderPaths: ['old/path'],
    })
    useSettingsStore.setState({
      vaultSettingsUpdatedAt: 123,
      vaultSettingsLastPushedHash: 'abc',
      localGitignoreOverlay: '*.tmp',
      vaultGitignoreDraft: 'draft',
      vaultGitignoreRemoteSnapshot: 'snap',
      vaultEncryptionEnabled: true,
    })

    await resetToRemote()

    const fs = useFolderStore.getState()
    expect(fs.folders).toEqual([])
    expect(fs.activeFolderId).toBeNull()
    expect(fs.expandedFolders).toEqual({})
    expect(fs.deletedFolderPaths).toEqual([])

    const ss = useSettingsStore.getState()
    expect(ss.vaultSettingsUpdatedAt).toBe(0)
    expect(ss.vaultSettingsLastPushedHash).toBe('')
    expect(ss.localGitignoreOverlay).toBe('')
    expect(ss.vaultGitignoreDraft).toBeNull()
    expect(ss.vaultGitignoreRemoteSnapshot).toBeNull()
    expect(ss.vaultEncryptionEnabled).toBe(false)
  })
})
