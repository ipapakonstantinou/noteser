/**
 * @jest-environment node
 *
 * Tests revertToCommit's mutation of the noteStore against a mocked
 * GitHub API. The util is the load-bearing piece of the
 * revert-to-commit feature — the modal is a thin wrapper around it.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Stub the github helpers so the util's network calls are deterministic.
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github') as typeof import('../utils/github')
  return {
    ...actual,
    getCommitTreeSha: (...a: unknown[]) => mockGetCommitTreeSha(...a),
    getTreeMap: (...a: unknown[]) => mockGetTreeMap(...a),
    getBlobContent: (...a: unknown[]) => mockGetBlobContent(...a),
  }
})

import { revertToCommit } from '../utils/revertToCommit'
import { useNoteStore } from '../stores/noteStore'
import type { Note } from '../types'

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? `note-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? 'Note',
    content: overrides.content ?? '',
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
    ...overrides,
  }
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  mockGetCommitTreeSha.mockReset()
  mockGetTreeMap.mockReset()
  mockGetBlobContent.mockReset()
})

describe('revertToCommit', () => {
  it('rewrites a pushed note when the historical tree has the same path', async () => {
    seedNote(makeNote({ id: 'n1', gitPath: 'notes/hello.md', content: 'current body' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['notes/hello.md', 'blob-xyz']]))
    mockGetBlobContent.mockResolvedValue('historical body')

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-abc',
    })

    expect(result.replaced).toBe(1)
    expect(result.created).toBe(0)
    expect(result.removed).toBe(0)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('historical body')
    expect(notes[0].gitPath).toBe('notes/hello.md')
    // gitLastPushedSha must be cleared so the next push actually
    // re-uploads the rewritten content.
    expect(notes[0].gitLastPushedSha).toBeNull()
  })

  it('creates a new note when the historical tree has a path we lack locally', async () => {
    // No local notes.
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['lost/file.md', 'blob-1']]))
    mockGetBlobContent.mockResolvedValue('I came back from the dead')

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    expect(result.replaced).toBe(0)
    expect(result.created).toBe(1)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].gitPath).toBe('lost/file.md')
    expect(notes[0].content).toBe('I came back from the dead')
    // Title derived from the filename.
    expect(notes[0].title).toBe('file')
  })

  it('soft-deletes a pushed note that is not in the historical tree', async () => {
    seedNote(makeNote({ id: 'gone', gitPath: 'notes/gone.md' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    // Empty tree — the historical commit didn't have this file.
    mockGetTreeMap.mockResolvedValue(new Map())

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-empty',
    })

    expect(result.removed).toBe(1)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].isDeleted).toBe(true)
    expect(notes[0].deletedAt).not.toBeNull()
  })

  it('preserves unpushed local notes (no gitPath) verbatim', async () => {
    seedNote(makeNote({ id: 'draft', gitPath: null, content: 'I am a draft' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map())

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    expect(result.preservedUnpushed).toBe(1)
    expect(result.removed).toBe(0)

    const draft = useNoteStore.getState().notes.find(n => n.id === 'draft')!
    expect(draft).toBeDefined()
    expect(draft.isDeleted).toBe(false)
    expect(draft.content).toBe('I am a draft')
  })

  it('ignores non-.md files in the historical tree', async () => {
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([
      ['notes/markdown.md', 'blob-md'],
      ['attachments/image.png', 'blob-img'],
      ['README', 'blob-txt'],
    ]))
    mockGetBlobContent.mockResolvedValue('markdown body')

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    // Only the .md file became a note.
    expect(result.created).toBe(1)
    expect(useNoteStore.getState().notes).toHaveLength(1)
    // We didn't fetch the binary/non-md blobs.
    expect(mockGetBlobContent).toHaveBeenCalledTimes(1)
  })

  it('strips frontmatter into inline tags (uses parseNote pipeline)', async () => {
    seedNote(makeNote({ id: 'n1', gitPath: 'notes/x.md', content: 'current' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['notes/x.md', 'blob']]))
    mockGetBlobContent.mockResolvedValue('---\ntags: [a, b]\n---\nactual body')

    await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    const restored = useNoteStore.getState().notes[0]
    // bodyWithInlineTags stamps the tag line in front of the body.
    expect(restored.content).toContain('#a')
    expect(restored.content).toContain('#b')
    expect(restored.content).toContain('actual body')
  })
})

function seedNote(n: Note) {
  useNoteStore.setState({ notes: [...useNoteStore.getState().notes, n] })
}
