/**
 * gitignoreSync.ts
 *
 * Helpers for the in-app vault `.gitignore` editor (gi9n Settings UI).
 *
 *   - fetchRemoteGitignore: read the current `.gitignore` from the
 *     sync repo so the settings textarea can populate. Returns '' if
 *     the file doesn't exist (which is a normal/expected state).
 *
 *   - vaultGitignoreEntryIfChanged: pure helper used in tests + by
 *     syncToGitHub to decide whether the draft warrants a tree entry.
 *     Pulled out so the rule (push iff draft differs from remote) is
 *     unit-testable without spinning up the whole sync pipeline.
 */

import type { SyncRepo } from '@/types'
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  getBlobContent,
} from './github'
import { GITIGNORE_PATH } from './gitignore'

export interface FetchRemoteGitignoreResult {
  // Raw text of the remote `.gitignore`. Empty string when the file
  // doesn't exist remotely — the caller should treat that as a valid
  // starting point for the editor, not an error.
  content: string
  // True when the remote tree had a `.gitignore` blob. Useful for UX
  // ("no file yet — your first save will create one") vs ("loaded from
  // remote").
  exists: boolean
}

export const fetchRemoteGitignore = async (
  token: string,
  repo: SyncRepo,
): Promise<FetchRemoteGitignoreResult> => {
  const { owner, name, branch } = repo
  const headSha = await getBranchRefSha(token, owner, name, branch)
  const treeSha = await getCommitTreeSha(token, owner, name, headSha)
  const tree = await getTreeMap(token, owner, name, treeSha)
  const blobSha = tree.get(GITIGNORE_PATH)
  if (!blobSha) return { content: '', exists: false }
  const content = await getBlobContent(token, owner, name, blobSha)
  return { content, exists: true }
}

/**
 * Decide whether a draft should be pushed.
 *
 * Returns the content to push (a string) when the draft differs from
 * the remote, or `null` when no push is needed. Null when:
 *   - draft is null/undefined (no pending change)
 *   - draft is identical to the remote content (no change)
 *
 * The function is intentionally exact-match — we do NOT normalise
 * trailing whitespace or line endings because gitignore rules are
 * line-anchored and a "harmless cleanup" could change semantics.
 */
export const vaultGitignoreEntryIfChanged = (
  draft: string | null | undefined,
  remoteContent: string,
): string | null => {
  if (draft == null) return null
  if (draft === remoteContent) return null
  return draft
}
