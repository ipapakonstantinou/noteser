/**
 * @jest-environment node
 *
 * Vault-folder scan contract tests. The scanner walks an in-memory
 * notes + folders list (the live store passes its current arrays
 * straight in) and returns validated manifest candidates plus a
 * skipped count for notes whose title matched but body did not.
 */

import { scanVaultForManifests } from '@/plugins/vaultScan'
import type { Note, Folder } from '@/types'

const validManifestBody = JSON.stringify({
  id: 'word-count',
  name: 'Word count',
  version: '1.0.0',
  main: 'https://example.com/word-count/main.js',
  surfaces: { commands: [{ id: 'show', title: 'Word count: show' }] },
})

function makeNote(partial: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: partial.id,
    title: partial.title,
    content: partial.content ?? '',
    folderId: partial.folderId ?? null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: partial.isDeleted ?? false,
    deletedAt: partial.isDeleted ? 0 : null,
    isPinned: false,
    templateId: null,
  }
}

function makeFolder(partial: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    id: partial.id,
    name: partial.name,
    parentId: partial.parentId ?? null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: partial.isDeleted ?? false,
    deletedAt: partial.isDeleted ? 0 : null,
    order: partial.order ?? 0,
  }
}

describe('scanVaultForManifests', () => {
  test('finds a known manifest by title + valid body', () => {
    const folder = makeFolder({ id: 'f1', name: 'Plugins' })
    const note = makeNote({
      id: 'n1',
      title: 'manifest.json',
      content: validManifestBody,
      folderId: 'f1',
    })
    const result = scanVaultForManifests([note], [folder])
    expect(result.candidates).toHaveLength(1)
    expect(result.skipped).toBe(0)
    const c = result.candidates[0]
    expect(c.manifest.id).toBe('word-count')
    expect(c.manifest.name).toBe('Word count')
    expect(c.manifest.version).toBe('1.0.0')
    expect(c.mainUrl).toBe('https://example.com/word-count/main.js')
    expect(c.noteId).toBe('n1')
    expect(c.pathInVault).toBe('Plugins/manifest.json')
  })

  test('skips deleted notes', () => {
    const note = makeNote({
      id: 'n1',
      title: 'manifest.json',
      content: validManifestBody,
      isDeleted: true,
    })
    const result = scanVaultForManifests([note], [])
    expect(result.candidates).toHaveLength(0)
    expect(result.skipped).toBe(0)
  })

  test('ignores notes whose title is not manifest.json', () => {
    const note = makeNote({ id: 'n1', title: 'README.md', content: validManifestBody })
    const result = scanVaultForManifests([note], [])
    expect(result.candidates).toHaveLength(0)
    expect(result.skipped).toBe(0)
  })

  test('skips non-manifest JSON notes (matched title, garbage body)', () => {
    const notJson = makeNote({ id: 'n1', title: 'manifest.json', content: 'not json' })
    const wrongShape = makeNote({
      id: 'n2',
      title: 'manifest.json',
      content: JSON.stringify({ foo: 'bar' }),
    })
    const noMain = makeNote({
      id: 'n3',
      title: 'manifest.json',
      content: JSON.stringify({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        surfaces: { commands: [{ id: 'a', title: 'A' }] },
      }),
    })
    const failsValidation = makeNote({
      id: 'n4',
      title: 'manifest.json',
      content: JSON.stringify({
        id: 'BadID',
        name: 'P',
        version: '1.0.0',
        main: 'https://example.com/main.js',
        surfaces: { commands: [{ id: 'a', title: 'A' }] },
      }),
    })
    const result = scanVaultForManifests([notJson, wrongShape, noMain, failsValidation], [])
    expect(result.candidates).toHaveLength(0)
    expect(result.skipped).toBe(4)
  })

  test('matches manifest.json title case-insensitively', () => {
    const note = makeNote({ id: 'n1', title: 'Manifest.JSON', content: validManifestBody })
    const result = scanVaultForManifests([note], [])
    expect(result.candidates).toHaveLength(1)
  })

  test('empty vault returns no candidates and no skips', () => {
    const result = scanVaultForManifests([], [])
    expect(result.candidates).toHaveLength(0)
    expect(result.skipped).toBe(0)
  })

  test('builds nested folder path for display', () => {
    const root = makeFolder({ id: 'root', name: 'Tools' })
    const child = makeFolder({ id: 'child', name: 'word-count', parentId: 'root' })
    const note = makeNote({
      id: 'n1',
      title: 'manifest.json',
      content: validManifestBody,
      folderId: 'child',
    })
    const result = scanVaultForManifests([note], [root, child])
    expect(result.candidates[0].pathInVault).toBe('Tools/word-count/manifest.json')
  })

  test('falls back to title when the note is at vault root', () => {
    const note = makeNote({ id: 'n1', title: 'manifest.json', content: validManifestBody })
    const result = scanVaultForManifests([note], [])
    expect(result.candidates[0].pathInVault).toBe('manifest.json')
  })

  test('sorts candidates by display path', () => {
    const a = makeFolder({ id: 'a', name: 'A' })
    const b = makeFolder({ id: 'b', name: 'B' })
    const m1 = JSON.stringify({
      id: 'one',
      name: 'One',
      version: '1.0.0',
      main: 'https://e.com/1.js',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const m2 = JSON.stringify({
      id: 'two',
      name: 'Two',
      version: '1.0.0',
      main: 'https://e.com/2.js',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const notes = [
      makeNote({ id: 'n1', title: 'manifest.json', content: m2, folderId: 'b' }),
      makeNote({ id: 'n2', title: 'manifest.json', content: m1, folderId: 'a' }),
    ]
    const result = scanVaultForManifests(notes, [a, b])
    expect(result.candidates.map((c) => c.manifest.id)).toEqual(['one', 'two'])
  })

  test('mixes valid and invalid: counts skips, returns only valid', () => {
    const good = makeNote({
      id: 'good',
      title: 'manifest.json',
      content: validManifestBody,
    })
    const bad = makeNote({ id: 'bad', title: 'manifest.json', content: 'oops' })
    const ignored = makeNote({ id: 'ignored', title: 'notes.md', content: validManifestBody })
    const result = scanVaultForManifests([good, bad, ignored], [])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].noteId).toBe('good')
    expect(result.skipped).toBe(1)
  })
})
