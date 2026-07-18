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

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePluginStore, selectAllPluginPanels, type PluginPanelEntry } from '@/stores/pluginStore'
import { getPluginHost } from '@/plugins/pluginHostSingleton'
import { PluginNode, type PluginVNodeEvent } from '@/plugins/PluginVNode'
import { applySvgPositionPatches } from '@/plugins/svgPositionPatch'
import type { PluginHostEvent } from '@/plugins/PluginHost'

export const PluginsPanel = () => {
  const loaded = usePluginStore((s) => s.loaded)
  const panels: PluginPanelEntry[] = selectAllPluginPanels({ loaded } as never)

  // Per-(pluginId, panelId) content cache. Updates when the worker
  // emits panelContent for a panel that lives in this tab.
  const [contents, setContents] = useState<Record<string, unknown>>({})

  // v1.3 (L4) — per-panel container element, used by the position-patch
  // fast path to mutate the mounted svg directly (no React re-render).
  const sectionRefs = useRef<Map<string, HTMLElement | null>>(new Map())

  useEffect(() => {
    const host = getPluginHost()
    if (!host) return

    const handler = (event: PluginHostEvent) => {
      if (event.type === 'panelContent') {
        const key = `${event.pluginId}:${event.panelId}`
        setContents((prev) => ({ ...prev, [key]: event.node }))
        return
      }
      if (event.type === 'svgPositionsPatch') {
        // Apply to the matching panel section(s). A patch with an
        // explicit panelId targets that one; without it, every panel of
        // the emitting plugin.
        for (const p of panels) {
          if (p.pluginId !== event.pluginId) continue
          if (event.panelId !== undefined && p.panelId !== event.panelId) continue
          applySvgPositionPatches(sectionRefs.current.get(`${p.pluginId}:${p.panelId}`), event.patches)
        }
        return
      }
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

  // Build a `PluginNode` event handler scoped to a single (pluginId,
  // panelId). The renderer hands us the wire-level `PluginVNodeEvent`
  // (just `event` + `payload`); we wrap it with the `source` descriptor
  // and forward to the host. Rate-limited per plugin in PluginHost.
  //
  // Declared above the early return so the hook order stays stable —
  // rules-of-hooks forbids calling useCallback past a conditional.
  const makeHandler = useCallback(
    (pluginId: string, panelId: string) =>
      (e: PluginVNodeEvent) => {
        const host = getPluginHost()
        if (!host) return
        host.sendVNodeEvent(pluginId, { kind: 'panel', panelId }, e.event, e.payload, {
          highFrequency: e.highFrequency === true,
          ...(e.interaction ? { interaction: e.interaction } : {}),
        })
      },
    [],
  )

  if (panels.length === 0) {
    return (
      <div className="p-4 text-sm text-obsidianSecondaryText">
        No plugins installed yet.
        <br />
        <span className="text-xs">
          Use Settings → Plugins to add one — the built-in Graph plugin
          is a good first pick.
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
            <div
              ref={(el) => {
                sectionRefs.current.set(key, el)
              }}
              className="px-3 py-2 text-sm text-obsidianText whitespace-pre-wrap wrap-break-word"
            >
              {node === undefined ? (
                <span className="text-obsidianSecondaryText">(awaiting first render…)</span>
              ) : (
                <PluginNode node={node} onEvent={makeHandler(p.pluginId, p.panelId)} />
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
