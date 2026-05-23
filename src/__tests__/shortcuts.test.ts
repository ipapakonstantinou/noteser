/**
 * shortcuts.test.ts
 *
 * Unit tests for the combo-parsing helpers in `src/utils/shortcuts.ts`.
 * These run without any Zustand stores — pure functions only.
 */

import {
  SHORTCUTS,
  activeComboFor,
  comboToDisplay,
  formatEventAsCombo,
  matchEvent,
  parseCombo,
} from '../utils/shortcuts'

// ── parseCombo ───────────────────────────────────────────────────────────────

describe('parseCombo', () => {
  test('parses Ctrl+K', () => {
    expect(parseCombo('Ctrl+K')).toEqual({
      ctrl: true, shift: false, alt: false, meta: false, key: 'k',
    })
  })

  test('parses Alt+Shift+L', () => {
    expect(parseCombo('Alt+Shift+L')).toEqual({
      ctrl: false, shift: true, alt: true, meta: false, key: 'l',
    })
  })

  test('parses Meta+Enter', () => {
    expect(parseCombo('Meta+Enter')).toEqual({
      ctrl: false, shift: false, alt: false, meta: true, key: 'enter',
    })
  })

  test('is case-insensitive on modifier names', () => {
    expect(parseCombo('ctrl+SHIFT+p')).toEqual({
      ctrl: true, shift: true, alt: false, meta: false, key: 'p',
    })
  })

  test('is case-insensitive on the key part', () => {
    expect(parseCombo('Ctrl+K').key).toBe('k')
    expect(parseCombo('Ctrl+k').key).toBe('k')
  })

  test('treats Mod as both Ctrl and Meta', () => {
    const parsed = parseCombo('Mod+P')
    expect(parsed.ctrl).toBe(true)
    expect(parsed.meta).toBe(true)
    expect(parsed.key).toBe('p')
  })

  test('treats Cmd/Command as Meta', () => {
    expect(parseCombo('Cmd+K').meta).toBe(true)
    expect(parseCombo('Command+K').meta).toBe(true)
  })

  test('treats Option/Opt as Alt', () => {
    expect(parseCombo('Option+N').alt).toBe(true)
    expect(parseCombo('Opt+N').alt).toBe(true)
  })

  test('returns an all-false parsed combo for empty input', () => {
    expect(parseCombo('')).toEqual({
      ctrl: false, shift: false, alt: false, meta: false, key: '',
    })
  })

  test('handles whitespace around tokens', () => {
    expect(parseCombo(' Ctrl + Shift + K ')).toEqual({
      ctrl: true, shift: true, alt: false, meta: false, key: 'k',
    })
  })

  test('normalises Esc → escape and Del → delete', () => {
    expect(parseCombo('Esc').key).toBe('escape')
    expect(parseCombo('Ctrl+Del').key).toBe('delete')
  })
})

// ── matchEvent ───────────────────────────────────────────────────────────────

/** Build a KeyboardEvent with the listed modifiers set. */
function ev(key: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...mods })
}

