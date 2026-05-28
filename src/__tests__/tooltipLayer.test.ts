import { adoptTitle, shouldAdoptTooltip } from '@/components/ui/TooltipLayer'

// The tooltip layer only takes over ICON-ONLY interactive controls (buttons /
// links with no visible text). It must (a) suppress the native title and keep
// the accessible name on those, and (b) leave every other titled element
// untouched so reliable tooltips don't appear "everywhere".

function el(html: string): Element {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.firstElementChild as Element
}

describe('shouldAdoptTooltip', () => {
  it('accepts icon-only buttons and links', () => {
    expect(shouldAdoptTooltip(el('<button title="x"><svg></svg></button>'))).toBe(true)
    expect(shouldAdoptTooltip(el('<a href="#" title="x"></a>'))).toBe(true)
    expect(shouldAdoptTooltip(el('<span role="button" title="x"></span>'))).toBe(true)
  })

  it('rejects controls that already show text', () => {
    expect(shouldAdoptTooltip(el('<button title="x">Save</button>'))).toBe(false)
  })

  it('rejects non-interactive elements', () => {
    expect(shouldAdoptTooltip(el('<div title="Full note title">Note title</div>'))).toBe(false)
    expect(shouldAdoptTooltip(el('<li title="x"></li>'))).toBe(false)
  })
})

describe('adoptTitle', () => {
  it('adopts an icon-only button: moves title to data attr + mirrors aria-label', () => {
    const button = el('<button title="New note (Alt+N)"><svg></svg></button>')
    adoptTitle(button)
    expect(button.hasAttribute('title')).toBe(false)
    expect(button.getAttribute('data-noteser-tip')).toBe('New note (Alt+N)')
    expect(button.getAttribute('aria-label')).toBe('New note (Alt+N)')
  })

  it('does NOT clobber an existing aria-label', () => {
    const button = el('<button title="Tip text" aria-label="Real label"><svg></svg></button>')
    adoptTitle(button)
    expect(button.getAttribute('data-noteser-tip')).toBe('Tip text')
    expect(button.getAttribute('aria-label')).toBe('Real label')
  })

  it('leaves a text-labelled button completely alone', () => {
    const button = el('<button title="Commit & sync">Commit</button>')
    adoptTitle(button)
    expect(button.getAttribute('title')).toBe('Commit & sync')
    expect(button.hasAttribute('data-noteser-tip')).toBe(false)
  })

  it('leaves a non-interactive titled element (note row) alone', () => {
    const row = el('<div title="Full note title that is long">Note title</div>')
    adoptTitle(row)
    expect(row.getAttribute('title')).toBe('Full note title that is long')
    expect(row.hasAttribute('data-noteser-tip')).toBe(false)
    expect(row.hasAttribute('aria-label')).toBe(false)
  })
})
