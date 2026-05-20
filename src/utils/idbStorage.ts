// Zustand-compatible async storage adapter backed by IndexedDB via idb-keyval.
// Drop-in replacement for localStorage in persist() — no size limit.
//
// PERFORMANCE NOTE — per-key write debounce:
//   Zustand's persist middleware writes the FULL store JSON on every state
//   change. For a vault with hundreds of notes (each note's content can be
//   1-10KB), that's a multi-MB IDB write per keystroke (via debouncedSave
//   in CodeMirrorEditor). Chrome paused us at "Paused before potential
//   out-of-memory crash" because the IDB queue couldn't keep up.
//
//   We coalesce successive writes per key in a 250ms window. Reads are
//   served from the latest in-memory pending value so a getItem right
//   after setItem still sees the new state. A beforeunload listener
//   flushes any pending writes so a fast tab-close doesn't lose them.
import { get, set, del } from 'idb-keyval'
import { createJSONStorage } from 'zustand/middleware'

const DEBOUNCE_MS = 250

interface PendingWrite {
  value: string
  timer: ReturnType<typeof setTimeout>
}

// Per-key pending state. Multi-key is necessary because Zustand uses
// multiple persisted stores (notes / folders / workspace / …) each with
// its own key — they shouldn't share a debouncer.
const pending = new Map<string, PendingWrite>()

function scheduleWrite(name: string, value: string): void {
  const existing = pending.get(name)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    pending.delete(name)
    // Fire-and-forget — return value is unused by Zustand for setItem.
    void set(name, value)
  }, DEBOUNCE_MS)
  pending.set(name, { value, timer })
}

// Flush every pending write synchronously. Called on beforeunload so a
// fast tab-close doesn't lose the last edit. idb-keyval's set() returns
// a promise but the underlying IDB transaction is already queued; the
// browser flushes outstanding IDB transactions on unload.
function flushPending(): void {
  for (const [name, p] of pending) {
    clearTimeout(p.timer)
    void set(name, p.value)
  }
  pending.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPending)
  // Also flush on visibilitychange (going to background on mobile / when
  // the tab is hidden — beforeunload doesn't fire on mobile in many
  // cases). Safer to over-flush than under-flush.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending()
  })
}

const idbBackend = {
  getItem: (name: string): Promise<string | null> => {
    // Pending write hasn't landed in IDB yet — serve it from memory so
    // the reader sees the freshest state.
    const p = pending.get(name)
    if (p) return Promise.resolve(p.value)
    return get<string>(name).then(v => v ?? null)
  },
  setItem: (name: string, value: string): Promise<void> => {
    scheduleWrite(name, value)
    return Promise.resolve()
  },
  removeItem: (name: string): Promise<void> => {
    // Cancel any pending write for this key — delete wins.
    const p = pending.get(name)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(name)
    }
    return del(name)
  },
}

export const idbStorage = createJSONStorage(() => idbBackend)
