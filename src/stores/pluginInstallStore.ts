// Persistent record of every plugin the user has installed. Lives
// in IndexedDB via the existing `idbStorage` adapter so a fresh page
// load can rehydrate the list, walk it, and load each enabled plugin
// into the PluginHost.
//
// The PluginHost (in-memory) tracks which plugins are CURRENTLY
// running. This store tracks which plugins are SUPPOSED to be
// running on next boot. Two distinct concerns, two stores.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { idbStorage } from '@/utils/idbStorage'
import type { PluginManifest, PluginPermission } from '@/plugins/manifest'

export interface InstalledPluginRecord {
  manifest: PluginManifest
  /** Verbatim plugin source, fetched at install time. Ships to the
   *  worker on every boot via `host:boot`. */
  mainSource: string
  /** SHA-256 hex of `mainSource` at install time. Compared on boot
   *  to detect a swapped bundle. */
  hash: string
  /** Manifest URL the user pasted. Used for "Update plugin" later. */
  sourceUrl: string
  /** Wall-clock when the user confirmed the install. */
  addedAt: number
  /** When `false`, the bootstrap skips this plugin on app load.
   *  Lets a user pause a misbehaving plugin without uninstalling. */
  enabled: boolean
  /** v1.2: per-install capability revocation list. Persisted across
   *  reboots — a permission revoked here stays revoked until the user
   *  re-grants it. The manifest's declared `permissions` list is the
   *  ceiling; revocation can only subtract from it. */
  revokedPermissions?: PluginPermission[]
}

interface PluginInstallState {
  /** Keyed by manifest.id. */
  records: Record<string, InstalledPluginRecord>

  install: (record: InstalledPluginRecord) => void
  uninstall: (pluginId: string) => void
  setEnabled: (pluginId: string, enabled: boolean) => void
  /** Mark a permission revoked for the given plugin. Idempotent. Used
   *  by Settings → Plugins to disable a capability at runtime; the
   *  PluginHost reads the same flag on boot to seed its in-memory
   *  revocation set. */
  setPermissionRevoked: (pluginId: string, permission: PluginPermission, revoked: boolean) => void
}

export const usePluginInstallStore = create<PluginInstallState>()(
  persist(
    (set) => ({
      records: {},

      install: (record) =>
        set((state) => ({
          records: { ...state.records, [record.manifest.id]: record },
        })),

      uninstall: (pluginId) =>
        set((state) => {
          if (!(pluginId in state.records)) return state
          const next = { ...state.records }
          delete next[pluginId]
          return { records: next }
        }),

      setEnabled: (pluginId, enabled) =>
        set((state) => {
          const cur = state.records[pluginId]
          if (!cur || cur.enabled === enabled) return state
          return {
            records: { ...state.records, [pluginId]: { ...cur, enabled } },
          }
        }),

      setPermissionRevoked: (pluginId, permission, revoked) =>
        set((state) => {
          const cur = state.records[pluginId]
          if (!cur) return state
          const existing = cur.revokedPermissions ?? []
          const alreadyRevoked = existing.includes(permission)
          if (revoked === alreadyRevoked) return state
          const next = revoked
            ? [...existing, permission]
            : existing.filter((p) => p !== permission)
          return {
            records: {
              ...state.records,
              [pluginId]: { ...cur, revokedPermissions: next },
            },
          }
        }),
    }),
    {
      name: 'noteser-plugin-installs',
      storage: idbStorage,
      version: 1,
    },
  ),
)
