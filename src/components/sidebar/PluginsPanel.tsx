'use client'

// Single sidebar panel that surfaces every loaded plugin's
// declared sidebar panel as a stacked section inside it.
//
// Why this shape and not one tab per plugin panel:
//   - Plugin panels appear and disappear at runtime; the
//     sidebar's tab strip + the saved tab-order persistence
//     layer expect a closed set of `SidebarTabId` values
//   - Stacking inside one host-owned tab keeps the dynamic
//     surface contained: one PANELS entry, one PanelBody case,
//     no churn to SidebarStack / TabSwitcher / persistence
//   - User reads it as "this tab is where plugin stuff lives"
//
// Each section's body is the most recent virtual-DOM tree the
// plugin pushed via `ctx.setPanelContent`. For week 2 we
// render the tree as a JSON-stringified preview; week 4 swaps
// in the real VNode → React mapper (see docs/plugins-plan.md
// "VNode" section).

import { useEffect, useState } from 'react'
import { usePluginStore, selectAllPluginPanels, type PluginPanelEntry } from '@/stores/pluginStore'
import { getPluginHost } from '@/plugins/pluginHostSingleton'
import { PluginNode } from '@/plugins/PluginVNode'
import type { PluginHostEvent } from '@/plugins/PluginHost'

export const PluginsPanel = () => {
  const loaded = usePluginStore((s) => s.loaded)
  const panels: PluginPanelEntry[] = selectAllPluginPanels({ loaded } as never)

  // Per-(pluginId, panelId) content cache. Updates when the worker
  // emits panelContent for a panel that lives in this tab.
  const [contents, setContents] = useState<Record<string, unknown>>({})

  useEffect(() => {
    const host = getPluginHost()
    if (!host) return

    const handler = (event: PluginHostEvent) => {
      if (event.type !== 'panelContent') return
      const key = `${event.pluginId}:${event.panelId}`
      setContents((prev) => ({ ...prev, [key]: event.node }))
    }
    const unsubscribe = host.on(handler)

    // Mount every currently-loaded plugin panel so the plugin's
    // onPanelMount handler runs and emits initial content. The
    // unmount call happens in the cleanup below.
    for (const p of panels) host.mountPanel(p.pluginId, p.panelId)

    return () => {
      unsubscribe()
      for (const p of panels) host.unmountPanel(p.pluginId, p.panelId)
    }
    // Re-run when the set of panel ids changes — that is when a
    // plugin loads or unloads. The host reference itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels.map((p) => `${p.pluginId}:${p.panelId}`).join('|')])

  if (panels.length === 0) {
    return (
      <div className="p-4 text-sm text-obsidianSecondaryText">
        No plugins installed yet.
        <br />
        <span className="text-xs">
          Use Settings → Plugins to add one. (Coming in week 3 of v1.)
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {panels.map((p) => {
        const key = `${p.pluginId}:${p.panelId}`
        const node = contents[key]
        return (
          <section key={key} className="border-b border-obsidianBorder">
            <header className="px-3 py-2 flex items-baseline justify-between bg-obsidianHighlight/30">
              <span className="text-sm font-medium text-obsidianText">{p.title}</span>
              <span className="text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
                {p.pluginName}
              </span>
            </header>
            <div className="px-3 py-2 text-sm text-obsidianText whitespace-pre-wrap break-words">
              {node === undefined ? (
                <span className="text-obsidianSecondaryText">(awaiting first render…)</span>
              ) : (
                <PluginNode node={node} />
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
