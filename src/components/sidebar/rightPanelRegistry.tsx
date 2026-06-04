'use client'

// Right-sidebar panel registry — mirrors `sidebarPanelRegistry.tsx`
// for the right edge. The two registries hold different DEFAULT panels
// (Properties + Backlinks default-live on the right; Files / Outline /
// Search default-live on the left), but as of 2026-06-04 the model
// allows ANY left panel to also live on the right (and vice versa)
// via cross-sidebar drag.
//
// Cross-sidebar moves: user feedback (Telegram, 2026-06-04):
//   "μπορώ να μπορώ να πάρω το px plugin και να το πάω στη δεξιά μπάρα;
//    αυτή τη στιγμή δεν φαίνεται να γίνεται" — the previous MIME
// isolation silently rejected the drag at the right-side drop targets.
// We now share TAB_DRAG_MIME across both sides; the drop handlers
// detect which side currently owns the tab to route across (see
// moveTabAcrossSidebars in sidebarGroupActions).
//
// Default panels (v1): Properties + Backlinks. Future right-side
// panels (Outline, Local Graph, …) plug in here without touching the
// left side. RIGHT_DEFAULT_IDS = the panels the right activity bar
// surfaces. RIGHT_KNOWN_IDS = every id the right side will accept in
// a group (defaults + every left-side panel id).

import {
  InformationCircleIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { PropertiesPanel } from './PropertiesPanel'
import { BacklinksView } from './BacklinksView'
import {
  PANELS,
  PanelBody,
  TAB_DRAG_MIME,
  type PanelRightClick,
} from './sidebarPanelRegistry'
import { type SidebarTabId } from '@/stores'

// Right-side panel id union — narrow native ids PLUS any left-side
// panel that may have been dragged across. The right STACK accepts
// any SidebarTabId; the right ACTIVITY BAR only surfaces the native
// defaults below.
type RightNativeId = 'properties' | 'backlinks'
export type RightSidebarTabId = RightNativeId | SidebarTabId

// Generic icon component type — heroicons' actual component is a
// ForwardRefExoticComponent, so we widen to "any component with an
// optional className" here to keep the def array assignable across
// the two source registries (right native + left PANELS).
interface PanelLikeDef {
  id: string
  Icon: typeof InformationCircleIcon
  title: string
}

// Native right-side panels (the only ones the right activity bar
// surfaces by default). When a left-side panel is dragged onto the
// right stack it still renders, but its icon stays on the LEFT
// activity bar — see RightRibbon for the rationale.
export const RIGHT_DEFAULT_PANELS: readonly PanelLikeDef[] = [
  { id: 'properties', Icon: InformationCircleIcon, title: 'Properties' },
  { id: 'backlinks',  Icon: LinkIcon,              title: 'Backlinks' },
]

// Legacy export name kept so callsites + tests that read RIGHT_PANELS
// still compile. Identical to RIGHT_DEFAULT_PANELS.
export const RIGHT_PANELS = RIGHT_DEFAULT_PANELS

// Combined registry — every panel that the right side knows how to
// render. Native ids first (so RIGHT_PANELS lookups still find their
// def at the front), followed by every left-side panel.
const COMBINED_PANELS: readonly PanelLikeDef[] = [
  ...RIGHT_DEFAULT_PANELS,
  ...PANELS,
]

// Look up the icon + title for any id the right side might render.
// Used by RightMiniStrip so dragged-in left panels still get their
// proper icon + title.
export const rightPanelDef = (id: RightSidebarTabId): PanelLikeDef | undefined =>
  COMBINED_PANELS.find(p => p.id === id)

// Every id the right stack will accept in a group. Combines the
// right-native defaults with every left-side panel id. The stack's
// sanitiser filters out anything that isn't here.
export const RIGHT_KNOWN_IDS = new Set<string>([
  ...RIGHT_DEFAULT_PANELS.map(p => p.id),
  ...PANELS.map(p => p.id),
])

// MIME shared by every right-side strip + the right ribbon. As of
// 2026-06-04 this is the SAME string as the left side's TAB_DRAG_MIME
// — left + right drops accept a unified payload and the drop handlers
// (PinnedMiniStrip, RightMiniStrip, InterGroupDropZone,
// RightInterGroupDropZone) detect which side currently owns the tab
// to route across (see moveTabAcrossSidebars in sidebarGroupActions).
// Re-exported as a separate alias for back-compat with any callsite
// or test that still imports under the old name.
export const RIGHT_TAB_DRAG_MIME = TAB_DRAG_MIME

// Body renderer keyed by id. Native ids render their dedicated
// components; everything else delegates to the left-side PanelBody so
// a dragged-in panel (e.g. Plugins, Outline) keeps its behaviour on
// the right side.
export const RightPanelBody = ({
  id, onRightClick,
}: { id: RightSidebarTabId; onRightClick?: PanelRightClick }) => {
  switch (id) {
    case 'properties': return <PropertiesPanel />
    case 'backlinks':  return <BacklinksView />
    default:
      // Fall through to the left registry. onRightClick is only used
      // by the Files panel; the right side rarely hosts Files, but if
      // a user drags it across we still want context menus to work —
      // pass a no-op default to keep the type happy.
      return <PanelBody id={id} onRightClick={onRightClick ?? (() => {})} />
  }
}
