/**
 * sidebarGroupsMigration.test.ts
 *
 * Covers the v2→v3 settings-store migration to the Obsidian leaf model.
 * Legacy fields:
 *   pinnedPanels: string[][]
 *   collapsedPinnedGroups: string[]  (keys are group.join(','))
 *   sidebarTabOrder: string[]
 *   sidebarTabId (on uiStore)
 * are folded into one sidebarGroups: SidebarGroupState[].
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { useSettingsStore, legacyToSidebarGroups } from '../stores/settingsStore'
import type { SidebarGroupState } from '../stores/settingsStore'

type PersistStore = typeof useSettingsStore & {
  persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } }
}
const migrate = (useSettingsStore as PersistStore).persist.getOptions().migrate!

function run(state: unknown, version: number): { sidebarGroups?: SidebarGroupState[] } {
  return migrate(state, version) as unknown as { sidebarGroups?: SidebarGroupState[] }
}

describe('legacyToSidebarGroups — pure helper', () => {
  test('empty input returns []', () => {
    expect(legacyToSidebarGroups(undefined, undefined)).toEqual([])
    expect(legacyToSidebarGroups([], [])).toEqual([])
  })

  test('one singleton group becomes one SidebarGroupState', () => {
    const groups = legacyToSidebarGroups([['calendar']], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['calendar'])
    expect(groups[0].activeTab).toBe('calendar')
    expect(groups[0].collapsed).toBe(false)
    expect(typeof groups[0].id).toBe('string')
    expect(groups[0].id.length).toBeGreaterThan(0)
  })

  test('multi-tab pinned groups preserve order; activeTab = first tab', () => {
    const groups = legacyToSidebarGroups([['calendar', 'outline'], ['source-control']], [])
    expect(groups).toHaveLength(2)
    expect(groups[0].tabs).toEqual(['calendar', 'outline'])
    expect(groups[0].activeTab).toBe('calendar')
    expect(groups[1].tabs).toEqual(['source-control'])
    expect(groups[1].activeTab).toBe('source-control')
  })

  test('collapsedPinnedGroups via "group.join(\',\')" maps to group.collapsed', () => {
    const groups = legacyToSidebarGroups(
      [['calendar', 'outline'], ['source-control']],
      ['calendar,outline'],
    )
    expect(groups[0].collapsed).toBe(true)
    expect(groups[1].collapsed).toBe(false)
  })

  test('extraTrailingTab is appended when not already in any group', () => {
    const groups = legacyToSidebarGroups([['calendar']], [], 'files')
    expect(groups).toHaveLength(2)
    expect(groups[1].tabs).toEqual(['files'])
  })

  test('extraTrailingTab is suppressed when already in a group', () => {
    const groups = legacyToSidebarGroups([['calendar', 'files']], [], 'files')
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['calendar', 'files'])
  })

  test('extraTrailingTab is suppressed when it is hidden', () => {
    const groups = legacyToSidebarGroups([['calendar']], [], 'outline', ['outline'])
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['calendar'])
  })

  test('de-dupes across groups (an id can only live in one)', () => {
    const groups = legacyToSidebarGroups([['calendar', 'files'], ['calendar']], [])
    // The second appearance of `calendar` is dropped; if its group
    // becomes empty as a result the group is dropped too.
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['calendar', 'files'])
  })

  test('every migrated group gets a unique stable id', () => {
    const groups = legacyToSidebarGroups([['calendar'], ['outline'], ['source-control']], [])
    const ids = new Set(groups.map(g => g.id))
    expect(ids.size).toBe(3)
  })
})

describe('migrate function — v2 → v3', () => {
  test('v2 with pinnedPanels yields sidebarGroups + drops legacy fields', () => {
    const out = run({
      pinnedPanels: [['calendar'], ['outline']],
      collapsedPinnedGroups: ['outline'],
      sidebarTabOrder: ['files', 'search'],
    }, 2) as unknown as { sidebarGroups?: SidebarGroupState[]; pinnedPanels?: unknown; sidebarTabOrder?: unknown; collapsedPinnedGroups?: unknown }
    expect(out.sidebarGroups).toHaveLength(2)
    expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
    expect(out.sidebarGroups![1].tabs).toEqual(['outline'])
    expect(out.sidebarGroups![1].collapsed).toBe(true)
    expect(out.pinnedPanels).toBeUndefined()
    expect(out.sidebarTabOrder).toBeUndefined()
    expect(out.collapsedPinnedGroups).toBeUndefined()
  })

  test('v2 with empty pinnedPanels seeds the default calendar group', () => {
    const out = run({ pinnedPanels: [] }, 2)
    expect(out.sidebarGroups).toBeDefined()
    expect(out.sidebarGroups!).toHaveLength(1)
    expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
  })

  test('v2 with missing pinnedPanels seeds the default calendar group', () => {
    const out = run({}, 2)
    expect(out.sidebarGroups).toBeDefined()
    expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
  })

  test('v0 full ladder: ["calendar"] default → reset → wrapped → migrated', () => {
    const out = run({ pinnedPanels: ['calendar'] }, 0)
    // v0 resets the default ['calendar'] to []; v1 wraps to [][]; v3
    // falls back to the default calendar group when empty.
    expect(out.sidebarGroups).toBeDefined()
    expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
  })

  test('v0 with customised flat list passes through every step', () => {
    const out = run({ pinnedPanels: ['outline', 'source-control'] }, 0)
    expect(out.sidebarGroups).toHaveLength(2)
    expect(out.sidebarGroups![0].tabs).toEqual(['outline'])
    expect(out.sidebarGroups![1].tabs).toEqual(['source-control'])
  })

  test('v3 (already migrated) passes through untouched', () => {
    const existing = [{ id: 'g1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false }]
    const out = run({ sidebarGroups: existing }, 3)
    expect(out.sidebarGroups).toEqual(existing)
  })

  test('promotes the legacy uiStore sidebarTabId from the localStorage scratch key', () => {
    // The uiStore migration writes sidebarTabId into this key before
    // settingsStore rehydrates; we simulate that here.
    try {
      window.localStorage.setItem('__noteser_legacy_sidebar_tab_id', 'files')
    } catch { /* ignore — non-browser env */ }
    const out = run({ pinnedPanels: [['calendar']] }, 2)
    expect(out.sidebarGroups).toHaveLength(2)
    expect(out.sidebarGroups![1].tabs).toEqual(['files'])
    // Scratch key is consumed.
    expect(window.localStorage.getItem('__noteser_legacy_sidebar_tab_id')).toBeNull()
  })
})
