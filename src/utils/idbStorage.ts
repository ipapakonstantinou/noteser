// Zustand-compatible async storage adapter backed by IndexedDB via idb-keyval.
// Drop-in replacement for localStorage in persist() — no size limit.
import { get, set, del } from 'idb-keyval'
import { createJSONStorage } from 'zustand/middleware'

const idbBackend = {
  getItem: (name: string): Promise<string | null> =>
    get<string>(name).then(v => v ?? null),
  setItem: (name: string, value: string): Promise<void> =>
    set(name, value),
  removeItem: (name: string): Promise<void> =>
    del(name),
}

export const idbStorage = createJSONStorage(() => idbBackend)
