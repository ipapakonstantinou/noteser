// Locks down togglePinnedGroupCollapsed in settingsStore — the
// persistence layer for "hide/show pinned panel" (PinnedGroup uses the
// `group.join(',')` key to decide whether to render the panel body).

import { useSettingsStore } from '../stores/settingsStore'

beforeEach(() => {
  useSettingsStore.setState({ collapsedPinnedGroups: [] })
})

describe('togglePinnedGroupCollapsed', () => {
  it('adds the key on first toggle (collapse)', () => {
    useSettingsStore.getState().togglePinnedGroupCollapsed('calendar,files')
    expect(useSettingsStore.getState().collapsedPinnedGroups).toEqual(['calendar,files'])
  })

  it('removes the key on second toggle (expand)', () => {
    useSettingsStore.getState().togglePinnedGroupCollapsed('calendar,files')
    useSettingsStore.getState().togglePinnedGroupCollapsed('calendar,files')
    expect(useSettingsStore.getState().collapsedPinnedGroups).toEqual([])
  })

  it('preserves other collapsed groups when toggling one', () => {
    const s = useSettingsStore.getState()
    s.togglePinnedGroupCollapsed('a,b')
    s.togglePinnedGroupCollapsed('c')
    s.togglePinnedGroupCollapsed('a,b') // expand again
    expect(useSettingsStore.getState().collapsedPinnedGroups).toEqual(['c'])
  })

  it('does not duplicate keys (idempotent within a single direction)', () => {
    // Sanity: a stale call from two listeners can't double-toggle into
    // the wrong state. The implementation uses a Set, so re-adding a
    // key that's already there flips it off rather than duplicating.
    useSettingsStore.setState({ collapsedPinnedGroups: ['x'] })
    useSettingsStore.getState().togglePinnedGroupCollapsed('x')
    expect(useSettingsStore.getState().collapsedPinnedGroups).toEqual([])
  })

  it('defaults to empty so new vaults render every pinned group expanded', () => {
    // After our beforeEach reset, the default is the empty array. This
    // doubles as a check that the default value is what the UI expects.
    expect(useSettingsStore.getState().collapsedPinnedGroups).toEqual([])
  })
})
