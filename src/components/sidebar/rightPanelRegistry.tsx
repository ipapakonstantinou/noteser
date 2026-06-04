'use client'

// Right-sidebar panel registry — mirrors `sidebarPanelRegistry.tsx`
// for the right edge. SEPARATE from the left registry on purpose: the
// two sides hold different panels (Properties + Backlinks live only
// on the right; Files / Outline / Search live only on the left), and
// the drag/drop MIMEs are distinct so dragging a left-side tab over
// the right ribbon does NOT silently spawn a Files group on the right.
//
// Default panels (v1): Properties + Backlinks. Future right-side
// panels (Outline, Local Graph, …) plug in here without touching the
// left side.

import {
  InformationCircleIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { PropertiesPanel } from './PropertiesPanel'
import { BacklinksView } from './BacklinksView'

// IDs of panels available in the RIGHT sidebar. Kept narrow on purpose
// — the right side is for note-context views, not vault navigation.
export type RightSidebarTabId = 'properties' | 'backlinks'

interface RightPanelDef {
  id: RightSidebarTabId
  Icon: typeof InformationCircleIcon
  title: string
}

export const RIGHT_PANELS: readonly RightPanelDef[] = [
  { id: 'properties', Icon: InformationCircleIcon, title: 'Properties' },
  { id: 'backlinks',  Icon: LinkIcon,              title: 'Backlinks' },
]

export const RIGHT_KNOWN_IDS = new Set<RightSidebarTabId>(
  RIGHT_PANELS.map(p => p.id),
)

// MIME shared by every right-side strip + the right ribbon so cross-
// zone drops work without coupling. DIFFERENT from the left's
// TAB_DRAG_MIME so a left-side drag never accidentally lands on a
// right-side drop target (the dataTransfer check filters on the
// specific MIME).
export const RIGHT_TAB_DRAG_MIME = 'application/x-noteser-right-sidebar-tab'

// Body renderer keyed by id. The actual content components are the
// existing PropertiesPanel + BacklinksView — moving them into the
// right registry doesn't change their behaviour, only how they're
// looked up.
export const RightPanelBody = ({ id }: { id: RightSidebarTabId }) => {
  switch (id) {
    case 'properties': return <PropertiesPanel />
    case 'backlinks':  return <BacklinksView />
  }
}
