/**
 * CalloutBox.test.tsx
 *
 * Rendered read-only view of a `> [!TYPE]` callout — the piece both
 * EditorContent.tsx's preview and /share render for a blockquote once
 * remarkCallouts (applyCalloutToBlockquote) has tagged it. Tested as a
 * standalone component (not through ReactMarkdown — see callouts.test.ts's
 * header comment for why) so it renders in Jest without the ESM issue.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { CalloutBox } from '../components/shared/CalloutBox'
import { CALLOUT_TYPES, CALLOUT_LABELS, CALLOUT_STYLES } from '../utils/callouts'

describe('CalloutBox', () => {
  test.each(CALLOUT_TYPES)('renders the %s label and its color class, with children preserved', (type) => {
    render(<CalloutBox type={type}>Body content.</CalloutBox>)
    expect(screen.getByText(CALLOUT_LABELS[type])).toBeInTheDocument()
    expect(screen.getByText('Body content.')).toBeInTheDocument()
    expect(screen.getByText(CALLOUT_LABELS[type]).closest(`[data-callout-type="${type}"]`)).not.toBeNull()
  })

  test('each type gets its own distinct border color class (CALLOUT_STYLES applied verbatim)', () => {
    for (const type of CALLOUT_TYPES) {
      const { container } = render(<CalloutBox type={type}>x</CalloutBox>)
      const el = container.querySelector(`[data-callout-type="${type}"]`)
      expect(el?.className.split(' ')).toContain(CALLOUT_STYLES[type].border)
    }
    const borderColors = new Set(CALLOUT_TYPES.map((t) => CALLOUT_STYLES[t].border))
    expect(borderColors.size).toBe(CALLOUT_TYPES.length)
  })

  test('passes through an extra className (e.g. the editor cursor-block marker)', () => {
    const { container } = render(<CalloutBox type="note" className="preview-cursor-block">x</CalloutBox>)
    expect(container.querySelector('.preview-cursor-block')).not.toBeNull()
  })
})