describe('matchEvent', () => {
  test('matches a basic Ctrl+K against ctrlKey+K event', () => {
    const combo = parseCombo('Ctrl+K')
    expect(matchEvent(combo, ev('k', { ctrlKey: true }))).toBe(true)
  })

  test('Ctrl+K combo also fires for Meta+K event (Mac parity)', () => {
    const combo = parseCombo('Ctrl+K')
    expect(matchEvent(combo, ev('k', { metaKey: true }))).toBe(true)
  })

  test('Meta+K combo also fires for Ctrl+K event', () => {
    const combo = parseCombo('Meta+K')
    expect(matchEvent(combo, ev('k', { ctrlKey: true }))).toBe(true)
  })

  test('Mod+K (sets both ctrl & meta) matches a Ctrl-only event', () => {
    const combo = parseCombo('Mod+K')
    expect(matchEvent(combo, ev('k', { ctrlKey: true }))).toBe(true)
  })

  test('shift mismatch is rejected', () => {
    const combo = parseCombo('Ctrl+K')
    expect(matchEvent(combo, ev('k', { ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  test('alt mismatch is rejected', () => {
    const combo = parseCombo('Ctrl+K')
    expect(matchEvent(combo, ev('k', { ctrlKey: true, altKey: true }))).toBe(false)
  })

  test('missing modifier is rejected (bare K does not fire Ctrl+K)', () => {
    const combo = parseCombo('Ctrl+K')
    expect(matchEvent(combo, ev('k'))).toBe(false)
  })

  test('matches event.key case-insensitively', () => {
    const combo = parseCombo('Ctrl+K')
    expect(matchEvent(combo, ev('K', { ctrlKey: true }))).toBe(true)
  })

  test('matches Alt+N specifically (does NOT match Ctrl+Alt+N)', () => {
    const combo = parseCombo('Alt+N')
    expect(matchEvent(combo, ev('n', { altKey: true }))).toBe(true)
    expect(matchEvent(combo, ev('n', { altKey: true, ctrlKey: true }))).toBe(false)
  })

  test('matches special keys like Enter / Escape / Delete', () => {
    expect(matchEvent(parseCombo('Ctrl+Enter'), ev('Enter', { ctrlKey: true }))).toBe(true)
    expect(matchEvent(parseCombo('Escape'), ev('Escape'))).toBe(true)
    expect(matchEvent(parseCombo('Ctrl+Delete'), ev('Delete', { ctrlKey: true }))).toBe(true)
  })
})

// ── formatEventAsCombo ───────────────────────────────────────────────────────

describe('formatEventAsCombo', () => {
  test('produces canonical Ctrl+Shift+P for a letter event', () => {
    expect(formatEventAsCombo(ev('p', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P')
  })

  test('produces Alt+N', () => {
    expect(formatEventAsCombo(ev('n', { altKey: true }))).toBe('Alt+N')
  })

  test('preserves Meta as Meta when only Cmd is pressed', () => {
    expect(formatEventAsCombo(ev('k', { metaKey: true }))).toBe('Meta+K')
  })

  test('prefers Ctrl when both Ctrl and Meta are pressed', () => {
    // Realistic scenario when both modifiers happen to be down.
    expect(formatEventAsCombo(ev('k', { ctrlKey: true, metaKey: true }))).toBe('Ctrl+K')
  })

  test('rejects modifier-only events — Shift alone', () => {
    expect(formatEventAsCombo(ev('Shift', { shiftKey: true }))).toBeNull()
  })

  test('rejects modifier-only events — Control alone', () => {
    expect(formatEventAsCombo(ev('Control', { ctrlKey: true }))).toBeNull()
  })

  test('rejects modifier-only events — Meta alone', () => {
    expect(formatEventAsCombo(ev('Meta', { metaKey: true }))).toBeNull()
  })

  test('rejects modifier-only events — Alt alone', () => {
    expect(formatEventAsCombo(ev('Alt', { altKey: true }))).toBeNull()
  })

  test('rejects bare letter (no modifier)', () => {
    expect(formatEventAsCombo(ev('a'))).toBeNull()
  })

  test('accepts F-keys without a modifier', () => {
    expect(formatEventAsCombo(ev('F2'))).toBe('F2')
    expect(formatEventAsCombo(ev('F12'))).toBe('F12')
  })

  test('formats arrow keys as ArrowUp/ArrowDown/…', () => {
    expect(formatEventAsCombo(ev('ArrowUp', { ctrlKey: true }))).toBe('Ctrl+ArrowUp')
    expect(formatEventAsCombo(ev('ArrowDown', { altKey: true }))).toBe('Alt+ArrowDown')
  })

  test('formats Escape with a modifier (still requires one for non-F-keys)', () => {
    expect(formatEventAsCombo(ev('Escape', { ctrlKey: true }))).toBe('Ctrl+Escape')
  })

  test('formats Enter with a modifier', () => {
    expect(formatEventAsCombo(ev('Enter', { ctrlKey: true }))).toBe('Ctrl+Enter')
  })

  test('round-trips: parseCombo(formatEventAsCombo(ev)) recovers the same parsed form', () => {
    const combo = formatEventAsCombo(ev('K', { ctrlKey: true, shiftKey: true }))!
    const parsed = parseCombo(combo)
    expect(parsed.ctrl).toBe(true)
    expect(parsed.shift).toBe(true)
    expect(parsed.key).toBe('k')
  })
})

// ── comboToDisplay ───────────────────────────────────────────────────────────

describe('comboToDisplay', () => {
  test('keeps the verbatim Ctrl+K form', () => {
    expect(comboToDisplay('Ctrl+K')).toBe('Ctrl+K')
  })

  test('normalises lower-case input', () => {
    expect(comboToDisplay('ctrl+shift+k')).toBe('Ctrl+Shift+K')
  })

  test('keeps F-keys upper-case', () => {
    expect(comboToDisplay('F2')).toBe('F2')
  })

  test('title-cases ArrowUp', () => {
    expect(comboToDisplay('Ctrl+ArrowUp')).toBe('Ctrl+ArrowUp')
    expect(comboToDisplay('ctrl+arrowup')).toBe('Ctrl+ArrowUp')
  })
})

// ── activeComboFor ───────────────────────────────────────────────────────────

describe('activeComboFor', () => {
  const def = SHORTCUTS.find(s => s.id === 'newNote')!

  test('returns the override when one is present', () => {
    expect(activeComboFor(def, { newNote: 'Ctrl+Shift+Y' })).toBe('Ctrl+Shift+Y')
  })

  test('returns the default when no override is set', () => {
    expect(activeComboFor(def, {})).toBe(def.defaultCombo)
  })

  test('treats an empty-string override as "no override"', () => {
    expect(activeComboFor(def, { newNote: '' })).toBe(def.defaultCombo)
  })
})

// ── SHORTCUTS registry sanity ────────────────────────────────────────────────

describe('SHORTCUTS registry', () => {
  test('has the documented actions', () => {
    const ids = SHORTCUTS.map(s => s.id).sort()
    expect(ids).toEqual([
      'closeTab', 'deleteNote', 'focusSidebar', 'newFolder', 'newNote', 'openCommandPalette', 'openRandomNote', 'openSearch', 'openSettings', 'openToday', 'togglePreview', 'toggleSidebar',
    ])
  })

  test('every shortcut has a non-empty defaultCombo that parses to a key', () => {
    for (const def of SHORTCUTS) {
      const parsed = parseCombo(def.defaultCombo)
      expect(parsed.key).not.toBe('')
    }
  })

  test('ids are unique', () => {
    const ids = SHORTCUTS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
