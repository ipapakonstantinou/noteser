/**
 * Reading-mode task-list-item helpers.
 *
 * react-markdown v10 does not pass a `checked` prop to the `li` renderer, so we
 * derive it from the HAST node. The subtlety: we must find the checkbox that
 * belongs to a list item ITSELF, not to one of its nested sub-tasks — otherwise
 * a parent's done-ness would leak from a child, and the strike-through would
 * mis-fire on nested checklists.
 *
 * Two structural cases the naive `children.find(input)` missed:
 *   1. A done parent task that contains a nested sub-list — GFM makes such a
 *      list "loose" and wraps the item body (including the checkbox) in a `<p>`.
 *      The checkbox is then a grandchild, so a direct-child search returns
 *      nothing and the nested done task is NOT struck. This is the reported bug.
 *   2. Descending into the nested `<ul>`/`<ol>` would pick up a subtask's
 *      checkbox and wrongly mark the parent.
 */

/** Minimal HAST element shape we care about. */
export interface HastNode {
  type?: string
  tagName?: string
  properties?: { checked?: boolean; type?: string }
  children?: HastNode[]
}

const isCheckbox = (c?: HastNode): boolean =>
  c?.type === 'element' && c?.tagName === 'input' && c?.properties?.type === 'checkbox'

/**
 * Return the checkbox `<input>` that belongs to this list item directly, or
 * `undefined` if the item is not a task. Skips nested lists; looks one level
 * into a wrapping `<p>` (loose-list body).
 */
export function findOwnCheckbox(node: HastNode | undefined): HastNode | undefined {
  for (const c of node?.children ?? []) {
    if (c?.type !== 'element') continue
    // Never descend into a nested list — those checkboxes belong to subtasks.
    if (c.tagName === 'ul' || c.tagName === 'ol') continue
    if (isCheckbox(c)) return c
    // Loose-list items wrap their body (incl. the checkbox) in a <p>.
    if (c.tagName === 'p') {
      const inner = (c.children ?? []).find(isCheckbox)
      if (inner) return inner
    }
  }
  return undefined
}

/**
 * True when this list item is a completed task (`- [x]`), regardless of its
 * nesting depth or whether GFM wrapped the body in a `<p>`.
 */
export function isTaskItemDone(node: HastNode | undefined): boolean {
  return findOwnCheckbox(node)?.properties?.checked === true
}
