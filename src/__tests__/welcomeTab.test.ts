/**
 * welcomeTab.test.ts
 *
 * Coverage for the workspaceStore.openWelcome action + the side-effect
 * where closing the welcome tab marks onboardingShown so it doesn't
 * reopen on the next session.
 *
 * Pure store-level test — doesn't render WelcomePane. The component is
 * exercised end-to-end via Playwright (and the visual capture).
 */

import { useWorkspaceStore } from '../stores/workspaceStore'
import { useSettingsStore } from '../stores/settingsStore'

// Reset both stores to known empty state before each test so the
// preceding test doesn't leak its workspace into ours.
beforeEach(() => {
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  useSettingsStore.setState({ onboardingShown: false })
})

test('openWelcome creates a welcome tab in the active pane', () => {
  useWorkspaceStore.getState().openWelcome()
  const { panes, activePaneId } = useWorkspaceStore.getState()
  expect(panes).toHaveLength(1)
  expect(panes[0].tabs).toHaveLength(1)
  expect(panes[0].tabs[0].kind).toBe('welcome')
  expect(panes[0].activeTabId).toBe(panes[0].tabs[0].id)
  expect(activePaneId).toBe('p1')
})

test('openWelcome twice is idempotent — focuses the existing tab', () => {
  useWorkspaceStore.getState().openWelcome()
  const firstId = useWorkspaceStore.getState().panes[0].tabs[0].id

  useWorkspaceStore.getState().openWelcome()
  const { panes } = useWorkspaceStore.getState()
  expect(panes[0].tabs).toHaveLength(1)
  expect(panes[0].tabs[0].id).toBe(firstId)
})

test('closing the welcome tab flips onboardingShown to true', async () => {
  useWorkspaceStore.getState().openWelcome()
  const tabId = useWorkspaceStore.getState().panes[0].tabs[0].id

  useWorkspaceStore.getState().closeTab(tabId)

  // The store imports settingsStore dynamically; let the microtask flush.
  await new Promise(r => setTimeout(r, 10))

  expect(useSettingsStore.getState().onboardingShown).toBe(true)
})

test('closing a note tab does NOT flip onboardingShown', async () => {
  // Manually seed a note tab so we don't depend on noteStore wiring.
  useWorkspaceStore.setState({
    panes: [{
      id: 'p1',
      tabs: [{ id: 't1', kind: 'note', noteId: 'n1', isPreview: false }],
      activeTabId: 't1',
    }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  useWorkspaceStore.getState().closeTab('t1')
  await new Promise(r => setTimeout(r, 10))
  expect(useSettingsStore.getState().onboardingShown).toBe(false)
})

test('welcome tabs are excluded from persisted state (partialize)', () => {
  // Drive the partialize function directly so we don't depend on
  // localStorage mechanics.
  useWorkspaceStore.setState({
    panes: [{
      id: 'p1',
      tabs: [
        { id: 't1', kind: 'note', noteId: 'n1', isPreview: false },
        { id: 't2', kind: 'welcome' },
      ],
      activeTabId: 't2',
    }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })

  // The persist middleware was configured with `partialize` to drop
  // non-note tabs. Read it back through the persist API.
  const persisted = useWorkspaceStore.persist.getOptions().partialize?.(
    useWorkspaceStore.getState(),
  ) as { panes: { tabs: { kind: string }[] }[] } | undefined

  expect(persisted).toBeTruthy()
  const persistedTabs = persisted!.panes[0].tabs
  // Only the note tab survived; the welcome tab is dropped.
  expect(persistedTabs).toHaveLength(1)
  expect(persistedTabs[0].kind).toBe('note')
})
