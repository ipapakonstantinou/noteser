/**
 * previewTaskDone.test.tsx
 *
 * Reading-mode nested-task strikethrough regression.
 *
 * Earlier behaviour put `text-decoration: line-through` on the outer `<li>`,
 * which painted the strike line across every descendant text — including a
 * nested UNDONE sub-task — even when the descendant set
 * `text-decoration: none` (modern browsers still draw the ancestor's strike
 * across the descendant's box). The fix splits the done item's React children
 * into its OWN content and any nested <ul>/<ol> sublists, wrapping only the
 * own content in a `.preview-task-done-line` span sibling of the nested list.
 * `splitTaskDoneChildren` is the pure helper that does the split — testing it
 * directly avoids pulling react-markdown (ESM) into Jest.
 */

import React from 'react'
import { render } from '@testing-library/react'
import { splitTaskDoneChildren } from '../utils/previewTaskDoneSplit'

describe('splitTaskDoneChildren', () => {
  test('text-only children land in ownContent; no nested lists', () => {
    const { ownContent, nestedLists } = splitTaskDoneChildren(['hello world'])
    expect(ownContent).toHaveLength(1)
    expect(nestedLists).toHaveLength(0)
  })

  test('separates a nested <ul> from text content', () => {
    const children = [
      'parent text',
      <ul key="ul"><li key="li">child</li></ul>,
    ]
    const { ownContent, nestedLists } = splitTaskDoneChildren(children)
    expect(ownContent).toHaveLength(1)
    expect(nestedLists).toHaveLength(1)
  })

  test('separates a nested <ol> from inline elements', () => {
    const children = [
      <input key="cb" type="checkbox" />,
      ' done thing ',
      <ol key="ol"><li key="li">step 1</li></ol>,
    ]
    const { ownContent, nestedLists } = splitTaskDoneChildren(children)
    expect(ownContent).toHaveLength(2)
    expect(nestedLists).toHaveLength(1)
  })

  test('keeps non-list elements (<p>, <a>, <span>) in ownContent', () => {
    const children = [
      <p key="p">para</p>,
      <a key="a" href="#">link</a>,
      <span key="s">span</span>,
    ]
    const { ownContent, nestedLists } = splitTaskDoneChildren(children)
    expect(ownContent).toHaveLength(3)
    expect(nestedLists).toHaveLength(0)
  })
})

describe('reading-mode nested-task strikethrough — rendered structure', () => {
  // End-to-end DOM check: rebuild the EXACT JSX the EditorContent ListItem
  // emits for a done item, then assert the structural invariant the fix
  // relies on — `.preview-task-done-line` is a SIBLING of the nested <ul>,
  // never an ancestor of it. That sibling boundary is what stops the
  // strike line from being painted across the nested rows.

  const renderDoneLi = (children: React.ReactNode) => {
    const { ownContent, nestedLists } = splitTaskDoneChildren(children)
    return render(
      <ul>
        <li className="task-list-item preview-task-done">
          <span className="preview-task-done-line">{ownContent}</span>
          {nestedLists}
        </li>
      </ul>,
    )
  }

  test('done item with no children has an empty .preview-task-done-line span', () => {
    const { container } = renderDoneLi([])
    const span = container.querySelector('.preview-task-done-line')
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('')
  })

  test('nested <ul> renders OUTSIDE the .preview-task-done-line span', () => {
    const children = [
      <input key="cb" type="checkbox" defaultChecked readOnly />,
      ' Parent done',
      <ul key="ul">
        <li key="c1" className="task-list-item">
          <input type="checkbox" readOnly /> Child todo
        </li>
      </ul>,
    ]
    const { container } = renderDoneLi(children)
    const outerLi = container.querySelector('li.preview-task-done')!
    const span = outerLi.querySelector(':scope > .preview-task-done-line')!
    const nestedUl = outerLi.querySelector(':scope > ul')!
    expect(span).not.toBeNull()
    expect(nestedUl).not.toBeNull()
    // The structural invariant: <ul> is a sibling of the span, NOT a descendant.
    expect(span.querySelector('ul')).toBeNull()
    // And the span carries the strike class.
    expect(span.classList.contains('preview-task-done-line')).toBe(true)
  })

  test('nested <ol> also lands outside the strike span (numbered sub-lists)', () => {
    const children = [
      'Done ',
      <ol key="ol"><li key="i">step</li></ol>,
    ]
    const { container } = renderDoneLi(children)
    const span = container.querySelector('.preview-task-done-line')!
    expect(span.querySelector('ol')).toBeNull()
    const sibling = span.nextElementSibling
    expect(sibling?.tagName).toBe('OL')
  })
})
