/**
 * starterVaults.test.ts
 *
 * Verifies the seed function — every vault should land cleanly when
 * applied to fake store deps. We don't need real Zustand here; the
 * seedStarterVault contract takes plain functions so this stays a
 * unit test.
 */

import { STARTER_VAULTS, seedStarterVault } from '../utils/starterVaults'

interface FakeFolder { id: string; segments: string[] }
interface FakeNote { id: string; title: string; folderId: string | null; content: string }

function makeFakeDeps() {
  const folders: FakeFolder[] = []
  const notes: FakeNote[] = []
  let nf = 0, nn = 0
  return {
    folders, notes,
    deps: {
      ensureFolderPath: (segments: string[]) => {
        if (segments.length === 0) return null
        const key = segments.join('/')
        const existing = folders.find(f => f.segments.join('/') === key)
        if (existing) return existing.id
        const id = `f${++nf}`
        folders.push({ id, segments })
        return id
      },
      addNote: ({ title, folderId, content }: { title: string; folderId: string | null; content: string }) => {
        const id = `n${++nn}`
        notes.push({ id, title, folderId, content })
        return { id }
      },
    },
  }
}

describe('STARTER_VAULTS catalog', () => {
  test('has 4 vaults', () => {
    expect(STARTER_VAULTS).toHaveLength(4)
  })

  test('each vault has a non-empty label, description, tagline, and notes list', () => {
    for (const v of STARTER_VAULTS) {
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.description.length).toBeGreaterThan(0)
      expect(v.tagline.length).toBeGreaterThan(0)
      expect(v.notes.length).toBeGreaterThan(0)
    }
  })

  test('every note references a folder either at root ([]) or declared in vault.folders', () => {
    for (const v of STARTER_VAULTS) {
      const declared = new Set(v.folders.map(f => f.path.join('/')))
      for (const note of v.notes) {
        const key = note.folderPath.join('/')
        if (key === '') continue
        expect(declared.has(key)).toBe(true)
      }
    }
  })
})

describe('seedStarterVault', () => {
  test('Zettelkasten creates 4 folders + 5 notes', () => {
    const { folders, notes, deps } = makeFakeDeps()
    seedStarterVault(STARTER_VAULTS.find(v => v.id === 'zettelkasten')!, deps)
    expect(folders).toHaveLength(4)
    expect(notes).toHaveLength(5)
  })

  test('returns the id of the FIRST note created', () => {
    const { deps } = makeFakeDeps()
    const id = seedStarterVault(STARTER_VAULTS[0], deps)
    expect(id).toBe('n1')
  })

  test('root notes get folderId=null', () => {
    const { notes, deps } = makeFakeDeps()
    seedStarterVault(STARTER_VAULTS.find(v => v.id === 'daily-system')!, deps)
    const readme = notes.find(n => n.title === 'README')!
    expect(readme.folderId).toBeNull()
  })

  test('nested notes get folderId pointing at the correct folder', () => {
    const { folders, notes, deps } = makeFakeDeps()
    seedStarterVault(STARTER_VAULTS.find(v => v.id === 'project-tracker')!, deps)
    const exampleFolder = folders.find(f => f.segments.join('/') === 'Projects/Example Project')!
    const exampleReadme = notes.find(n => n.title === 'README' && n.folderId === exampleFolder.id)
    expect(exampleReadme).toBeDefined()
  })

  test('every vault seeds without throwing', () => {
    for (const v of STARTER_VAULTS) {
      const { deps } = makeFakeDeps()
      expect(() => seedStarterVault(v, deps)).not.toThrow()
    }
  })
})
