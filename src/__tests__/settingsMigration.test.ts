/**
 * settingsMigration.test.ts
 *
 * Verifies the persist `migrate` function on useSettingsStore — the
 * full ladder runs every step from `version` up to the current schema,
 * so a v0 input ends up at the current version.
 *
 * Ladders today:
 *   v0→v1 — strip pinnedPanels=['calendar'] default
 *   v1→v2 — wrap flat string[] into string[][] groups
 *   v2→v3 — fold pinnedPanels + collapsedPinnedGroups into sidebarGroups
 *           and wipe the legacy fields.
 *   v3→v4 — retitle weekly notes 'YYYY-WW' -> 'YYYY-[W]WW'.
 *
 * For granular tests of the v3 step itself (and the legacyToSidebarGroups
 * helper) see sidebarGroupsMigration.test.ts.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { useSettingsStore } from '../stores/settingsStore'
import type { SidebarGroupState } from '../stores/settingsStore'

type PersistStore = typeof useSettingsStore & {
  persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } }
}
const migrate = (useSettingsStore as PersistStore).persist.getOptions().migrate!

function run(state: unknown, version: number): {
  pinnedPanels?: unknown
  sidebarGroups?: SidebarGroupState[]
} {
  return migrate(state, version) as unknown as {
    pinnedPanels?: unknown
    sidebarGroups?: SidebarGroupState[]
  }
}

// Make every test start from a clean localStorage so the v2→v3 step's
// scratch-key consumption is deterministic.
beforeEach(() => {
  try { window.localStorage.removeItem('__noteser_legacy_sidebar_tab_id') } catch { /* noop */ }
})

// ── v0 reset (historical Calendar default) ─────────────────────────────────

test('v0 default ["calendar"] flows through every step → default calendar group', () => {
  // v0 resets to []; v1 wraps []; v3 falls back to the default group.
  const out = run({ pinnedPanels: ['calendar'] }, 0)
  expect(out.pinnedPanels).toBeUndefined()
  expect(out.sidebarGroups).toHaveLength(1)
  expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
})

test('v0 with empty pinnedPanels yields the default calendar group', () => {
  const out = run({ pinnedPanels: [] }, 0)
  expect(out.pinnedPanels).toBeUndefined()
  expect(out.sidebarGroups).toHaveLength(1)
  expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
})

test('v0 with a customised flat list becomes one group per entry', () => {
  const out = run({ pinnedPanels: ['calendar', 'outline'] }, 0)
  expect(out.sidebarGroups).toHaveLength(2)
  expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
  expect(out.sidebarGroups![1].tabs).toEqual(['outline'])
  expect(out.pinnedPanels).toBeUndefined()
})

test('v0 with a single non-calendar pin survives + wraps', () => {
  const out = run({ pinnedPanels: ['outline'] }, 0)
  expect(out.sidebarGroups).toHaveLength(1)
  expect(out.sidebarGroups![0].tabs).toEqual(['outline'])
})

// ── v1→v3 ────────────────────────────────────────────────────────────────

test('v1 flat array becomes one group per id (then folded to sidebarGroups)', () => {
  const out = run({ pinnedPanels: ['calendar', 'source-control'] }, 1)
  expect(out.sidebarGroups).toHaveLength(2)
  expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
  expect(out.sidebarGroups![1].tabs).toEqual(['source-control'])
})

test('v1 empty array seeds the default group', () => {
  const out = run({ pinnedPanels: [] }, 1)
  expect(out.sidebarGroups).toHaveLength(1)
  expect(out.sidebarGroups![0].tabs).toEqual(['calendar'])
})

// ── v2→v3 ────────────────────────────────────────────────────────────────

test('v2 nested groups pass through into sidebarGroups', () => {
  const out = run({ pinnedPanels: [['calendar', 'outline'], ['source-control']] }, 2)
  expect(out.sidebarGroups).toHaveLength(2)
  expect(out.sidebarGroups![0].tabs).toEqual(['calendar', 'outline'])
  expect(out.sidebarGroups![1].tabs).toEqual(['source-control'])
  expect(out.pinnedPanels).toBeUndefined()
})

test('handles missing pinnedPanels gracefully across all versions', () => {
  // No pinnedPanels at all → fall back to the default calendar group.
  expect(run({}, 0).sidebarGroups![0].tabs).toEqual(['calendar'])
  expect(run({}, 1).sidebarGroups![0].tabs).toEqual(['calendar'])
  expect(run({}, 2).sidebarGroups![0].tabs).toEqual(['calendar'])
})

describe('v3→v4: weekly note title format', () => {
  test('rewrites the old default so weekly notes stop being named "2026-30"', () => {
    const out = migrate({ weeklyNoteDateFormat: 'YYYY-WW' }, 3) as {
      weeklyNoteDateFormat: string
    }
    expect(out.weeklyNoteDateFormat).toBe('YYYY-[W]WW')
  })

  test('leaves a deliberately customised format alone', () => {
    const out = migrate({ weeklyNoteDateFormat: 'GGGG/[week]-W' }, 3) as {
      weeklyNoteDateFormat: string
    }
    expect(out.weeklyNoteDateFormat).toBe('GGGG/[week]-W')
  })

  test('does not touch an already-migrated install', () => {
    const out = migrate({ weeklyNoteDateFormat: 'YYYY-WW' }, 4) as {
      weeklyNoteDateFormat: string
    }
    expect(out.weeklyNoteDateFormat).toBe('YYYY-WW')
  })
})
