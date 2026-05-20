// AI-drafted commit messages.
//
// When useGitHubSync.runSync runs the push step and the user has
// `aiCommitMessages` enabled, it calls into this helper with the
// classified pending changes. We summarise the change set as plain
// text + ask the model for a single-line commit message.
//
// Designed to be small + cheap + offline-safe:
//   - Skip the AI call entirely when the change set is trivially
//     summarisable (0 or 1 change), since the model adds no value.
//   - Cap the input we send: titles + paths only, never note bodies.
//     The model doesn't need 50KB of content to write 10 words.
//   - Errors fall back to null so the caller uses the legacy
//     auto-generated message — never block a sync because of AI.

import { runPrompt } from './aiClient'
import { classifyPendingChanges, totalPendingCount, type SyncChangeSets } from './syncChanges'
import { useNoteStore, useGitHubStore } from '@/stores'

const SYSTEM_PROMPT =
  'You write short, factual git commit messages for a personal note-taking app. ' +
  'Reply with a SINGLE LINE — no period at the end, no quotes, no preamble, no markdown. ' +
  'Aim for 50 characters or fewer. ' +
  'Start with a verb in the imperative ("Add", "Update", "Remove", "Rename"). ' +
  'Mention the most prominent change; do not enumerate every file. ' +
  'Example: "Update daily notes for the week" or "Add team-1:1 meeting notes".'

// Public entry point. Returns the model's message, OR null when the
// caller should fall back to the auto-generated default. Reasons we
// return null:
//   - No pending changes
//   - Only a single created/modified change AND no body to summarise
//     (the model would just paraphrase the filename)
//   - AI is off or the call failed
//
// Errors are swallowed by design — never block a sync.
export async function draftAiCommitMessage(): Promise<string | null> {
  const notes = useNoteStore.getState().notes
  const lastSyncedAt = useGitHubStore.getState().lastSyncedAt
  const changes = classifyPendingChanges(notes, lastSyncedAt)
  const total = totalPendingCount(changes)
  if (total === 0) return null

  const summary = formatChangeSummary(changes)
  try {
    const message = await runPrompt({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Changes to summarise:\n\n${summary}` }],
    })
    return sanitise(message)
  } catch {
    // Provider error, quota, network — fall back silently.
    return null
  }
}

// Plain-text rundown of what changed. We deliberately keep this
// short — adding more detail (body diff, line counts) would slow
// down the call without changing the headline message.
function formatChangeSummary(changes: SyncChangeSets): string {
  const lines: string[] = []
  for (const c of changes.created)  lines.push(`+ ${c.title}${c.gitPath ? ` (${c.gitPath})` : ''}`)
  for (const c of changes.modified) lines.push(`~ ${c.title}${c.gitPath ? ` (${c.gitPath})` : ''}`)
  for (const c of changes.deleted)  lines.push(`- ${c.title}${c.gitPath ? ` (${c.gitPath})` : ''}`)
  // Hard cap so a massive bulk-rename doesn't blow up the prompt.
  if (lines.length > 40) {
    const cut = lines.slice(0, 40)
    cut.push(`… and ${lines.length - 40} more change${lines.length - 40 === 1 ? '' : 's'}`)
    return cut.join('\n')
  }
  return lines.join('\n')
}

// Defensive cleanup: strip trailing punctuation, collapse whitespace,
// drop wrapping quotes, take the first line only. We don't trust the
// model to follow "single line, no quotes" perfectly.
function sanitise(raw: string): string | null {
  if (!raw) return null
  const firstLine = raw.split('\n').find(l => l.trim().length > 0) ?? ''
  const cleaned = firstLine.trim()
    .replace(/^["'`]+|["'`]+$/g, '')   // strip wrapping quotes
    .replace(/\s+/g, ' ')              // collapse runs of whitespace
    .replace(/[.!?]+$/, '')            // trailing punctuation
    .trim()
  return cleaned.length > 0 ? cleaned : null
}
