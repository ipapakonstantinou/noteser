/**
 * previewTaskDoneSplit.tsx
 *
 * Helper for the reading-mode ListItem renderer (see
 * `src/components/editor/EditorContent.tsx`). When a task item is DONE we want
 * a line-through on its OWN content but never on its nested sub-lists. Older
 * CSS tried to "reset" text-decoration on descendants — modern browsers still
 * paint the ancestor's strike across the descendant's box, so an UN-done
 * subtask under a done parent wrongly LOOKED struck.
 *
 * The fix is structural: split the React children into (a) own content and
 * (b) nested <ul>/<ol>, then render only (a) inside a
 * `.preview-task-done-line` span sibling. The strike line cannot cross into
 * a sibling element's box. This module exports the splitter so tests can
 * assert the split (rather than going through react-markdown, which is ESM
 * and not transformed by our Jest setup).
 */

import React, { Children, isValidElement } from 'react'

export interface TaskDoneSplit {
  ownContent: React.ReactNode[]
  nestedLists: React.ReactNode[]
}

/**
 * Walk React children once, fanning out into two arrays:
 *   - `nestedLists`: child elements whose `type === 'ul' || 'ol'`
 *   - `ownContent`: everything else (text, <input>, <p>, <a>, …)
 *
 * Both arrays preserve order; React Fragments are inserted with stable keys so
 * downstream renders don't re-mount the children.
 */
export function splitTaskDoneChildren(children: React.ReactNode): TaskDoneSplit {
  const ownContent: React.ReactNode[] = []
  const nestedLists: React.ReactNode[] = []
  Children.forEach(children, (child, idx) => {
    if (isValidElement(child) && (child.type === 'ul' || child.type === 'ol')) {
      nestedLists.push(<React.Fragment key={`nl-${idx}`}>{child}</React.Fragment>)
    } else {
      ownContent.push(<React.Fragment key={`oc-${idx}`}>{child}</React.Fragment>)
    }
  })
  return { ownContent, nestedLists }
}
