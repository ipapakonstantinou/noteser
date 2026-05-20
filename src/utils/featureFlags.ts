// Named beta flags + the `useFlag` hook used to gate experimental UI.
//
// Lifecycle (see docs/beta-and-bug-reporting.md for details):
//   1. Add a flag here.
//   2. Use it via `useFlag(FLAGS.x)` to wrap the experimental code path.
//   3. When the feature graduates, REMOVE the flag and the gate — keeping
//      a flag indefinitely is debt.
//
// Each entry has a `label` and `description` so the Settings UI can render
// a checkbox row per flag without needing a separate metadata table.

import { useSettingsStore } from '@/stores/settingsStore'

export interface FlagDef {
  id: string
  label: string
  description: string
}

export const FLAGS: readonly FlagDef[] = [
  // Examples — feel free to add real ones below and remove these as they ship.
  {
    id: 'database-view',
    label: 'Database / table view',
    description: 'Render notes filtered by frontmatter as an editable table (work-in-progress).',
  },
  {
    id: 'share-via-url',
    label: 'Share via secret URL',
    description: 'One-click read-only public links for a note (work-in-progress).',
  },
]

// Convenience map for hand-written code:
//   useFlag(FLAG_IDS.databaseView)
// Saves the typo-trap of stringly-typed flag ids.
export const FLAG_IDS = {
  databaseView: 'database-view',
  shareViaUrl: 'share-via-url',
} as const

// React hook: returns true ONLY when the master `betaEnabled` switch is on
// AND the specific flag is set to true. Subscribes narrowly so a flip of
// one flag doesn't churn unrelated components.
export function useFlag(id: string): boolean {
  return useSettingsStore(s => s.betaEnabled && s.betaFlags[id] === true)
}

// Imperative variant for non-React code (utilities, tests).
export function isFlagOn(id: string): boolean {
  const s = useSettingsStore.getState()
  return s.betaEnabled && s.betaFlags[id] === true
}
