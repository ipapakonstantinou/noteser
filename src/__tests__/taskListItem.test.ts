/**
 * taskListItem.test.ts
 *
 * Reading-mode strikethrough relies on detecting a list item's OWN checkbox
 * state from the HAST node react-markdown passes to the `li` renderer. These
 * tests build HAST shapes exactly as remark-gfm + remark-rehype produce them
 * (verified against the real pipeline) for tight, loose, and nested checklists,
 * and lock down that:
 *   - a done top-level task is detected as done,
 *   - a done NESTED task is detected as done (the reported regression),
 *   - an UN-done nested task under a done parent is NOT detected as done,
 *   - a plain (non-task) parent that merely contains a nested task is NOT done.
 */

import { isTaskItemDone, findOwnCheckbox, type HastNode } from '../utils/taskListItem'

// ── HAST builders mirroring remark-gfm/remark-rehype output ───────────────────

const text = (value: string): HastNode => ({ type: 'text', tagName: undefined, properties: undefined, ...({ value } as object) }) as HastNode

const checkbox = (checked: boolean): HastNode => ({
  type: 'element',
  tagName: 'input',
  properties: { type: 'checkbox', checked },
})

const nestedList = (items: HastNode[]): HastNode => ({
  type: 'element',
  tagName: 'ul',
  children: items,
})

/** Tight task item: `<li><input/> text</li>` */
const tightTask = (checked: boolean, label = 'task', extra: HastNode[] = []): HastNode => ({
  type: 'element',
  tagName: 'li',
  children: [checkbox(checked), text(' '), text(label), ...extra],
})

/** Loose task item: `<li><p><input/> text</p>…</li>` (GFM wraps body in <p>). */
const looseTask = (checked: boolean, label = 'task', extra: HastNode[] = []): HastNode => ({
  type: 'element',
  tagName: 'li',
  children: [
    { type: 'element', tagName: 'p', children: [checkbox(checked), text(' '), text(label)] },
    ...extra,
  ],
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isTaskItemDone (reading-mode checkbox detection)', () => {
  test('done top-level task is detected as done', () => {
    expect(isTaskItemDone(tightTask(true, 'top done'))).toBe(true)
  })

  test('undone top-level task is detected as NOT done', () => {
    expect(isTaskItemDone(tightTask(false, 'top todo'))).toBe(false)
  })

  test('done NESTED task (tight) is detected as done', () => {
    const parent = tightTask(true, 'parent done', [
      nestedList([tightTask(true, 'child done')]),
    ])
    const child = (parent.children!.find((c) => c.tagName === 'ul')!).children![0]
    expect(isTaskItemDone(child)).toBe(true)
  })

  test('un-done NESTED task under a done parent is NOT detected as done', () => {
    const undoneChild = tightTask(false, 'child todo')
    expect(isTaskItemDone(undoneChild)).toBe(false)
  })

  test('done parent decided by its OWN checkbox, not a nested done child', () => {
    // Parent is UNDONE but contains a DONE child — must NOT read as done.
    const parent = tightTask(false, 'parent todo', [
      nestedList([tightTask(true, 'child done')]),
    ])
    expect(isTaskItemDone(parent)).toBe(false)
  })

  test('done LOOSE parent (checkbox wrapped in <p>) is detected as done', () => {
    // The reported regression: a parent that has a nested sub-list becomes a
    // loose list, GFM wraps the checkbox in a <p>, and the old direct-child
    // search missed it.
    const parent = looseTask(true, 'parent done', [
      nestedList([tightTask(true, 'child done'), tightTask(false, 'child todo')]),
    ])
    expect(isTaskItemDone(parent)).toBe(true)
  })

  test('plain bullet parent (no checkbox) that only contains a nested task is NOT done', () => {
    const parent: HastNode = {
      type: 'element',
      tagName: 'li',
      children: [text('parent'), nestedList([tightTask(true, 'child done')])],
    }
    expect(isTaskItemDone(parent)).toBe(false)
  })

  test('findOwnCheckbox returns undefined for a non-task list item', () => {
    const plain: HastNode = { type: 'element', tagName: 'li', children: [text('just text')] }
    expect(findOwnCheckbox(plain)).toBeUndefined()
  })

  test('findOwnCheckbox does not descend into a nested ordered list', () => {
    const parent: HastNode = {
      type: 'element',
      tagName: 'li',
      children: [
        text('parent'),
        { type: 'element', tagName: 'ol', children: [tightTask(true, 'child done')] },
      ],
    }
    expect(findOwnCheckbox(parent)).toBeUndefined()
  })

  test('handles undefined / empty nodes without throwing', () => {
    expect(isTaskItemDone(undefined)).toBe(false)
    expect(isTaskItemDone({ type: 'element', tagName: 'li' })).toBe(false)
  })
})
