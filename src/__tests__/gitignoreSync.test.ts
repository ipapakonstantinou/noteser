/**
 * gitignoreSync.test.ts
 *
 * Coverage for the in-app vault `.gitignore` editor helpers.
 *
 *   - fetchRemoteGitignore: mocks the GitHub helpers and verifies the
 *     branch → commit → tree → blob path returns the file content,
 *     plus the empty-file-not-an-error branch.
 *
 *   - vaultGitignoreEntryIfChanged: pure rule for whether the draft
 *     should produce a tree entry.
 */

import {
  fetchRemoteGitignore,
  vaultGitignoreEntryIfChanged,
} from '../utils/gitignoreSync'
import type { SyncRepo } from '@/types'

jest.mock('../utils/github')
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  getBlobContent,
} from '../utils/github'

const mockedBranch = getBranchRefSha as jest.MockedFunction<typeof getBranchRefSha>
const mockedTreeSha = getCommitTreeSha as jest.MockedFunction<typeof getCommitTreeSha>
const mockedTree = getTreeMap as jest.MockedFunction<typeof getTreeMap>
const mockedBlob = getBlobContent as jest.MockedFunction<typeof getBlobContent>

const repo: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

beforeEach(() => {
  jest.clearAllMocks()
  mockedBranch.mockResolvedValue('headsha')
  mockedTreeSha.mockResolvedValue('treesha')
})

describe('fetchRemoteGitignore', () => {
  test('returns the blob content when .gitignore exists in the tree', async () => {
    mockedTree.mockResolvedValue(new Map([['.gitignore', 'blob123']]))
    mockedBlob.mockResolvedValue('*.log\nbuild/\n')

    const result = await fetchRemoteGitignore('tok', repo)

    expect(result.exists).toBe(true)
    expect(result.content).toBe('*.log\nbuild/\n')
    expect(mockedBlob).toHaveBeenCalledWith('tok', 'me', 'vault', 'blob123')
  })

  test('returns empty content + exists=false when no .gitignore in the tree', async () => {
    mockedTree.mockResolvedValue(new Map([['README.md', 'somesha']]))

    const result = await fetchRemoteGitignore('tok', repo)

    expect(result.exists).toBe(false)
    expect(result.content).toBe('')
    // Bail BEFORE fetching a blob — the tree had no .gitignore.
    expect(mockedBlob).not.toHaveBeenCalled()
  })

  test('propagates errors from the underlying GitHub helpers', async () => {
    mockedBranch.mockRejectedValue(new Error('401 Unauthorized'))
    await expect(fetchRemoteGitignore('tok', repo)).rejects.toThrow('401 Unauthorized')
  })
})

describe('vaultGitignoreEntryIfChanged', () => {
  test('null draft → no push', () => {
    expect(vaultGitignoreEntryIfChanged(null, '*.log')).toBeNull()
  })

  test('undefined draft → no push', () => {
    expect(vaultGitignoreEntryIfChanged(undefined, '*.log')).toBeNull()
  })

  test('draft equal to remote → no push', () => {
    expect(vaultGitignoreEntryIfChanged('*.log', '*.log')).toBeNull()
  })

  test('draft differs from remote → push the draft', () => {
    expect(vaultGitignoreEntryIfChanged('*.log\nbuild/', '*.log')).toBe('*.log\nbuild/')
  })

  test('empty draft against non-empty remote → push (user cleared file)', () => {
    expect(vaultGitignoreEntryIfChanged('', '*.log')).toBe('')
  })

  test('does NOT normalise whitespace — exact-match only', () => {
    // Trailing newline difference. We deliberately treat this as a
    // change so the user's exact intent is preserved.
    expect(vaultGitignoreEntryIfChanged('*.log', '*.log\n')).toBe('*.log')
  })
})
