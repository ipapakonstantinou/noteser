'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { useUIStore, type SidebarSectionId, DEFAULT_SECTION_HEIGHT } from '@/stores'

interface Props {
  id: SidebarSectionId
  title: string
  icon?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
  // Minimum content height (in px) when expanded. Header chrome is added
  // on top of this. Default 80.
  minHeight?: number
  // When set, the header carries a draggable handle that emits this
  // panel id on dragstart. SidebarStack listens for the matching MIME
  // and lets users drop pinned-top sections into the tab strip below.
  draggablePanelId?: string
  // Optional context-menu handler for the section header — used for
  // the "right-click to unpin from top" affordance on pinned panels.
  onHeaderContextMenu?: (e: React.MouseEvent) => void
  // Render the panel without a section header (no chevron, no
  // uppercase label, no collapse). Used for the pinned Calendar —
  // the user explicitly wants it to render like the file tree below
  // (just content, no "CALENDAR" bar). The right-click-to-unpin
  // gesture still works from the content area.
  hideHeader?: boolean
}

// A collapsible, vertically-resizable section in the stacked sidebar.
// Persists collapse + height to useUIStore. Drag the bottom border to
// resize. Click the header (anywhere except the actions row) to toggle.
//
// Layout: when expanded, the section reserves `state.height` px including
// the header. When collapsed, only the header (~28px) is visible. The
// FilesTree section is NOT one of these — it uses flex-fill and doesn't
// import this component.
// MIME used when a pinned section header is dragged. Matches the
// constant in SidebarStack so cross-zone drops work without coupling
// the two files. Exported for tests / external listeners.
export const SIDEBAR_PANEL_DRAG_MIME = 'application/x-noteser-sidebar-panel'

export const SidebarSection = ({
  id,
  title,
  icon,
  badge,
  actions,
  children,
  minHeight = 80,
  draggablePanelId,
  onHeaderContextMenu,
  hideHeader = false,
}: Props) => {
  const section = useUIStore(s => s.sidebarSections[id])
  const toggle = useUIStore(s => s.toggleSidebarSection)
  const setHeight = useUIStore(s => s.setSidebarSectionHeight)

  // Header-less sections are always treated as expanded so the
  // content is always visible — there's no chevron to toggle.
  const collapsed = hideHeader ? false : (section?.collapsed ?? true)
  const height = section?.height ?? DEFAULT_SECTION_HEIGHT

  // Resize state. We track the in-flight height in local state so the
  // user gets continuous visual feedback; only on mouseup do we commit
  // to the store (avoids hammering persist + re-renders during drag).
  const [dragging, setDragging] = useState(false)
  const [draftHeight, setDraftHeight] = useState<number | null>(null)
  const startRef = useRef<{ y: number; h: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return
      const dy = e.clientY - startRef.current.y
      const next = Math.max(minHeight, startRef.current.h + dy)
      setDraftHeight(next)
    }
    const onUp = () => {
      if (draftHeight != null) setHeight(id, draftHeight)
      setDragging(false)
      setDraftHeight(null)
      startRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, draftHeight, id, minHeight, setHeight])

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startRef.current = { y: e.clientY, h: height }
    setDraftHeight(height)
    setDragging(true)
  }

  const effectiveHeight = collapsed ? undefined : (draftHeight ?? height)

  return (
    <div
      className="flex-shrink-0 border-t border-obsidianBorder flex flex-col"
      style={collapsed ? undefined : { height: effectiveHeight }}
      data-section-id={id}
    >
      {/* Header. Skipped entirely when hideHeader is set — the panel
          then looks like a normal block of content with no chevron or
          uppercase label. The right-click-unpin gesture lives on the
          content wrapper instead so users can still get out. */}
      {!hideHeader && (
        <button
          type="button"
          onClick={() => toggle(id)}
          onContextMenu={onHeaderContextMenu}
          draggable={Boolean(draggablePanelId)}
          onDragStart={(e: React.DragEvent) => {
            if (!draggablePanelId) return
            // See PinnedMiniStrip — right-click on a draggable header
            // can fire dragstart in Firefox + Chromium-Linux. Gate so
            // the unpin context-menu action doesn't ghost-drag.
            if (e.nativeEvent && e.nativeEvent.button !== 0) return
            e.dataTransfer.setData(SIDEBAR_PANEL_DRAG_MIME, draggablePanelId)
            e.dataTransfer.effectAllowed = 'move'
          }}
          className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-obsidianSecondaryText hover:bg-obsidianDarkGray transition-colors w-full text-left ${
            draggablePanelId ? 'cursor-default active:cursor-grabbing' : ''
          }`}
          aria-expanded={!collapsed}
          aria-controls={`sidebar-section-content-${id}`}
        >
          <ChevronRightIcon
            className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          {icon && <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>}
          <span className="flex-1 truncate">{title}</span>
          {badge}
          {actions && (
            <span
              className="flex items-center gap-1"
              onClick={e => e.stopPropagation()}
            >
              {actions}
            </span>
          )}
        </button>
      )}

      {/* Content */}
      {!collapsed && (
        <div
          id={`sidebar-section-content-${id}`}
          className="flex-1 min-h-0 overflow-y-auto"
          // When the header is hidden, the content wrapper inherits
          // the right-click handler so users still have a path to
          // unpin the panel. preventDefault is the caller's job.
          onContextMenu={hideHeader ? onHeaderContextMenu : undefined}
        >
          {children}
        </div>
      )}

      {/* Resize handle — bottom border, only when expanded. The
          actual hit target is h-2 (8px) so it's easy to grab; we
          show a subtler 2px stripe in the middle so the affordance
          isn't visually heavy at rest. On hover/drag the full
          target lights up in purple. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title}`}
          onMouseDown={onResizeStart}
          className={`group h-2 cursor-row-resize flex-shrink-0 flex items-center justify-center ${
            dragging ? 'bg-obsidianAccentPurple' : 'hover:bg-obsidianAccentPurple/30'
          } transition-colors`}
        >
          {!dragging && (
            <span className="block w-8 h-[2px] rounded-full bg-obsidianBorder group-hover:bg-obsidianAccentPurple/80 transition-colors" />
          )}
        </div>
      )}
    </div>
  )
}

export default SidebarSection
