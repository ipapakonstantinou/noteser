// Sanity tests for the inline-SVG PanelLeftIcon / PanelRightIcon used
// for the sidebar-collapse toggle button. Confirms the "near edge" bar
// renders on opposite sides — the symmetry is the whole point of having
// two icons.

import { render } from '@testing-library/react'
import { PanelLeftIcon, PanelRightIcon } from '../components/ui/PanelIcons'

describe('PanelLeftIcon / PanelRightIcon', () => {
  it('PanelLeftIcon renders the bar at x=9 (near-left edge)', () => {
    const { container } = render(<PanelLeftIcon className="w-4 h-4" />)
    const line = container.querySelector('svg line')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('x1')).toBe('9')
    expect(line!.getAttribute('x2')).toBe('9')
  })

  it('PanelRightIcon renders the bar at x=15 (near-right edge)', () => {
    const { container } = render(<PanelRightIcon className="w-4 h-4" />)
    const line = container.querySelector('svg line')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('x1')).toBe('15')
    expect(line!.getAttribute('x2')).toBe('15')
  })

  it('forwards className + aria-hidden so it behaves like a Heroicons icon', () => {
    const { container } = render(<PanelLeftIcon className="w-4 h-4 text-rose-500" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toContain('text-rose-500')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  })
})
