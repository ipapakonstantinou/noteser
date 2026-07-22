/**
 * githubSyncGaps.test.ts
 *
 * Targeted coverage for branches and edge-cases not yet exercised by
 * githubSyncClassify.test.ts or pushPath.test.ts.
 *
 * Gaps addressed here:
 *   1. parseNote — CRLF front-matter delimiter, no closing ---,
 *      empty body after close, tags + body together
 *   2. notePath / buildFolderPath — deep nested folder hierarchy,
 *      folder with special characters (& ' spaces), deleted folder
 *      in hierarchy is skipped (depth-guard), missing folder id
 *   3. guessMimeFromPath — every MIME type in MIME_BY_EXT,
 *      no extension, unknown extension, mixed-case extension
 *   4. normalizeForPush — CRLF edge cases, whitespace-only content
 *   5. pullFromGitHub classifier:
 *      a. isFirstClone=true emits shell (remoteCreated, shell:true, empty body)
 *      b. contentLoaded===false short-circuits to unchanged (safety guard)
 *      c. remoteDeleted when note.gitLastPushedSha===null (never synced)
 *      d. filenames with &, ', spaces, leading dots round-trip as unchanged
 *   6. syncToGitHub push path:
 *      a. new note with & preserved in push tree entry path
 *      b. synced note with matching gitPath + SHA emits no tree entry (zero churn)
 *   7. remoteUpdated vs unchanged with dual-SHA tracking
 */

// ── idb-keyval mock (Zustand persist + attachments) ─────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// ── github.ts mock — capture call args ──────────────────────────────────────
const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockGitBlobSha = jest.fn()
const mockCreateTree = jest.fn()
const mockCreateCommit = jest.fn()
const mockUpdateBranchRef = jest.fn()
const mockCreateBlob = jest.fn()

jest.mock('../utils/github', () => ({
  getBranchRefSha:    (...a: unknown[]) => mockGetBranchRefSha(...a),
  getCommitTreeSha:   (...a: unknown[]) => mockGetCommitTreeSha(...a),
  getTreeMap:         (...a: unknown[]) => mockGetTreeMap(...a),
  getBlobContent:     (...a: unknown[]) => mockGetBlobContent(...a),
  gitBlobSha:         (...a: unknown[]) => mockGitBlobSha(...a),
  gitBlobShaBytes:    jest.fn(),
  createTree:         (...a: unknown[]) => mockCreateTree(...a),
  createCommit:       (...a: unknown[]) => mockCreateCommit(...a),
  updateBranchRef:    (...a: unknown[]) => mockUpdateBranchRef(...a),
  createBlob:         (...a: unknown[]) => mockCreateBlob(...a),
  createBlobBinary:   jest.fn(),
  fetchZipball:       jest.fn(),
  blobToBase64:       jest.fn(),
}))

import {
  parseNote,
  notePath,
  guessMimeFromPath,
  normalizeForPush,
  pullFromGitHub,
  syncToGitHub,
} from '../utils/githubSync'
import { GitHubProvider } from '../utils/gitHost/githubProvider'
import type { Note, Folder, SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

// ── Note / Folder factories ──────────────────────────────────────────────────

function note(input: Partial<Note> & { id: string; title: string }): Note {
  const base: Note = {
    id: input.id,
    title: input.title,
    content: input.content ?? '',
    folderId: input.folderId ?? null,
    createdAt: 0,
    updatedAt: input.updatedAt ?? 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: input.gitPath ?? null,
    gitLastPushedSha: input.gitLastPushedSha ?? null,
    gitRemoteBaseSha: input.gitRemoteBaseSha ?? null,
  } as Note
  if (input.contentLoaded !== undefined) {
    Object.assign(base, { contentLoaded: input.contentLoaded })
  }
  return base
}

function folder(input: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    id: input.id,
    name: input.name,
    parentId: input.parentId ?? null,
    createdAt: 0,
    isDeleted: input.isDeleted ?? false,
  } as Folder
}

