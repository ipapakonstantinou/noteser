'use client'

import { useUIStore } from '@/stores'
import { PanelRightIcon } from '@/components/ui'
import { PropertiesPanel } from './PropertiesPanel'
import { BacklinksView } from './BacklinksView'

// Obsidian-style right sidebar. v2 hosts Properties + Backlinks behind
// a small two-pill tab switcher. Future panels (Outline, Local Graph)
// would slot in via the same `rightSidebarTab` union extension.
//
// Always renders a thin right-edge strip (~32px) with a PanelRightIcon
// toggle. Clicking the toggle expands the sidebar to ~280px and reveals
// the active panel's body. Open/closed + active-tab state lives in
// useUIStore (`rightSidebarOpen` + `rightSidebarTab`). Both persisted.
//
// Hidden on mobile entirely — the mobile layout is single-pane and a
// second sidebar would crowd out the editor at phone widths.

interface Props {
  // When true, the wrapper renders nothing (mobile keeps the existing
  // single-pane shape). Passed in from page.tsx so the responsive
  // decision stays at the layout boundary, not inside this component.
  hidden?: boolean
}

export const RightSidebar = ({ hidden = false }: Props) => {
  const open = useUIStore(s => s.rightSidebarOpen)
  const toggle = useUIStore(s => s.toggleRightSidebar)
  const tab = useUIStore(s => s.rightSidebarTab)
  const setTab = useUIStore(s => s.setRightSidebarTab)

  if (hidden) return null

  return (
    <aside
      className={`flex-none flex flex-col h-full border-l border-obsidianBorder bg-obsidianBlack transition-[width] duration-200 ${
        open ? 'w-[280px]' : 'w-[32px]'
      }`}
      aria-label="Note properties"
      data-testid="right-sidebar"
      data-open={open ? 'true' : 'false'}
    >
      {/* Header row — tab switcher (when expanded) on the left, the
          collapse toggle on the right. Borders the body. */}
      <div className="flex items-center justify-between border-b border-obsidianBorder">
        {open ? (
          <div className="flex-1 flex items-center px-1 py-1 gap-0.5" role="tablist">
            <TabPill
              active={tab === 'properties'}
              label="Properties"
              onClick={() => setTab('properties')}
              testid="right-sidebar-tab-properties"
            />
            <TabPill
              active={tab === 'backlinks'}
              label="Backlinks"
              onClick={() => setTab('backlinks')}
              testid="right-sidebar-tab-backlinks"
            />
          </div>
        ) : (
          // Spacer so the toggle stays right-aligned when collapsed.
          <div className="flex-1" />
        )}
        <button
          type="button"
          onClick={toggle}
          title={open ? 'Collapse right panel' : 'Open right panel'}
          aria-label={open ? 'Collapse right panel' : 'Open right panel'}
          aria-expanded={open}
          aria-controls="right-sidebar-body"
          className="p-2 text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText transition-colors inline-flex items-center justify-center flex-none"
          data-testid="right-sidebar-toggle"
        >
          <PanelRightIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Body only renders when open — keeps the noteStore subscriptions
          quiet while the panel is collapsed. */}
      {open && (
        <div
          id="right-sidebar-body"
          className="flex-1 min-h-0 overflow-y-auto"
          role="tabpanel"
        >
          {tab === 'properties' ? <PropertiesPanel /> : <BacklinksView />}
        </div>
      )}
    </aside>
  )
}

const TabPill = ({
  active, label, onClick, testid,
}: { active: boolean; label: string; onClick: () => void; testid: string }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={`px-2 py-1 text-xs rounded transition-colors ${
      active
        ? 'bg-obsidianAccentPurple/15 text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText'
    }`}
    data-testid={testid}
  >
    {label}
  </button>
)

export default RightSidebar
