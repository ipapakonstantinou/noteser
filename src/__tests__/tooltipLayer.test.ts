import { adoptTitle } from '@/components/ui/TooltipLayer'

// adoptTitle is the accessibility-critical part of the tooltip layer: it must
// suppress the native title (so the browser stops drawing its flaky tooltip)
// WITHOUT dropping the element's accessible name.

function el(html: string): Element {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.firstElementChild as Element
}

describe('adoptTitle', () => {
  it('moves title into the data attr and mirrors it to aria-label', () => {
    const button = el('<button title="New note (Alt+N)"></button>')
    adoptTitle(button)
    expect(button.hasAttribute('title')).toBe(false)
    expect(button.getAttribute('data-noteser-tip')).toBe('New note (Alt+N)')
    expect(button.getAttribute('aria-label')).toBe('New note (Alt+N)')
  })

  it('does NOT clobber an existing aria-label', () => {
    const button = el('<button title="Tip text" aria-label="Real label"></button>')
    adoptTitle(button)
    expect(button.getAttribute('data-noteser-tip')).toBe('Tip text')
    expect(button.getAttribute('aria-label')).toBe('Real label')
  })

  it('respects an existing aria-labelledby (no aria-label added)', () => {
    const button = el('<button title="Tip" aria-labelledby="x"></button>')
    adoptTitle(button)
    expect(button.getAttribute('data-noteser-tip')).toBe('Tip')
    expect(button.hasAttribute('aria-label')).toBe(false)
  })

  it('removes an empty/whitespace title without creating a tip', () => {
    const button = el('<button title="   "></button>')
    adoptTitle(button)
    expect(button.hasAttribute('title')).toBe(false)
    expect(button.hasAttribute('data-noteser-tip')).toBe(false)
    expect(button.hasAttribute('aria-label')).toBe(false)
  })

  it('does NOT add aria-label to an element that already has visible text', () => {
    const item = el('<div title="Full note title that is long">Note title</div>')
    adoptTitle(item)
    expect(item.getAttribute('data-noteser-tip')).toBe('Full note title that is long')
    expect(item.hasAttribute('aria-label')).toBe(false)
  })

  it('is a no-op on elements without a title', () => {
    const button = el('<button aria-label="x"></button>')
    adoptTitle(button)
    expect(button.hasAttribute('data-noteser-tip')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('x')
  })
})
