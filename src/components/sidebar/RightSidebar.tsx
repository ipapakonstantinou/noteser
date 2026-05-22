'use client'

import { useUIStore } from '@/stores'
import { PanelRightIcon } from '@/components/ui'
import { PropertiesPanel } from './PropertiesPanel'

// Obsidian-style right sidebar. v1 hosts a single Properties tab; future
// passes will add Outline / Backlinks alongside, but keeping it narrow
// for the first ship lets us validate the layout + collapse model
// before broadening the surface.
//
// Always renders a thin right-edge strip (~32px) with a PanelRightIcon
// toggle. Clicking the toggle expands the sidebar to ~280px and
// reveals the panel body. Open/closed state lives in useUIStore as
// `rightSidebarOpen`. Persisted (uiStore partializer includes it).
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
      {/* Toggle strip — always visible. When collapsed it's the entire
          width of the sidebar; when expanded it sits in the top-right
          like a panel header. */}
      <div className="flex items-center justify-end border-b border-obsidianBorder">
        <button
          type="button"
          onClick={toggle}
          title={open ? 'Collapse properties panel' : 'Open properties panel'}
          aria-label={open ? 'Collapse properties panel' : 'Open properties panel'}
          aria-expanded={open}
          aria-controls="right-sidebar-body"
          className="p-2 text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText transition-colors inline-flex items-center justify-center"
          data-testid="right-sidebar-toggle"
        >
          <PanelRightIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Body only renders when open — avoids querying the noteStore
          for the selected note on every render while the panel is
          collapsed. */}
      {open && (
        <div
          id="right-sidebar-body"
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <PropertiesPanel />
        </div>
      )}
    </aside>
  )
}

export default RightSidebar
