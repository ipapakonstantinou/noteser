import type { SidebarGroupState } from '@/stores'

export type GroupLayoutMode = 'fill' | 'fixed' | 'auto'

// Layout mode per group of a sidebar stack (left and right share it).
// 'fill' = flex-1, takes the leftover height; 'fixed' = the stored or
// in-flight draft px height; 'auto' = sized to content.
//
// Exactly one expanded group fills: the last one with no stored or draft
// height, else the last expanded one, whose height is then ignored. A
// handle drag sizes BOTH neighbours, so without the fallback a two-group
// stack ends up all-fixed and a taller window leaves dead space below.
export function groupLayoutModes(
  groups: SidebarGroupState[],
  drafts: Record<string, number>,
): GroupLayoutMode[] {
  const sized = (g: SidebarGroupState) => g.height != null || g.id in drafts
  let fill = -1
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].collapsed) continue
    if (fill === -1) fill = i
    if (!sized(groups[i])) { fill = i; break }
  }
  return groups.map((g, i) => (i === fill ? 'fill' : sized(g) ? 'fixed' : 'auto'))
}
