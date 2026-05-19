/**
 * systemFolder.test.ts
 *
 * Verifies the generic SystemFolder helper. The pre-built `attachmentsFolder`
 * singleton is exercised separately in attachments.test.ts; this suite
 * stays generic and re-uses an existing string-typed key from settingsStore
 * (`attachmentsFolder`) to drive the SystemFolder under test.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { SystemFolder } from '../utils/systemFolder'
import { useSettingsStore } from '../stores/settingsStore'

// Drive the SystemFolder via the attachmentsFolder setting key. Any string
// setting would do — we just need a live key/value bound to the store.
function makeFolder(includeLegacyPrefix = true): SystemFolder {
  return new SystemFolder({
    settingKey: 'attachmentsFolder',
    defaultValue: 'attachments',
    includeLegacyPrefix,
  })
}

beforeEach(() => {
  // Reset the underlying setting between tests so state doesn't leak.
  useSettingsStore.getState().setAttachmentsFolder('attachments')
})

// ── normalize ─────────────────────────────────────────────────────────────────

describe('SystemFolder.normalize', () => {
  const f = makeFolder()

  test('trims whitespace and edge slashes, collapses repeats', () => {
    expect(f.normalize('  /foo/bar/  ')).toBe('foo/bar')
    expect(f.normalize('a//b///c')).toBe('a/b/c')
  })

  test('falls back to the default on empty / whitespace / null / undefined', () => {
    expect(f.normalize('')).toBe('attachments')
    expect(f.normalize('   ')).toBe('attachments')
    expect(f.normalize(null)).toBe('attachments')
    expect(f.normalize(undefined)).toBe('attachments')
    expect(f.normalize('///')).toBe('attachments')
  })
})

// ── get ───────────────────────────────────────────────────────────────────────

describe('SystemFolder.get', () => {
  test('returns the live setting value, normalised', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('/images//')
    expect(f.get()).toBe('images')
  })

  test('falls back to default when the setting is blank', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('')
    expect(f.get()).toBe('attachments')
  })
})

// ── prefixes ──────────────────────────────────────────────────────────────────

describe('SystemFolder.prefixes', () => {
  test('returns only the default prefix when current === default', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('attachments')
    expect(f.prefixes()).toEqual(['attachments/'])
  })

  test('returns configured + historical default by default (back-compat)', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(f.prefixes()).toEqual(['images/', 'attachments/'])
  })

  test('omits the historical default when includeLegacyPrefix is false', () => {
    const f = makeFolder(false)
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(f.prefixes()).toEqual(['images/'])
  })
})

// ── matchesPath ───────────────────────────────────────────────────────────────

describe('SystemFolder.matchesPath', () => {
  test('matches paths under the current folder', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(f.matchesPath('images/foo.png')).toBe(true)
  })

  test('still matches the historical default for back-compat', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(f.matchesPath('attachments/old.png')).toBe(true)
  })

  test('rejects unrelated paths', () => {
    const f = makeFolder()
    expect(f.matchesPath('Notes/foo.md')).toBe(false)
    expect(f.matchesPath('https://example.com/x.png')).toBe(false)
  })
})

// ── defaultName ───────────────────────────────────────────────────────────────

describe('SystemFolder.defaultName', () => {
  test('returns the configured default regardless of the current setting', () => {
    const f = makeFolder()
    useSettingsStore.getState().setAttachmentsFolder('something-else')
    expect(f.defaultName).toBe('attachments')
  })
})
