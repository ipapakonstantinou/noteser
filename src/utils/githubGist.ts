// Publish a single note as a GitHub Gist.
//
// Independent of the sync pipeline (githubSync.ts). The note content is
// uploaded as a fresh gist each time — no incremental updates or backlink
// from the local note to the gist. The gist URL is returned to the caller
// so the modal can show it / copy-to-clipboard.
//
// Auth: needs the `gist` OAuth scope. Existing tokens were issued with
// `repo` only, so callers should be prepared to surface an "insufficient
// scope" error to the user and prompt them to re-authorize. The 404 vs
// 403 distinction below is what GitHub returns in that case.

import { GitHubAPIError } from './github'
import { githubFetch } from './githubFetch'

export interface PublishGistInput {
  token: string
  // Filename used inside the gist. We always pass a `.md` filename so
  // GitHub renders the gist with markdown highlighting.
  filename: string
  content: string
  description?: string
  // `true` → public gist (discoverable, indexed by search engines).
  // `false` → secret gist (only people with the URL can view).
  isPublic: boolean
}

export interface PublishGistResult {
  // The gist's API id; useful if we ever want to delete or update it.
  id: string
  // Public-facing URL (gist.github.com/…). What the user copies.
  htmlUrl: string
  // API URL — not user-facing, kept for symmetry.
  apiUrl: string
}

// Error thrown when GitHub responds with a "missing scope" hint. The
// modal catches this specifically and routes the user to re-auth.
export class GistScopeError extends Error {
  constructor(public readonly underlying: GitHubAPIError) {
    super('GitHub token is missing the `gist` scope — re-authorize to enable gist publishing.')
    this.name = 'GistScopeError'
  }
}

// Quick sanitisation for the gist filename. GitHub rejects empty
// filenames and trims slashes; we also collapse whitespace + force a
// `.md` extension because the modal always passes the note title here.
export function sanitizeGistFilename(rawTitle: string): string {
  const base = rawTitle.trim().replace(/[\s/]+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')
  const safe = base || 'note'
  return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`
}

export async function publishGist(input: PublishGistInput): Promise<PublishGistResult> {
  const body = {
    description: input.description ?? '',
    public: input.isPublic,
    files: {
      [input.filename]: { content: input.content },
    },
  }

  let res: Response
  try {
    res = await githubFetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${input.token}`,
        'Content-Type': 'application/json',
        // Pin the API version so a future GitHub deprecation doesn't
        // surprise us silently.
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`Gist publish failed: ${(err as Error).message}`)
  }

  if (!res.ok) {
    const apiErr = await GitHubAPIError.fromResponse(res, 'createGist')
    // GitHub returns 404 with no specific body when a token lacks the
    // `gist` scope (the endpoint is reachable but the user "doesn't
    // exist" from the token's POV). 401 also possible for an expired
    // token. We surface the scope error specifically so the UI can
    // suggest the right next step.
    if (res.status === 404 || res.status === 401) {
      throw new GistScopeError(apiErr)
    }
    throw apiErr
  }

  const json = await res.json() as {
    id: string
    html_url: string
    url: string
  }
  return {
    id: json.id,
    htmlUrl: json.html_url,
    apiUrl: json.url,
  }
}