beforeEach(async () => {
  jest.clearAllMocks()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '' })
})

// ══════════════════════════════════════════════════════════════════════════════
// 1. parseNote
// ══════════════════════════════════════════════════════════════════════════════

describe('parseNote', () => {
  test('no frontmatter → tags [], aliases [], body = raw string', () => {
    const raw = 'Just a body.\n#tag-inline'
    const p = parseNote(raw)
    expect(p.tags).toEqual([])
    expect(p.aliases).toEqual([])
    expect(p.body).toBe(raw)
  })

  test('CRLF front-matter delimiter is parsed correctly', () => {
    const raw = '---\r\ntags: [work]\r\n---\r\nBody text'
    const p = parseNote(raw)
    expect(p.tags).toEqual(['work'])
    expect(p.body).toBe('Body text')
  })

  test('frontmatter with no closing --- returns raw as body (not an FM block)', () => {
    const raw = '---\ntags: [orphan]\nno closing fence'
    const p = parseNote(raw)
    // No `\n---\n` found → treated as no valid frontmatter
    expect(p.tags).toEqual([])
    expect(p.body).toBe(raw)
  })

  test('empty body after frontmatter close', () => {
    const raw = '---\ntags: [x]\n---\n'
    const p = parseNote(raw)
    expect(p.tags).toEqual(['x'])
    expect(p.body).toBe('')
  })

  test('tags and body coexist: tags parsed, body preserved', () => {
    const raw = '---\ntags: [alpha, beta]\n---\nBody here.'
    const p = parseNote(raw)
    expect(p.tags).toEqual(['alpha', 'beta'])
    expect(p.body).toBe('Body here.')
  })

  test('quoted tags with spaces parse correctly', () => {
    const raw = '---\ntags: ["multi word", plain]\n---\nBody'
    const p = parseNote(raw)
    expect(p.tags).toEqual(['multi word', 'plain'])
  })

  test('empty tags array', () => {
    const raw = '---\ntags: []\n---\nBody'
    const p = parseNote(raw)
    expect(p.tags).toEqual([])
  })

  test('frontmatter with only aliases (no tags)', () => {
    const raw = '---\naliases: [Short]\n---\nBody'
    const p = parseNote(raw)
    expect(p.tags).toEqual([])
    expect(p.aliases).toEqual(['Short'])
    expect(p.body).toBe('Body')
  })

  test('body containing #tags inline is returned verbatim (parseNote does not extract inline tags)', () => {
    const raw = '---\ntags: []\n---\nSome #inline #tags here'
    const p = parseNote(raw)
    expect(p.body).toBe('Some #inline #tags here')
    expect(p.tags).toEqual([])
  })

  test('multi-line body after frontmatter is fully preserved', () => {
    const body = '# Heading\n\nParagraph one.\n\nParagraph two.'
    const raw = `---\ntags: [note]\n---\n${body}`
    expect(parseNote(raw).body).toBe(body)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. notePath / buildFolderPath
// ══════════════════════════════════════════════════════════════════════════════

describe('notePath', () => {
  test('note at root (folderId null) → just the filename', () => {
    const n = note({ id: '1', title: 'My Note' })
    expect(notePath(n, [])).toBe('My Note.md')
  })

  test('note in a single folder → folder/file.md', () => {
    const folders: Folder[] = [folder({ id: 'f1', name: 'Work' })]
    const n = note({ id: '1', title: 'Plan', folderId: 'f1' })
    expect(notePath(n, folders)).toBe('Work/Plan.md')
  })

  test('note in a deeply nested folder hierarchy (3 levels)', () => {
    const folders: Folder[] = [
      folder({ id: 'root', name: 'Projects' }),
      folder({ id: 'sub', name: 'Active', parentId: 'root' }),
      folder({ id: 'leaf', name: 'Sprint', parentId: 'sub' }),
    ]
    const n = note({ id: '1', title: 'Task', folderId: 'leaf' })
    expect(notePath(n, folders)).toBe('Projects/Active/Sprint/Task.md')
  })

  test('folder name with & is preserved (relaxed sanitizer keeps &)', () => {
    const folders: Folder[] = [folder({ id: 'f1', name: 'R&D Work' })]
    const n = note({ id: '1', title: 'Ideas', folderId: 'f1' })
    expect(notePath(n, folders)).toBe('R&D Work/Ideas.md')
  })

  test("folder name with apostrophe is preserved", () => {
    const folders: Folder[] = [folder({ id: 'f1', name: "Jake's Project" })]
    const n = note({ id: '1', title: 'Notes', folderId: 'f1' })
    expect(notePath(n, folders)).toBe("Jake's Project/Notes.md")
  })

  test('leading-dot folder name is preserved (.obsidian, .trash)', () => {
    const folders: Folder[] = [folder({ id: 'f1', name: '.obsidian' })]
    const n = note({ id: '1', title: 'config', folderId: 'f1' })
    expect(notePath(n, folders)).toBe('.obsidian/config.md')
  })

  test('deleted folder in ancestor chain breaks the walk (deleted segment is excluded)', () => {
    // buildFolderPath walks up to root and breaks at any isDeleted folder.
    // So if parent is deleted, only the child path segment is used.
    const folders: Folder[] = [
      folder({ id: 'root', name: 'Archive', isDeleted: true }),
      folder({ id: 'child', name: 'Notes', parentId: 'root' }),
    ]
    const n = note({ id: '1', title: 'Doc', folderId: 'child' })
    // 'Archive' is deleted → walk breaks → only 'Notes' in path
    expect(notePath(n, folders)).toBe('Notes/Doc.md')
  })

  test('folderId pointing to non-existent folder → root-level path (graceful fallback)', () => {
    const n = note({ id: '1', title: 'Orphan', folderId: 'unknown-id' })
    expect(notePath(n, [])).toBe('Orphan.md')
  })

  test('title with spaces produces a valid path (spaces preserved)', () => {
    const n = note({ id: '1', title: 'My Daily Note' })
    expect(notePath(n, [])).toBe('My Daily Note.md')
  })

  test('empty title falls back to "Untitled"', () => {
    const n = note({ id: '1', title: '' })
    expect(notePath(n, [])).toBe('Untitled.md')
  })

  test('title with forbidden chars has them stripped', () => {
    const n = note({ id: '1', title: 'File:Name' })
    // `:` is forbidden → stripped
    expect(notePath(n, [])).toBe('FileName.md')
  })

  test('folder/title with spaces in both components', () => {
    const folders: Folder[] = [folder({ id: 'f1', name: 'Daily Notes' })]
    const n = note({ id: '1', title: '2026 01 01', folderId: 'f1' })
    expect(notePath(n, folders)).toBe('Daily Notes/2026 01 01.md')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. guessMimeFromPath
// ══════════════════════════════════════════════════════════════════════════════

describe('guessMimeFromPath', () => {
  const cases: Array<[string, string]> = [
    ['photo.png',         'image/png'],
    ['photo.PNG',         'image/png'],   // uppercase extension
    ['photo.jpg',         'image/jpeg'],
    ['photo.jpeg',        'image/jpeg'],
    ['anim.gif',          'image/gif'],
    ['thumb.webp',        'image/webp'],
    ['icon.svg',          'image/svg+xml'],
    ['bitmap.bmp',        'image/bmp'],
    ['modern.avif',       'image/avif'],
    ['folder/deep/a.png', 'image/png'],   // path with directory segments
    ['nodotfile',         'application/octet-stream'],  // no extension at all
    ['archive.zip',       'application/octet-stream'],  // unknown extension
    ['note.md',           'application/octet-stream'],  // .md is not an image MIME
    ['.gitignore',        'application/octet-stream'],  // dotfile, no real ext
  ]

  for (const [path, expected] of cases) {
    test(`"${path}" → ${expected}`, () => {
      expect(guessMimeFromPath(path)).toBe(expected)
    })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. normalizeForPush additional edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('normalizeForPush — additional edge cases', () => {
  test('whitespace-only content gets a trailing newline (not empty so guard does not fire)', () => {
    expect(normalizeForPush('   ')).toBe('   \n')
  })

  test('CRLF at end: converts to LF, already ends with \\n, no extra added', () => {
    expect(normalizeForPush('content\r\n')).toBe('content\n')
  })

  test('multiple CRLF lines throughout normalize to LF', () => {
    const input = 'a\r\nb\r\nc\r\n'
    expect(normalizeForPush(input)).toBe('a\nb\nc\n')
  })

  test('single character content (no newline) gets trailing newline', () => {
    expect(normalizeForPush('x')).toBe('x\n')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5a. pullFromGitHub — isFirstClone shell classification
// ══════════════════════════════════════════════════════════════════════════════

describe('pullFromGitHub — isFirstClone shell classification', () => {
  test('isFirstClone=true: every remote .md emitted as shell (empty body, no blob fetch)', async () => {
    mockGetTreeMap.mockResolvedValue(new Map([
      ['Note A.md', 'sha-a'],
      ['Notes/Note B.md', 'sha-b'],
    ]))

    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
      isFirstClone: true,
    })

    const created = classifications.filter(c => c.kind === 'remoteCreated')
    expect(created).toHaveLength(2)

    for (const c of created) {
      if (c.kind === 'remoteCreated') {
        expect(c.shell).toBe(true)
        expect(c.remoteContent).toBe('')
        expect(c.tags).toEqual([])
        expect(c.body).toBe('')
      }
    }

    // Critical: no blob fetches — shell path must not hit the network.
    expect(mockGetBlobContent).not.toHaveBeenCalled()
  })

  test('isFirstClone=false (incremental): fetches blob and returns real content', async () => {
    mockGetTreeMap.mockResolvedValue(new Map([['Note.md', 'sha-x']]))
    mockGetBlobContent.mockResolvedValue('real content')

    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
      isFirstClone: false,
    })

    const created = classifications.filter(c => c.kind === 'remoteCreated')
    expect(created).toHaveLength(1)
    if (created[0].kind === 'remoteCreated') {
      expect(created[0].shell).toBeFalsy()
      expect(created[0].remoteContent).toBe('real content')
    }
    expect(mockGetBlobContent).toHaveBeenCalledTimes(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5b. pullFromGitHub — contentLoaded=false safety guard
// ══════════════════════════════════════════════════════════════════════════════

describe('pullFromGitHub — contentLoaded=false safety guard', () => {
  test('shell note (contentLoaded=false) is classified unchanged WITHOUT any blob fetch', async () => {
    mockGetTreeMap.mockResolvedValue(new Map([['MyNote.md', 'sha-remote']]))

    const shellNote = note({
      id: '1', title: 'MyNote',
      content: '',                   // placeholder body
      gitPath: 'MyNote.md',
      gitLastPushedSha: 'sha-remote',
      contentLoaded: false,
    })

    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO,
      notes: [shellNote],
      folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'unchanged', noteId: '1' })
    // The safety guard must NOT fetch the blob or compute local SHA.
    expect(mockGetBlobContent).not.toHaveBeenCalled()
    expect(mockGitBlobSha).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5c. pullFromGitHub — remoteDeleted with null/missing gitLastPushedSha
// ══════════════════════════════════════════════════════════════════════════════

describe('pullFromGitHub — remoteDeleted edge cases', () => {
  test('note with gitPath missing from remote AND no gitLastPushedSha → remoteDeleted', async () => {
    mockGetTreeMap.mockResolvedValue(new Map())  // empty remote
    mockGitBlobSha.mockResolvedValue('sha-local')

    const local = [
      note({ id: '1', title: 'Gone', content: 'body', gitPath: 'Gone.md', gitLastPushedSha: null }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'remoteDeleted', noteId: '1' })
  })

  test('note with gitPath missing from remote AND lastPushed set, local unedited → remoteDeleted', async () => {
    mockGetTreeMap.mockResolvedValue(new Map())  // empty remote
    // Local content hashes to same sha as last push → unedited → accept delete.
    mockGitBlobSha.mockResolvedValue('sha-last-push')

    const local = [
      note({ id: '1', title: 'Gone', content: 'body', gitPath: 'Gone.md', gitLastPushedSha: 'sha-last-push' }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'remoteDeleted', noteId: '1' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5d. pullFromGitHub — special-character filenames round-trip as unchanged
// ══════════════════════════════════════════════════════════════════════════════

describe('pullFromGitHub — special-character filenames round-trip as unchanged', () => {
  test('filename with & matches local note by gitPath → unchanged (no churn)', async () => {
    const path = 'R&D Work.md'
    mockGetTreeMap.mockResolvedValue(new Map([[path, 'sha-rd']]))
    mockGitBlobSha.mockResolvedValue('sha-rd')  // local blob matches remote

    const local = [
      note({ id: '1', title: 'R&D Work', content: 'content', gitPath: path, gitLastPushedSha: 'sha-rd' }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'unchanged', noteId: '1' })
    expect(mockGetBlobContent).not.toHaveBeenCalled()
  })

  test("filename with apostrophe round-trips as unchanged", async () => {
    const path = "Jake's project.md"
    mockGetTreeMap.mockResolvedValue(new Map([[path, 'sha-j']]))
    mockGitBlobSha.mockResolvedValue('sha-j')

    const local = [
      note({ id: '1', title: "Jake's project", content: 'notes', gitPath: path, gitLastPushedSha: 'sha-j' }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'unchanged', noteId: '1' })
  })

  test('filename with spaces round-trips as unchanged', async () => {
    const path = 'My Daily Note.md'
    mockGetTreeMap.mockResolvedValue(new Map([[path, 'sha-daily']]))
    mockGitBlobSha.mockResolvedValue('sha-daily')

    const local = [
      note({ id: '1', title: 'My Daily Note', gitPath: path, gitLastPushedSha: 'sha-daily' }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications[0]).toMatchObject({ kind: 'unchanged' })
  })

  test('leading-dot folder path (.obsidian/config.md) round-trips as unchanged', async () => {
    const path = '.obsidian/config.md'
    mockGetTreeMap.mockResolvedValue(new Map([[path, 'sha-obs']]))
    mockGitBlobSha.mockResolvedValue('sha-obs')

    const folders: Folder[] = [folder({ id: 'f1', name: '.obsidian' })]
    const local = [
      note({ id: '1', title: 'config', folderId: 'f1', gitPath: path, gitLastPushedSha: 'sha-obs' }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders,
    })

    expect(classifications[0]).toMatchObject({ kind: 'unchanged' })
  })

  test('.trash folder path round-trips as unchanged', async () => {
    const path = '.trash/deleted.md'
    mockGetTreeMap.mockResolvedValue(new Map([[path, 'sha-trash']]))
    mockGitBlobSha.mockResolvedValue('sha-trash')

    const folders: Folder[] = [folder({ id: 'f1', name: '.trash' })]
    const local = [
      note({ id: '1', title: 'deleted', folderId: 'f1', gitPath: path, gitLastPushedSha: 'sha-trash' }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders,
    })

    expect(classifications[0]).toMatchObject({ kind: 'unchanged' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. syncToGitHub — special character filename handling
// ══════════════════════════════════════════════════════════════════════════════

describe('syncToGitHub — special character filename handling', () => {
  beforeEach(() => {
    mockCreateTree.mockResolvedValue('new-tree-sha')
    mockCreateCommit.mockResolvedValue({
      sha: 'commit-sha',
      html_url: 'https://github.com/me/vault/commit/commit-sha',
    })
    mockUpdateBranchRef.mockResolvedValue(undefined)
    mockCreateBlob.mockResolvedValue('new-blob-sha')
  })

  test('new note with & in title uses the & path in the push tree entry', async () => {
    mockGetTreeMap.mockResolvedValue(new Map())  // empty remote: brand new file
    mockGitBlobSha.mockResolvedValue('sha-local')

    const local = [note({ id: '1', title: 'R&D Work', content: 'body' })]
    await syncToGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

    expect(mockCreateBlob).toHaveBeenCalledTimes(1)
    expect(mockCreateTree).toHaveBeenCalledTimes(1)
    const entries = mockCreateTree.mock.calls[0][4] as Array<{ path: string }>
    const paths = entries.map(e => e.path)
    // Must preserve &, not strip to produce "RD Work.md"
    expect(paths).toContain('R&D Work.md')
    expect(paths.some(p => p === 'RD Work.md')).toBe(false)
  })

  test('synced note with & gitPath matching derived path emits no tree entry (zero churn)', async () => {
    // Remote already has this file at the same SHA.
    mockGetTreeMap.mockResolvedValue(new Map([['R&D Work.md', 'sha-existing']]))
    mockGitBlobSha.mockResolvedValue('sha-existing')

    const local = [
      note({
        id: '1', title: 'R&D Work', content: 'body',
        gitPath: 'R&D Work.md',
        gitLastPushedSha: 'sha-existing',
        gitRemoteBaseSha: 'sha-existing',
      }),
    ]
    const result = await syncToGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

    expect(result.result.unchanged).toBe(true)
    expect(mockCreateBlob).not.toHaveBeenCalled()
    expect(mockCreateTree).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. remoteUpdated vs unchanged with dual-SHA tracking
// ══════════════════════════════════════════════════════════════════════════════

describe('pullFromGitHub — remoteUpdated vs unchanged with dual-SHA tracking', () => {
  test('remoteBase != remoteSha, lastPushed == localBlob → remoteUpdated (only remote changed)', async () => {
    // remoteChanged = (remoteBase 'sha-v1' != remoteSha 'sha-v2') = true
    // localChanged  = (lastPushed 'sha-local' == localBlob 'sha-local') = false
    // → remoteUpdated
    mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-v2']]))
    mockGitBlobSha.mockResolvedValue('sha-local')
    mockGetBlobContent.mockResolvedValue('remote v2 body')

    const local = [
      note({
        id: '1', title: 'Foo', content: 'local body',
        gitPath: 'Foo.md',
        gitLastPushedSha: 'sha-local',
        gitRemoteBaseSha: 'sha-v1',
      }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'remoteUpdated', noteId: '1' })
  })

  test('remoteBase == remoteSha AND lastPushed == localBlob → unchanged (neither side moved)', async () => {
    // A frontmatter-transformed note scenario: localBlob != remoteSha but both
    // sides are in sync relative to their baselines — the double-false path fires.
    const remoteBase = 'sha-remote-base'
    const localBlobSha = 'sha-local-canonical'
    // remoteSha equals remoteBase → remote unchanged
    mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', remoteBase]]))
    // localBlob == lastPushed → local unchanged
    mockGitBlobSha.mockResolvedValue(localBlobSha)

    const local = [
      note({
        id: '1', title: 'Foo', content: 'transformed body',
        gitPath: 'Foo.md',
        gitLastPushedSha: localBlobSha,
        gitRemoteBaseSha: remoteBase,
      }),
    ]
    const { classifications } = await pullFromGitHub({
      provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [],
    })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({ kind: 'unchanged', noteId: '1' })
    // No blob fetch for the unchanged path.
    expect(mockGetBlobContent).not.toHaveBeenCalled()
  })
})
