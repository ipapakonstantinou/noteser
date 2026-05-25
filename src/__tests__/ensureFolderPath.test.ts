/**
 * ensureFolderPath.test.ts
 *
 * Verifies that `useFolderStore.ensureFolderPath` stores folder names that
 * round-trip against the remote path. sanitizeFilename now PRESERVES spaces
 * (it only strips illegal chars, collapses double spaces, and trims), and it
 * is idempotent — so storing the sanitized segment and re-sanitizing it on
 * push yields the same path. That stability is what prevents the old "every
 * sync uploads every blob" storm; the previous fix dash-ified names, which
 * also mangled "Daily Notes" into "Daily-Notes". Spaces are valid in git
 * paths and Obsidian keeps them, so we keep them too.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { useFolderStore } from '../stores/folderStore'
import { sanitizeFilename } from '../utils/sanitizeFilename'

beforeEach(() => {
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
})

describe('ensureFolderPath — preserves spaces, round-trips stably', () => {
  test('a single segment with spaces keeps its spaces', () => {
    useFolderStore.getState().ensureFolderPath(['Daily Notes'])
    const folders = useFolderStore.getState().folders
    expect(folders).toHaveLength(1)
    expect(folders[0].name).toBe('Daily Notes')
  })

  test('nested segments each keep their spaces', () => {
    useFolderStore.getState().ensureFolderPath(['My Notes', 'Sub Folder', 'Deep One'])
    const names = useFolderStore.getState().folders.map(f => f.name)
    expect(names).toEqual(['My Notes', 'Sub Folder', 'Deep One'])
  })

  test('the stored name re-sanitizes to itself (round-trip stable, no re-upload churn)', () => {
    // The invariant that prevents the upload storm: push re-runs
    // sanitizeFilename on the stored folder.name, and it must produce the
    // SAME segment the folder was created from.
    useFolderStore.getState().ensureFolderPath(['Daily Notes'])
    const stored = useFolderStore.getState().folders[0].name
    expect(sanitizeFilename(stored)).toBe(stored)
    expect(stored).toBe('Daily Notes')
  })

  test('subsequent calls with the same raw path REUSE the existing folder', () => {
    const first  = useFolderStore.getState().ensureFolderPath(['Daily Notes'])
    const second = useFolderStore.getState().ensureFolderPath(['Daily Notes'])
    expect(first).toBe(second)
    expect(useFolderStore.getState().folders).toHaveLength(1)
  })

  test('a space name and a literal-dash name are now DISTINCT folders', () => {
    // With dash-ifying gone, "Daily Notes" (space) and "Daily-Notes" (a real
    // dash in the name) are different paths and must not collapse together.
    const spaced  = useFolderStore.getState().ensureFolderPath(['Daily Notes'])
    const dashed  = useFolderStore.getState().ensureFolderPath(['Daily-Notes'])
    expect(spaced).not.toBe(dashed)
    expect(useFolderStore.getState().folders).toHaveLength(2)
  })

  test('segments that need no sanitization are stored verbatim', () => {
    useFolderStore.getState().ensureFolderPath(['Notes', 'Personal'])
    const names = useFolderStore.getState().folders.map(f => f.name)
    expect(names).toEqual(['Notes', 'Personal'])
  })

  test('empty segments list returns null and creates no folder', () => {
    expect(useFolderStore.getState().ensureFolderPath([])).toBeNull()
    expect(useFolderStore.getState().folders).toHaveLength(0)
  })
})
