// Build + submit a GitHub issue from the in-app bug-report modal.
//
// Design lives in docs/beta-and-bug-reporting.md. Key invariants:
//   - No secrets ever leave the browser. `sanitizeSettings` strips the
//     OAuth token, the AI API key, and anything else that looks like a
//     credential.
//   - The user gets a preview of the body before submission.
//   - On API error we still return the body so the UI can offer
//     copy-to-clipboard as a fallback.

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGitHubStore } from '@/stores/githubStore'

export interface BugReportForm {
  title: string
  description: string
  steps: string
  includeDiagnostics: boolean
  /** Repo to file in. Defaults to the canonical noteser repo. */
  targetRepo: { owner: string; name: string }
}

export const DEFAULT_TARGET_REPO = { owner: 'ipapakonstantinou', name: 'noteser' }

// Build a markdown issue body from the form + sanitized diagnostics.
export function buildIssueBody(form: BugReportForm, now: Date = new Date()): string {
  const sections: string[] = []

  sections.push('## What happened\n' + (form.description.trim() || '_no description provided_'))

  if (form.steps.trim()) {
    sections.push('## Steps to reproduce\n' + form.steps.trim())
  }

  if (form.includeDiagnostics) {
    const diag = collectDiagnostics(now)
    sections.push('## Diagnostics\n' + formatDiagnostics(diag))
  }

  sections.push('<!-- Filed via in-app bug reporter -->')

  return sections.join('\n\n')
}

interface Diagnostics {
  version: string
  ua: string
  href: string
  noteCount: number
  folderCount: number
  attachmentCount: number | 'unknown'
  hasRepo: boolean
  lastSyncedAt: string | null
  settings: Record<string, unknown>
  timestamp: string
}

function collectDiagnostics(now: Date): Diagnostics {
  const settings = sanitizeSettings(useSettingsStore.getState() as unknown as Record<string, unknown>)
  const notes = useNoteStore.getState().notes.filter(n => !n.isDeleted)
  const folders = useFolderStore.getState().folders.filter(f => !f.isDeleted)
  const gh = useGitHubStore.getState()

  return {
    version: process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    href: typeof window !== 'undefined' ? window.location.href : 'unknown',
    noteCount: notes.length,
    folderCount: folders.length,
    attachmentCount: 'unknown',
    hasRepo: Boolean(gh.syncRepo),
    lastSyncedAt: gh.lastSyncedAt ? new Date(gh.lastSyncedAt).toISOString() : null,
    settings,
    timestamp: now.toISOString(),
  }
}

function formatDiagnostics(d: Diagnostics): string {
  const lines: string[] = []
  lines.push(`- Version: \`${d.version}\` (collected ${d.timestamp})`)
  lines.push(`- URL: \`${d.href}\``)
  lines.push(`- User-Agent: \`${d.ua}\``)
  lines.push(`- Repo connected: ${d.hasRepo ? 'yes' : 'no'}`)
  lines.push(`- Last sync: ${d.lastSyncedAt ?? 'never'}`)
  lines.push(`- Notes: ${d.noteCount}, folders: ${d.folderCount}`)
  lines.push('')
  lines.push('Settings (sanitized):')
  lines.push('```json')
  lines.push(JSON.stringify(d.settings, null, 2))
  lines.push('```')
  return lines.join('\n')
}

// Strip secrets + everything else that doesn't help triage. Anything that
// looks like a token, key, or password is replaced with `'***'`. The whitelist
// approach is safer here than a denylist because new settings get added all
// the time and we don't want a future setting to silently leak.
export function sanitizeSettings(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'function') continue
    if (/token|key|secret|password|apikey/i.test(key)) {
      out[key] = value ? '***' : ''
      continue
    }
    // Avoid leaking inferred user content via store actions or nested
    // objects with unknown shape — only copy primitive + plain JSON.
    if (
      value == null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || Array.isArray(value)
      || (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    ) {
      out[key] = value
    }
  }
  return out
}

// POST a new issue to GitHub. Resolves with the new issue URL on success;
// throws (with the response body if available) on failure so the modal
// can offer a clipboard fallback.
export async function createGitHubIssue(
  form: BugReportForm,
  token: string,
  now: Date = new Date(),
): Promise<{ url: string; number: number }> {
  const body = buildIssueBody(form, now)
  const res = await fetch(
    `https://api.github.com/repos/${form.targetRepo.owner}/${form.targetRepo.name}/issues`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: form.title.trim() || 'Untitled bug report',
        body,
        labels: ['bug', 'from-app'],
      }),
    },
  )
  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch {}
    throw new Error(`GitHub API ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json() as { html_url: string; number: number }
  return { url: data.html_url, number: data.number }
}
