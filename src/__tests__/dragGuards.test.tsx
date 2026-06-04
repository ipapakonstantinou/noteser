/**
 * dragGuards.test.tsx
 *
 * Component-level tests that verify the primary-button drag guard in each of
 * the five files that inline the `e.nativeEvent.button !== 0` check:
 *
 *   1. TabBar         (src/components/editor/TabBar.tsx)
 *   2. Ribbon         (src/components/sidebar/Ribbon.tsx)
 *   3. SidebarSection (src/components/sidebar/SidebarSection.tsx)
 *   4. TabSwitcher    (src/components/sidebar/TabSwitcher.tsx)
 *   5. PinnedMiniStrip(src/components/sidebar/PinnedMiniStrip.tsx)
 *
 * Strategy: render the minimal version of each draggable element and fire
 * synthetic dragstart events with button=0 (should proceed) and button=2
 * (should bail — dataTransfer.setData never called).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// ── PinnedMiniStrip: mock sidebarPanelRegistry ────────────────────────────────
jest.mock('../components/sidebar/sidebarPanelRegistry', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    PANELS: [
      {
        id: 'files',
        title: 'Files',
        Icon: () => React.createElement('span', { 'aria-label': 'files-icon' }),
      },
    ],
    PanelBody: ({ id }: { id: string }) =>
      React.createElement('div', { 'data-testid': `panel-body-${id}` }, `body:${id}`),
    TAB_DRAG_MIME: 'application/x-noteser-sidebar-tab',
    resolveTabOrder: (saved: string[]) => saved,
  }
})

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

import { TabBar } from '../components/editor/TabBar'
import { Ribbon } from '../components/sidebar/Ribbon'
import { SidebarSection } from '../components/sidebar/SidebarSection'
import { TabSwitcher } from '../components/sidebar/TabSwitcher'
import { PinnedMiniStrip } from '../components/sidebar/PinnedMiniStrip'

import { useNoteStore } from '../stores/noteStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import type { SidebarTabId } from '../stores/uiStore'
import type { PaneState } from '../stores/workspaceStore'

// ── drag event harness ────────────────────────────────────────────────────────
//
// jsdom does not implement DragEvent.dataTransfer or populate nativeEvent.button
// for drag events fired via fireEvent. We work around this by:
//
// 1. Injecting a fake global DataTransfer class whose instances record setData
//    calls so our spy works even though jsdom doesn't ship DataTransfer.
//
// 2. Wiring a capturing event listener that intercepts the DOM DragEvent BEFORE
//    React wraps it and patches `button` + `dataTransfer` on the event object
//    directly, so both e.nativeEvent.button and e.dataTransfer are correct when
//    the React onDragStart handler reads them.

const setDataCalls: Array<[string, string]> = []

// Install a global DataTransfer stub (once per test file — jsdom doesn't have it).
class FakeDataTransfer {
  effectAllowed: string = ''
  getData(_key: string) { return '' }
  setData(key: string, value: string) { setDataCalls.push([key, value]) }
  types: string[] = []
  items = { add: jest.fn(), clear: jest.fn(), remove: jest.fn(), length: 0 }
}

;(globalThis as unknown as Record<string, unknown>).DataTransfer = FakeDataTransfer

function fireDragStartWithButton(element: HTMLElement, button: number) {
  // We use a capturing listener to patch the DragEvent just before React sees it.
  const patchListener = (e: Event) => {
    const dragEv = e as DragEvent
    // Set button by patching the own property on THIS event instance.
    Object.defineProperty(dragEv, 'button', { value: button, configurable: true })
    // Provide a real fake dataTransfer.
    const fdt = new FakeDataTransfer()
    Object.defineProperty(dragEv, 'dataTransfer', { value: fdt, configurable: true })
  }
  element.addEventListener('dragstart', patchListener, { capture: true })
  setDataCalls.length = 0
  fireEvent.dragStart(element)
  element.removeEventListener('dragstart', patchListener, { capture: true })
}

afterEach(() => {
  setDataCalls.length = 0
})

// ── 1. TabBar ─────────────────────────────────────────────────────────────────

describe('TabBar — dragstart primary-button guard', () => {
  const PANE_ID = 'pane-1'
  const NOTE_ID = 'note-1'

  function seedWorkspaceWithTab() {
    useNoteStore.setState({
      notes: [{ id: NOTE_ID, title: 'Tab Note', content: '', folderId: null,
        createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null, isPinned: false, templateId: null }],
      selectedNoteId: null,
    })
    const pane: PaneState = {
      id: PANE_ID,
      tabs: [{ id: 'tab-1', kind: 'note', noteId: NOTE_ID, isPreview: false }],
      activeTabId: 'tab-1',
    }
    useWorkspaceStore.setState({ panes: [pane], activePaneId: PANE_ID })
  }

  beforeEach(() => seedWorkspaceWithTab())

  test('button=0: dragstart sets data on dataTransfer', () => {
    render(<TabBar pane={useWorkspaceStore.getState().panes[0]} />)
    const draggable = screen.getByTitle('Tab Note')
    fireDragStartWithButton(draggable, 0)
    expect(setDataCalls.length).toBeGreaterThan(0)
  })

  test('button=2: dragstart does NOT set data on dataTransfer', () => {
    render(<TabBar pane={useWorkspaceStore.getState().panes[0]} />)
    const draggable = screen.getByTitle('Tab Note')
    fireDragStartWithButton(draggable, 2)
    expect(setDataCalls.length).toBe(0)
  })
})

// ── 2. Ribbon ─────────────────────────────────────────────────────────────────

describe('Ribbon — dragstart primary-button guard', () => {
  beforeEach(() => {
    useSettingsStore.setState({ ribbonOrder: [] })
  })

  test('button=0: dragstart on ribbon item sets MIME data', () => {
    render(<Ribbon />)
    const item = screen.getByTestId('ribbon-item-new-note')
    fireDragStartWithButton(item, 0)
    expect(setDataCalls.length).toBeGreaterThan(0)
  })

  test('button=2: dragstart on ribbon item does NOT set MIME data', () => {
    render(<Ribbon />)
    const item = screen.getByTestId('ribbon-item-new-note')
    fireDragStartWithButton(item, 2)
    expect(setDataCalls.length).toBe(0)
  })
})

// ── 3. SidebarSection ─────────────────────────────────────────────────────────

describe('SidebarSection — dragstart primary-button guard', () => {
  beforeEach(() => {
    // Make the section expanded by default.
    useUIStore.setState({
      sidebarSections: { calendar: { collapsed: false, height: 220 } },
    })
  })

  test('button=0: dragstart on draggable header sets MIME data', () => {
    render(
      <SidebarSection id="calendar" title="Calendar" draggablePanelId="calendar">
        <div>content</div>
      </SidebarSection>
    )
    const header = screen.getByRole('button', { name: /calendar/i })
    fireDragStartWithButton(header, 0)
    expect(setDataCalls.length).toBeGreaterThan(0)
  })

  test('button=2: dragstart on draggable header does NOT set MIME data', () => {
    render(
      <SidebarSection id="calendar" title="Calendar" draggablePanelId="calendar">
        <div>content</div>
      </SidebarSection>
    )
    const header = screen.getByRole('button', { name: /calendar/i })
    fireDragStartWithButton(header, 2)
    expect(setDataCalls.length).toBe(0)
  })
})

// ── 4. TabSwitcher ────────────────────────────────────────────────────────────

// TabSwitcher's horizontal icon strip was removed 2026-06-04 in the
// "one bar, like VS Code" refactor — panel switching moved to the
// Ribbon on the far left. The drag-from-strip-icon path no longer
// exists, so this section's primary-button guard is obsolete. Keeping
// the describe block as a tombstone for git-archaeology purposes.
describe.skip('TabSwitcher — dragstart primary-button guard (removed 2026-06-04)', () => {
  test('placeholder', () => {})
})

// ── 5. PinnedMiniStrip ────────────────────────────────────────────────────────

describe('PinnedMiniStrip — dragstart primary-button guard', () => {
  const IDS: SidebarTabId[] = ['files']

  test('button=0: dragstart on pinned icon sets MIME data', () => {
    render(
      <PinnedMiniStrip
        ids={IDS}
        activeId="files"
        onActivate={jest.fn()}
        onUnpin={jest.fn()}
        onAddToThisGroup={jest.fn()}
      />
    )
    const icon = screen.getByTestId('sidebar-pinned-tab-files')
    fireDragStartWithButton(icon, 0)
    expect(setDataCalls.length).toBeGreaterThan(0)
  })

  test('button=2: dragstart on pinned icon does NOT set MIME data', () => {
    render(
      <PinnedMiniStrip
        ids={IDS}
        activeId="files"
        onActivate={jest.fn()}
        onUnpin={jest.fn()}
        onAddToThisGroup={jest.fn()}
      />
    )
    const icon = screen.getByTestId('sidebar-pinned-tab-files')
    fireDragStartWithButton(icon, 2)
    expect(setDataCalls.length).toBe(0)
  })
})
