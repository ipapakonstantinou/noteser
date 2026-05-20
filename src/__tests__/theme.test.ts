/**
 * theme.test.ts
 *
 * Verifies the theme token registry, preset shapes, and the
 * applyThemeOverrides helper that writes CSS variables to :root
 * (th3m).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { THEME_TOKENS, THEME_PRESETS, applyThemeOverrides } from '../utils/theme'

beforeEach(() => {
  // Strip any inline styles from a previous test so each starts clean.
  if (typeof document !== 'undefined') {
    for (const t of THEME_TOKENS) {
      document.documentElement.style.removeProperty(`--${t.cssVar}`)
    }
  }
})

test('every token defines cssVar / tailwind / label / defaultColor', () => {
  for (const t of THEME_TOKENS) {
    expect(t.cssVar).toMatch(/^obsidian-/)
    expect(t.tailwind).toMatch(/^obsidian/)
    expect(t.label.length).toBeGreaterThan(0)
    expect(t.defaultColor).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('the "default" preset has empty overrides (reverts to globals.css)', () => {
  const def = THEME_PRESETS.find(p => p.id === 'default')!
  expect(def.overrides).toEqual({})
})

test('every non-default preset names ONLY known cssVars', () => {
  const knownVars = new Set(THEME_TOKENS.map(t => t.cssVar))
  for (const preset of THEME_PRESETS) {
    if (preset.id === 'default') continue
    for (const key of Object.keys(preset.overrides)) {
      expect(knownVars.has(key)).toBe(true)
    }
  }
})

test('applyThemeOverrides writes CSS variables on :root', () => {
  applyThemeOverrides({ 'obsidian-black': '#ff0000', 'obsidian-text': '#00ff00' })
  expect(document.documentElement.style.getPropertyValue('--obsidian-black')).toBe('#ff0000')
  expect(document.documentElement.style.getPropertyValue('--obsidian-text')).toBe('#00ff00')
})

test('applyThemeOverrides removes properties when the value is empty', () => {
  applyThemeOverrides({ 'obsidian-black': '#ff0000' })
  expect(document.documentElement.style.getPropertyValue('--obsidian-black')).toBe('#ff0000')
  applyThemeOverrides({ 'obsidian-black': '' })
  expect(document.documentElement.style.getPropertyValue('--obsidian-black')).toBe('')
})

test('applyThemeOverrides({}) clears every known token', () => {
  applyThemeOverrides({ 'obsidian-black': '#abc123', 'obsidian-text': '#def456' })
  applyThemeOverrides({})
  expect(document.documentElement.style.getPropertyValue('--obsidian-black')).toBe('')
  expect(document.documentElement.style.getPropertyValue('--obsidian-text')).toBe('')
})

test('applyThemeOverrides ignores unknown keys silently', () => {
  applyThemeOverrides({ 'unknown-token': '#abc123' })
  // Nothing crashes; no known token is set.
  expect(document.documentElement.style.getPropertyValue('--obsidian-black')).toBe('')
})
