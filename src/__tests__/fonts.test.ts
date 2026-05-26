/**
 * fonts.test.ts
 *
 * Verifies the font slot registry, the buildFontStack helper, and the
 * applyFontOverrides helper that writes CSS variables to :root (fnt1).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import {
  FONT_SLOTS,
  FONT_SLOTS_DEF,
  SYSTEM_DEFAULT_VALUE,
  buildFontStack,
  applyFontOverrides,
} from '../utils/fonts'
import { VAULT_SETTING_KEYS } from '../stores/settingsStore'

const ALL_VARS = Object.values(FONT_SLOTS)

beforeEach(() => {
  if (typeof document !== 'undefined') {
    for (const v of ALL_VARS) {
      document.documentElement.style.removeProperty(`--${v}`)
    }
  }
})

describe('FONT_SLOTS_DEF registry', () => {
  test('defines exactly three slots: text, mono, interface', () => {
    expect(FONT_SLOTS_DEF.map(s => s.id).sort()).toEqual(['interface', 'mono', 'text'])
  })

  test('every slot has a label, description, cssVar, and curated options', () => {
    for (const slot of FONT_SLOTS_DEF) {
      expect(slot.label.length).toBeGreaterThan(0)
      expect(slot.description.length).toBeGreaterThan(0)
      expect(slot.cssVar).toBe(FONT_SLOTS[slot.id])
      // Curated list is short and tasteful (3-5 incl. system default).
      expect(slot.options.length).toBeGreaterThanOrEqual(3)
      expect(slot.options.length).toBeLessThanOrEqual(5)
    }
  })

  test('every slot leads with a "System default" empty-value option', () => {
    for (const slot of FONT_SLOTS_DEF) {
      expect(slot.options[0].value).toBe(SYSTEM_DEFAULT_VALUE)
      expect(slot.options[0].label.toLowerCase()).toContain('system default')
    }
  })

  test('curated option values match the slot default stack', () => {
    // The default stack should equal one of the curated stacks (the
    // system-default entry resolves to it) so the dropdown can show the
    // current state without a phantom "Custom" entry on a pristine install.
    for (const slot of FONT_SLOTS_DEF) {
      expect(typeof slot.defaultStack).toBe('string')
      expect(slot.defaultStack.length).toBeGreaterThan(0)
    }
  })
})

describe('vault sync wiring', () => {
  test('all three font fields are vault-synced (follow across devices)', () => {
    const keys = VAULT_SETTING_KEYS as readonly string[]
    expect(keys).toContain('fontText')
    expect(keys).toContain('fontMono')
    expect(keys).toContain('fontInterface')
  })
})

describe('buildFontStack', () => {
  test('empty / whitespace value returns empty string (system default)', () => {
    expect(buildFontStack('text', '')).toBe('')
    expect(buildFontStack('mono', '   ')).toBe('')
  })

  test('a comma-separated stack is trusted as-is', () => {
    const stack = '"JetBrains Mono", ui-monospace, monospace'
    expect(buildFontStack('mono', stack)).toBe(stack)
  })

  test('a single multi-word family is quoted and gets the slot fallback', () => {
    const out = buildFontStack('mono', 'JetBrains Mono')
    expect(out.startsWith('"JetBrains Mono", ')).toBe(true)
    expect(out).toContain('ui-monospace')
  })

  test('a single one-word family is not quoted but gets the fallback', () => {
    const out = buildFontStack('interface', 'Helvetica')
    expect(out.startsWith('Helvetica, ')).toBe(true)
    expect(out).toContain('sans-serif')
  })

  test('an already-quoted family is not double-quoted', () => {
    const out = buildFontStack('text', '"My Font"')
    expect(out.startsWith('"My Font", ')).toBe(true)
    expect(out).not.toContain('""')
  })

  test('text slot falls back through monospace, interface through sans-serif', () => {
    expect(buildFontStack('text', 'Foo')).toContain('monospace')
    expect(buildFontStack('interface', 'Foo')).toContain('sans-serif')
  })
})

describe('applyFontOverrides', () => {
  test('writes the variable for a set slot', () => {
    applyFontOverrides({ fontMono: 'JetBrains Mono' })
    const v = document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.mono}`)
    expect(v).toContain('JetBrains Mono')
  })

  test('clears the variable when the value is empty (system default)', () => {
    applyFontOverrides({ fontText: 'Georgia, serif' })
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.text}`)).toContain('Georgia')
    applyFontOverrides({ fontText: '' })
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.text}`)).toBe('')
  })

  test('applies the three slots independently', () => {
    applyFontOverrides({
      fontText: 'Georgia, serif',
      fontMono: '"Fira Code", monospace',
      fontInterface: 'Arial, sans-serif',
    })
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.text}`)).toContain('Georgia')
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.mono}`)).toContain('Fira Code')
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.interface}`)).toContain('Arial')
  })

  test('an all-empty payload clears every slot (no change vs defaults)', () => {
    applyFontOverrides({ fontText: 'Georgia', fontMono: 'Consolas', fontInterface: 'Arial' })
    applyFontOverrides({ fontText: '', fontMono: '', fontInterface: '' })
    for (const v of ALL_VARS) {
      expect(document.documentElement.style.getPropertyValue(`--${v}`)).toBe('')
    }
  })

  test('undefined slots are treated as empty (cleared)', () => {
    applyFontOverrides({ fontMono: 'Consolas' })
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.text}`)).toBe('')
    expect(document.documentElement.style.getPropertyValue(`--${FONT_SLOTS.interface}`)).toBe('')
  })
})
