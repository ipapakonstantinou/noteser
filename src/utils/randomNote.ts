// Random Note — Wikipedia-style "Random article" for your vault.
// Picks a uniformly-random non-deleted note and opens it in the
// active pane. No-op if the vault is empty.

import { useNoteStore } from '@/stores/noteStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

// Pure helper for tests: pick a random note id from a list, avoiding
// `excludeId` when possible. Returns null if no candidates exist.
// Caller passes `Math.random` (or a seeded source) so tests can pin
// the outcome.
export function pickRandomNoteId(
  notes: { id: string; isDeleted: boolean }[],
  excludeId: string | null,
  rng: () => number = Math.random,
): string | null {
  const active = notes.filter(n => !n.isDeleted)
  if (active.length === 0) return null
  // Exclude the currently-open note if there's at least one other to
  // pick — otherwise return it (better than null when the vault has
  // one note).
  const pool = excludeId && active.length > 1
    ? active.filter(n => n.id !== excludeId)
    : active
  const idx = Math.floor(rng() * pool.length)
  return pool[idx].id
}

// Side-effecting wrapper used by the keyboard handler, ribbon button,
// and command palette entry.
export function openRandomNote(): void {
  const noteStore = useNoteStore.getState()
  const ws = useWorkspaceStore.getState()
  // Avoid the currently-active note (best-effort — `selectedNoteId`
  // is what the sidebar tracks).
  const currentId = noteStore.selectedNoteId ?? null
  const pickedId = pickRandomNoteId(noteStore.notes, currentId)
  if (!pickedId) return
  ws.openNote(pickedId, { preview: false })
}
