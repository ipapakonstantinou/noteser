'use client'

import { useMemo, useState } from 'react'
import { PanelLeftIcon, PanelRightIcon } from '@/components/ui'
import { useShallow } from 'zustand/react/shallow'
import {
  useUIStore,
  useSettingsStore,
} from '@/stores'
import { TabContextMenu } from './TabContextMenu'
import {
  RIGHT_PANELS,
  RIGHT_TAB_DRAG_MIME,
  type RightSidebarTabId,
} from './rightPanelRegistry'
import {
  activateRightPanelFromActivityBar,
  findRightGroupWithTab,
} from './rightSidebarGroupActions'

// Right-edge activity bar — mirror of `Ribbon.tsx` but pinned to the
// right-side registry. Top to bottom:
//   1. Collapse-right-sidebar toggle.
//   2. Panel icons for any right-side panel NOT currently in a group.
//   3. Settings at the bottom (mt-auto).
//
// Distinct from the left ribbon on purpose:
//   - Right side has no quick-launch ACTIONS column (search /
//     new-note already live on the left; duplicating them here would
//     just add visual noise to a panel that's about the CURRENT
//     note's metadata).
//   - Right side has no hidden-tabs list — see RightSidebarStack
//     for the rationale.
//
// Drag/drop emits RIGHT_TAB_DRAG_MIME so left-side drop targets ignore
// right-side payloads and vice versa.
export const RightRibbon = () => {
  const rightSidebarCollapsed = useUIStore(s => s.rightSidebarCollapsed)
  const setRightSidebarCollapsed = useUIStore(s => s.setRightSidebarCollapsed)

  const {
    rightSidebarGroups,
    sidebarGroups,
  } = useSettingsStore(useShallow(s => ({
    rightSidebarGroups: s.rightSidebarGroups,
    sidebarGroups: s.sidebarGroups,
  })))

  // Same rule as the left ribbon — a panel currently shown in a
  // group does NOT get an icon in the activity bar; the group's
  // mini-strip is its switcher. Updated 2026-06-04 to inspect BOTH
  // sides: a panel parked in a LEFT group is also hidden from the
  // right bar (otherwise the user could conjure a duplicate by
  // dragging a left panel across and then clicking the right icon).
  const inAnyGroup = useMemo(() => {
    const set = new Set<string>()
    for (const g of rightSidebarGroups) {
      for (const t of g.tabs) set.add(t)
    }
    for (const g of sidebarGroups) {
      for (const t of g.tabs) set.add(t)
    }
    return set
  }, [rightSidebarGroups, sidebarGroups])
  const visiblePanels = useMemo(
    () => RIGHT_PANELS.filter(p => !inAnyGroup.has(p.id)),
    [inAnyGroup],
  )

  const onPanelClick = (id: RightSidebarTabId) => {
    activateRightPanelFromActivityBar(id)
  }

  const onPanelDragStart = (id: RightSidebarTabId) => (e: React.DragEvent) => {
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(RIGHT_TAB_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
  }

  // Right-click panel menu — at minimum offers "Close" (remove from
  // its group). "Hide" is wired to a no-op + close since the right
  // side has no hidden-tabs list.
  const [panelMenu, setPanelMenu] = useState<{ id: RightSidebarTabId; x: number; y: number } | null>(null)
  const openPanelMenu = (id: RightSidebarTabId, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPanelMenu({ id, x: e.clientX, y: e.clientY })
  }
  const closePanelMenu = () => setPanelMenu(null)
  const handleMenuClose = () => {
    if (!panelMenu) return
    const owner = findRightGroupWithTab(useSettingsStore.getState().rightSidebarGroups, panelMenu.id)
    if (owner) {
      useSettingsStore.getState().removeTabFromRightGroup(owner.id, panelMenu.id)
    }
    closePanelMenu()
  }

  return (
    <div
      className="h-full w-[44px] max-md:w-12 flex flex-col items-center gap-1 py-2 bg-obsidianBlack border-l border-obsidianBorder"
      data-testid="right-activity-bar"
    >
      {/* Collapse toggle — mirror of the left ribbon's first button.
          PanelRightIcon when expanded (the panel is to the LEFT of the
          bar, so "panel right of bar" is misleading — but the icon set
          we have is symmetric, so we just swap the two on collapse). */}
      <div className="mb-1.5">
        <RibbonButton
          onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
          title={rightSidebarCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'}
          testId="right-activity-bar-collapse-toggle"
        >
          {rightSidebarCollapsed
            ? <PanelLeftIcon className="w-5 h-5" />
            : <PanelRightIcon className="w-5 h-5" />}
        </RibbonButton>
      </div>

      <div
        className="flex flex-col items-center gap-1 w-full"
        data-testid="right-activity-bar-panels"
      >
        {visiblePanels.map(def => {
          const Icon = def.Icon
          // RIGHT_PANELS is the source of visiblePanels — every id in
          // it is a right-native id ('properties' | 'backlinks'),
          // which the wider RightSidebarTabId union includes.
          const id = def.id as RightSidebarTabId
          return (
            <div
              key={`right-panel-${def.id}`}
              draggable
              onDragStart={onPanelDragStart(id)}
              data-testid={`right-activity-bar-panel-${def.id}`}
            >
              <RibbonButton
                onClick={() => onPanelClick(id)}
                onContextMenu={(e) => openPanelMenu(id, e)}
                title={`${def.title} — drag to a right sidebar group, right-click for options`}
              >
                <Icon className="w-5 h-5" />
              </RibbonButton>
            </div>
          )
        })}
      </div>

      {panelMenu && (
        <TabContextMenu
          x={panelMenu.x}
          y={panelMenu.y}
          onClose={handleMenuClose}
          onMoveToNewGroup={() => {
            if (!panelMenu) return
            void import('./rightSidebarGroupActions').then(m => m.moveTabToNewRightGroup(panelMenu.id))
            closePanelMenu()
          }}
          // Right-side panels can't be hidden today — close the menu
          // and the hide row is treated as a no-op. See
          // RightSidebarStack for the reasoning.
          onHide={closePanelMenu}
          onDismiss={closePanelMenu}
        />
      )}
    </div>
  )
}

const RibbonButton = ({
  onClick, onContextMenu, title, children, active, testId,
}: {
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
  active?: boolean
  testId?: string
}) => (
  <button
    onClick={onClick}
    onContextMenu={onContextMenu}
    title={title}
    data-testid={testId}
    aria-pressed={active}
    className={[
      'p-2 max-md:p-2.5 rounded-sm transition-colors inline-flex items-center justify-center max-md:min-w-[44px] max-md:min-h-[44px]',
      active
        ? 'bg-obsidianHighlight text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText',
    ].join(' ')}
  >
    {children}
  </button>
)

export default RightRibbon
