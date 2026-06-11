// Commit-message template expansion for the Source Control panel.
//
// The default commit message (Settings → GitHub sync, persisted as
// `defaultCommitMessage`) supports an Obsidian-Git-style `{{date}}` token.
// `expandCommitMessage` substitutes every occurrence with today's date so
// the SCM textarea shows the real message ("Sync from Noteser (2026-06-10)")
// instead of the literal placeholder — and so a `{{date}}` the user types
// by hand still resolves at commit time.
//
// The date uses the SAME formatter as daily-note titles (utils/dateFormat,
// local time, `YYYY-MM-DD`) — NOT `toISOString()`, which is UTC and rolls
// the date over up to a day early/late depending on the user's timezone.
// Other tokens are left as-is; future-extensible if we want {{count}} etc.

import { formatDate } from './dateFormat'

export function expandCommitMessage(raw: string, now: Date = new Date()): string {
  const today = formatDate(now, 'YYYY-MM-DD')
  return raw.replace(/\{\{date\}\}/g, today)
}
