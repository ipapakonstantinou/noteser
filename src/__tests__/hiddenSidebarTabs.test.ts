// settingsStore: hideSidebarTab + showSidebarTab actions. Used by the
// right-click TabContextMenu and the Settings → Sidebar restore UI.
//
// Leaf model (2026-06-04): hideSidebarTab now strips the id from every
// group's tabs array (auto-unpin), dropping groups that go empty.

import { useSettingsStore } from '../stores/settingsStore'

beforeEach(() => {
  useSettingsStore.setState({
    hiddenSidebarTabs: [],
    sidebarGroups: [],
  })
})

describe('hideSidebarTab', () => {
  it('adds the id to hiddenSidebarTabs', () => {
    useSettingsStore.getState().hideSidebarTab('calendar')
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual(['calendar'])
  })

  it('is idempotent — hiding an already-hidden tab is a no-op', () => {
    useSettingsStore.setState({ hiddenSidebarTabs: ['calendar'] })
    useSettingsStore.getState().hideSidebarTab('calendar')
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual(['calendar'])
  })

  it('auto-unpins the tab from any group it lived in', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['calendar', 'files'], activeTab: 'calendar', collapsed: false },
        { id: 'g2', tabs: ['outline'], activeTab: 'outline', collapsed: false },
      ],
    })
    useSettingsStore.getState().hideSidebarTab('calendar')
    const { sidebarGroups, hiddenSidebarTabs } = useSettingsStore.getState()
    expect(hiddenSidebarTabs).toEqual(['calendar'])
    expect(sidebarGroups).toHaveLength(2)
    expect(sidebarGroups[0].tabs).toEqual(['files'])
    // active fell back to first remaining tab.
    expect(sidebarGroups[0].activeTab).toBe('files')
    expect(sidebarGroups[1].tabs).toEqual(['outline'])
  })

  it('drops the group entirely if hiding removes its last member', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
        { id: 'g2', tabs: ['outline'], activeTab: 'outline', collapsed: false },
      ],
    })
    useSettingsStore.getState().hideSidebarTab('calendar')
    const { sidebarGroups } = useSettingsStore.getState()
    expect(sidebarGroups).toHaveLength(1)
    expect(sidebarGroups[0].id).toBe('g2')
  })

  it('preserves other hidden ids when hiding one', () => {
    useSettingsStore.setState({ hiddenSidebarTabs: ['recent'] })
    useSettingsStore.getState().hideSidebarTab('tags')
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual(['recent', 'tags'])
  })
})

describe('showSidebarTab', () => {
  it('removes the id from hiddenSidebarTabs', () => {
    useSettingsStore.setState({ hiddenSidebarTabs: ['calendar', 'recent'] })
    useSettingsStore.getState().showSidebarTab('calendar')
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual(['recent'])
  })

  it('is idempotent — showing a non-hidden tab is a no-op', () => {
    useSettingsStore.setState({ hiddenSidebarTabs: ['recent'] })
    useSettingsStore.getState().showSidebarTab('calendar')
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual(['recent'])
  })

  it('does NOT auto-add the tab back to any group', () => {
    // The contract: hideSidebarTab unpins eagerly. showSidebarTab does
    // NOT restore the previous group membership — restoring is a
    // separate user gesture (activity-bar click).
    useSettingsStore.setState({
      hiddenSidebarTabs: ['calendar'],
      sidebarGroups: [{ id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false }],
    })
    useSettingsStore.getState().showSidebarTab('calendar')
    expect(useSettingsStore.getState().sidebarGroups[0].tabs).toEqual(['files'])
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual([])
  })
})
