'use client'

import { EyeIcon } from '@heroicons/react/24/outline'
import { PANELS } from '@/components/sidebar/sidebarPanelRegistry'
import { useSettingsStore } from '@/stores'
import { PanelHeading } from '../PanelHeading'

export function SidebarPanel() {
  const hiddenSidebarTabs = useSettingsStore(s => s.hiddenSidebarTabs)
  const showSidebarTab = useSettingsStore(s => s.showSidebarTab)
  // Resolve hidden ids to panel definitions so we can show their label
  // + icon. Unknown ids (stale entries from a removed panel) are dropped.
  const hiddenPanels = hiddenSidebarTabs
    .map(id => PANELS.find(p => p.id === id))
    .filter((p): p is (typeof PANELS)[number] => Boolean(p))

  return (
    <div className="space-y-5">
      <PanelHeading>Sidebar tabs</PanelHeading>
      <p className="text-sm text-obsidianSecondaryText">
        Hide tabs you don&apos;t use from the sidebar strip by right-clicking
        the icon. Hidden tabs show up here — click &ldquo;Show&rdquo; to
        restore them. Hidden tabs are auto-unpinned and rejoin the bottom
        strip in their default position.
      </p>

      {hiddenPanels.length === 0 ? (
        <div className="text-sm text-obsidianSecondaryText italic px-2 py-3 border border-obsidianBorder rounded">
          No hidden tabs. Right-click any sidebar tab icon to hide it.
        </div>
      ) : (
        <div
          className="border border-obsidianBorder rounded divide-y divide-obsidianBorder"
          data-testid="settings-hidden-tabs"
        >
          {hiddenPanels.map(p => {
            const Icon = p.Icon
            return (
              <div
                key={p.id}
                className="flex items-center justify-between px-3 py-2"
                data-testid={`settings-hidden-tab-${p.id}`}
              >
                <span className="flex items-center gap-2 text-sm text-obsidianText">
                  <Icon className="w-4 h-4 text-obsidianSecondaryText" />
                  {p.title}
                </span>
                <button
                  type="button"
                  onClick={() => showSidebarTab(p.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-obsidianAccentPurple hover:bg-obsidianHighlight rounded transition-colors"
                  data-testid={`settings-show-tab-${p.id}`}
                >
                  <EyeIcon className="w-3.5 h-3.5" />
                  Show
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
