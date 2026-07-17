import { render, screen } from '@testing-library/react'
import { WikilinkAutocomplete } from '@/components/editor/WikilinkAutocomplete'
import type { Note } from '@/types'

const note = (title: string): Note =>
  ({
    id: title,
    title,
    content: '',
    folderId: null,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) as unknown as Note

function titlesShown() {
  // rows render the title text; read them in DOM order
  return screen.getAllByTestId('wikilink-row').map(el => el.textContent)
}

describe('WikilinkAutocomplete ordering', () => {
  // jsdom implements no layout, so the component's scroll-active-row-into-view is a no-op here
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  const props = {
    position: { top: 0, left: 0 },
    onSelect: jest.fn(),
    onClose: jest.fn(),
  }

  it('lists newest first so daily notes surface the current year', () => {
    const notes = [note('2024-02-23'), note('2026-07-17'), note('2025-01-02')]
    render(<WikilinkAutocomplete query="202" notes={notes} {...props} />)
    expect(titlesShown()).toEqual(['2026-07-17', '2025-01-02', '2024-02-23'])
  })

  it('keeps the newest inside the 8-row cap when many match', () => {
    // 12 dated notes ascending; the cap must not strand the recent ones off-list
    const notes = Array.from({ length: 12 }, (_, i) =>
      note(`2024-01-${String(i + 1).padStart(2, '0')}`)
    )
    render(<WikilinkAutocomplete query="2024" notes={notes} {...props} />)
    const shown = titlesShown()
    expect(shown).toHaveLength(8)
    expect(shown[0]).toBe('2024-01-12')
    expect(shown).not.toContain('2024-01-01')
  })
})
