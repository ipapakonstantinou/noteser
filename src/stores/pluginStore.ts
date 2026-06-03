// Tracks plugins that are currently loaded into the PluginHost +
// surfaces their declared commands / panels / code-block-renderers to
// the rest of the noteser app.
//
// This store is the read side of the plugin system. The PluginHost
// (src/plugins/PluginHost.ts) is the write side: it owns the Workers
// + the postMessage protocol. The singleton glue
// (src/plugins/pluginHostSingleton.ts) listens on PluginHost events
// and pushes the resulting state into this store.
//
// Decoupling them this way lets React components subscribe to plugin
// commands the same way they subscribe to notes — no special hooks,
// no manual re-render orchestration.

import { create } from 'zustand'
import type { PluginManifest } from '@/plugins/manifest'

export interface LoadedPlugin {
  manifest: PluginManifest
  /** Errors raised while the plugin was running. Most recent at the
   *  end. Cap at 20 entries to avoid unbounded memory. */
  errors: string[]
}

interface PluginState {
  /** Plugins keyed by manifest.id. */
  loaded: Record<string, LoadedPlugin>

  // ── mutations (called from pluginHostSingleton only) ─────────────
  addReady: (manifest: PluginManifest) => void
  remove: (pluginId: string) => void
  appendError: (pluginId: string, message: string) => void
  clear: () => void
}

const MAX_ERRORS = 20

export const usePluginStore = create<PluginState>()((set) => ({
  loaded: {},

  addReady: (manifest) =>
    set((state) => ({
      loaded: { ...state.loaded, [manifest.id]: { manifest, errors: [] } },
    })),

  remove: (pluginId) =>
    set((state) => {
      if (!(pluginId in state.loaded)) return state
      const next = { ...state.loaded }
      delete next[pluginId]
      return { loaded: next }
    }),

  appendError: (pluginId, message) =>
    set((state) => {
      const cur = state.loaded[pluginId]
      if (!cur) return state
      const errors = [...cur.errors, message].slice(-MAX_ERRORS)
      return { loaded: { ...state.loaded, [pluginId]: { ...cur, errors } } }
    }),

  clear: () => set({ loaded: {} }),
}))

/** Flat list of every command across every loaded plugin, with the
 *  plugin's namespaced id so two plugins can ship the same local
 *  command id without collision. */
export interface PluginCommandEntry {
  pluginId: string
  /** Local id within the plugin (the `id` field of the PluginCommand). */
  commandId: string
  title: string
  shortcut?: string
  pluginName: string
}

export function selectAllPluginCommands(state: PluginState): PluginCommandEntry[] {
  const out: PluginCommandEntry[] = []
  for (const plugin of Object.values(state.loaded)) {
    const cmds = plugin.manifest.surfaces.commands ?? []
    for (const cmd of cmds) {
      out.push({
        pluginId: plugin.manifest.id,
        commandId: cmd.id,
        title: cmd.title,
        ...(cmd.shortcut !== undefined ? { shortcut: cmd.shortcut } : {}),
        pluginName: plugin.manifest.name,
      })
    }
  }
  return out
}

export interface PluginPanelEntry {
  pluginId: string
  panelId: string
  title: string
  icon?: string
  pluginName: string
}

export function selectAllPluginPanels(state: PluginState): PluginPanelEntry[] {
  const out: PluginPanelEntry[] = []
  for (const plugin of Object.values(state.loaded)) {
    const panels = plugin.manifest.surfaces.sidebarPanels ?? []
    for (const p of panels) {
      out.push({
        pluginId: plugin.manifest.id,
        panelId: p.id,
        title: p.title,
        ...(p.icon !== undefined ? { icon: p.icon } : {}),
        pluginName: plugin.manifest.name,
      })
    }
  }
  return out
}

export interface PluginRendererEntry {
  pluginId: string
  language: string
  pluginName: string
}

export function selectAllPluginRenderers(state: PluginState): PluginRendererEntry[] {
  const out: PluginRendererEntry[] = []
  for (const plugin of Object.values(state.loaded)) {
    const renderers = plugin.manifest.surfaces.codeBlockRenderers ?? []
    for (const r of renderers) {
      out.push({
        pluginId: plugin.manifest.id,
        language: r.language,
        pluginName: plugin.manifest.name,
      })
    }
  }
  return out
}
