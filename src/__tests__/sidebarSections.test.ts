/**
 * sidebarSections.test.ts
 *
 * Verifies the s4r3 stacked-sidebar state in useUIStore:
 *   - default sections start collapsed
 *   - toggle flips collapse, persists height
 *   - setSidebarSectionHeight clamps within bounds
 *   - expandSidebarSection only un-collapses (no other side effects)
 *   - state survives across multiple actions
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { useUIStore, DEFAULT_SECTION_HEIGHT } from '../stores/uiStore'

// Reset the store between tests so we don't bleed state.
beforeEach(() => {
  useUIStore.setState({ sidebarSections: {}, lastFocusedGroupId: null })
})

test('default sections are treated as collapsed', () => {
  const s = useUIStore.getState()
  expect(s.sidebarSections.calendar).toBeUndefined()
  // A consumer reading the absent key falls back to collapsed=true,
  // height=DEFAULT_SECTION_HEIGHT (the contract documented on the type).
})

test('toggleSidebarSection flips collapse and seeds default height', () => {
  const { toggleSidebarSection } = useUIStore.getState()

  toggleSidebarSection('calendar')

  const after1 = useUIStore.getState().sidebarSections.calendar
  expect(after1).toBeDefined()
  expect(after1!.collapsed).toBe(false)
  expect(after1!.height).toBe(DEFAULT_SECTION_HEIGHT)

  toggleSidebarSection('calendar')
  const after2 = useUIStore.getState().sidebarSections.calendar
  expect(after2!.collapsed).toBe(true)
  // Height preserved through collapse so re-opening returns to the
  // same size.
  expect(after2!.height).toBe(DEFAULT_SECTION_HEIGHT)
})

test('setSidebarSectionHeight clamps to [80, 2000]', () => {
  const { setSidebarSectionHeight } = useUIStore.getState()

  setSidebarSectionHeight('outline', 10)
  expect(useUIStore.getState().sidebarSections.outline!.height).toBe(80)

  setSidebarSectionHeight('outline', 9999)
  expect(useUIStore.getState().sidebarSections.outline!.height).toBe(2000)

  setSidebarSectionHeight('outline', 350)
  expect(useUIStore.getState().sidebarSections.outline!.height).toBe(350)
})

test('setSidebarSectionHeight rounds float input', () => {
  useUIStore.getState().setSidebarSectionHeight('backlinks', 240.7)
  expect(useUIStore.getState().sidebarSections.backlinks!.height).toBe(241)
})

test('expandSidebarSection un-collapses, no-op when already expanded', () => {
  const { expandSidebarSection } = useUIStore.getState()

  // Section starts undefined → expand should create an expanded entry.
  expandSidebarSection('backlinks')
  expect(useUIStore.getState().sidebarSections.backlinks!.collapsed).toBe(false)

  // Calling again should be a no-op (same state ref returned by set()).
  const before = useUIStore.getState().sidebarSections
  expandSidebarSection('backlinks')
  expect(useUIStore.getState().sidebarSections).toBe(before)
})

test('expandSidebarSection preserves a previously-set height', () => {
  const { setSidebarSectionHeight, toggleSidebarSection, expandSidebarSection } = useUIStore.getState()

  toggleSidebarSection('calendar')          // expand → height seeded
  setSidebarSectionHeight('calendar', 420)  // resize
  toggleSidebarSection('calendar')          // collapse
  expandSidebarSection('calendar')          // re-expand

  expect(useUIStore.getState().sidebarSections.calendar).toEqual({
    collapsed: false,
    height: 420,
  })
})

test('section state is independent per id', () => {
  const { toggleSidebarSection, setSidebarSectionHeight } = useUIStore.getState()

  toggleSidebarSection('calendar')
  setSidebarSectionHeight('calendar', 300)

  // outline untouched
  expect(useUIStore.getState().sidebarSections.outline).toBeUndefined()
  expect(useUIStore.getState().sidebarSections.calendar).toEqual({
    collapsed: false,
    height: 300,
  })
})

test('setSidebarSectionCollapsed is idempotent when target matches current state', () => {
  const { setSidebarSectionCollapsed } = useUIStore.getState()

  setSidebarSectionCollapsed('outline', false)
  const before = useUIStore.getState().sidebarSections
  setSidebarSectionCollapsed('outline', false) // already expanded
  expect(useUIStore.getState().sidebarSections).toBe(before)
})

// ── lastFocusedGroupId (leaf-model focus tracking) ─────────────────────────

test('default lastFocusedGroupId is null', () => {
  expect(useUIStore.getState().lastFocusedGroupId).toBeNull()
})

test('setLastFocusedGroupId updates the field', () => {
  useUIStore.getState().setLastFocusedGroupId('g-123')
  expect(useUIStore.getState().lastFocusedGroupId).toBe('g-123')
})

test('setLastFocusedGroupId is idempotent when value matches', () => {
  useUIStore.setState({ lastFocusedGroupId: 'g-123' })
  const beforeRef = useUIStore.getState()
  useUIStore.getState().setLastFocusedGroupId('g-123')
  expect(useUIStore.getState()).toBe(beforeRef)
})
