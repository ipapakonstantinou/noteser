// settingsStore: hideSidebarTab + showSidebarTab actions. Used by the
// right-click TabContextMenu and the Settings → Sidebar restore UI.

import { useSettingsStore } from '../stores/settingsStore'

beforeEach(() => {
  useSettingsStore.setState({
    hiddenSidebarTabs: [],
    pinnedPanels: [],
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

  it('auto-unpins the tab from any group it was pinned in', () => {
    useSettingsStore.setState({
      pinnedPanels: [['calendar', 'files'], ['outline']],
    })
    useSettingsStore.getState().hideSidebarTab('calendar')
    const { pinnedPanels, hiddenSidebarTabs } = useSettingsStore.getState()
    // calendar removed from its group, group preserved with remaining members
    expect(pinnedPanels).toEqual([['files'], ['outline']])
    expect(hiddenSidebarTabs).toEqual(['calendar'])
  })

  it('drops the group entirely if hiding removes its last member', () => {
    useSettingsStore.setState({
      pinnedPanels: [['calendar'], ['outline']],
    })
    useSettingsStore.getState().hideSidebarTab('calendar')
    // Group {calendar} is now empty → dropped. {outline} survives.
    expect(useSettingsStore.getState().pinnedPanels).toEqual([['outline']])
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

  it('does NOT re-pin the tab — it just rejoins the bottom strip', () => {
    // The contract: hideSidebarTab unpins eagerly. showSidebarTab does
    // NOT restore the previous pin (that would be surprising — by the
    // time the user shows it again, the original group composition is
    // probably gone). Pinning back is a separate user gesture.
    useSettingsStore.setState({
      hiddenSidebarTabs: ['calendar'],
      pinnedPanels: [['files']],
    })
    useSettingsStore.getState().showSidebarTab('calendar')
    expect(useSettingsStore.getState().pinnedPanels).toEqual([['files']])
    expect(useSettingsStore.getState().hiddenSidebarTabs).toEqual([])
  })
})
