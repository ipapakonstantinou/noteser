/**
 * activityBarPinUnpinDrag.test.tsx
 *
 * Covers the ActivityBar's drag-to-pin and drag-to-unpin flows
 * introduced in the 2026-06-04 Obsidian-style ActivityBar refactor.
 *
 * Strategy: render the Ribbon (which IS the ActivityBar — the export
 * name kept for back-compat), seed the settings store with a known
 * pinned-panels state, then fire a synthetic drop on the
 * activity-bar-pinned-section / activity-bar-unpinned-section drop
 * zone and assert that useSettingsStore.pinnedPanels gets the new
 * group appended / the existing entry removed.
 *
 * jsdom does not ship DragEvent.dataTransfer, so we install a small
 * FakeDataTransfer instance per drag and patch it onto the event
 * via a capturing listener — same trick the existing
 * dragGuards.test.tsx uses.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

import { Ribbon } from '../components/sidebar/Ribbon'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const TAB_DRAG_MIME = 'application/x-noteser-sidebar-tab'
const SIDEBAR_PANEL_DRAG_MIME = 'application/x-noteser-sidebar-panel'

// Minimal DataTransfer stand-in. Exposes the bits the ActivityBar
// handlers actually read: types (a string[] containing the MIME we
// stuffed in), getData(mime), setData(mime, value), dropEffect,
// effectAllowed. We pre-seed `types` + the per-mime payload because
// dragstart isn't what's being tested here — we're firing the DROP
// directly, so types[] must include the simulated payload mime.
class FakeDataTransfer {
  effectAllowed: string = ''
  dropEffect: string = ''
  types: string[] = []
  private data: Map<string, string> = new Map()
  getData(key: string): string { return this.data.get(key) ?? '' }
  setData(key: string, value: string): void {
    this.data.set(key, value)
    if (!this.types.includes(key)) this.types.push(key)
  }
  items = { add: jest.fn(), clear: jest.fn(), remove: jest.fn(), length: 0 }
}

;(globalThis as unknown as Record<string, unknown>).DataTransfer = FakeDataTransfer

// Fires a synthetic drag event on `el` whose dataTransfer carries the
// payload (mime → id). Handles dragover (which needs preventDefault
// to permit the subsequent drop) and drop.
function fireDragEventWithPayload(
  el: HTMLElement,
  eventName: 'dragOver' | 'drop',
  payload: { mime: string; id: string },
): void {
  const patchListener = (e: Event) => {
    const dragEv = e as DragEvent
    const fdt = new FakeDataTransfer()
    fdt.setData(payload.mime, payload.id)
    Object.defineProperty(dragEv, 'dataTransfer', { value: fdt, configurable: true })
  }
  el.addEventListener(eventName.toLowerCase(), patchListener, { capture: true })
  if (eventName === 'dragOver') fireEvent.dragOver(el)
  else fireEvent.drop(el)
  el.removeEventListener(eventName.toLowerCase(), patchListener, { capture: true })
}

describe('ActivityBar — drag-to-pin / drag-to-unpin', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      pinnedPanels: [],
      sidebarTabOrder: [],
      hiddenSidebarTabs: [],
      ribbonOrder: [],
    })
    useUIStore.setState({ sidebarTabId: 'files', sidebarCollapsed: false })
  })

  test('dropping an unpinned panel onto the pinned section appends a new group', () => {
    render(<Ribbon />)

    // Sanity: starts empty.
    expect(useSettingsStore.getState().pinnedPanels).toEqual([])

    const pinSection = screen.getByTestId('activity-bar-pinned-section')

    // The drop handler reads `dataTransfer.types` to ensure the
    // payload mime is present, so we fire dragOver first to keep the
    // sequence faithful to a real drag (and to ensure preventDefault
    // pathway runs). Then we fire the drop.
    fireDragEventWithPayload(pinSection, 'dragOver', { mime: TAB_DRAG_MIME, id: 'calendar' })
    fireDragEventWithPayload(pinSection, 'drop', { mime: TAB_DRAG_MIME, id: 'calendar' })

    expect(useSettingsStore.getState().pinnedPanels).toEqual([['calendar']])
  })

  test('dropping a pinned panel onto the unpinned section removes it from pinnedPanels', () => {
    useSettingsStore.setState({ pinnedPanels: [['calendar']] })

    render(<Ribbon />)

    expect(useSettingsStore.getState().pinnedPanels).toEqual([['calendar']])

    const unpinSection = screen.getByTestId('activity-bar-unpinned-section')

    fireDragEventWithPayload(unpinSection, 'dragOver', { mime: SIDEBAR_PANEL_DRAG_MIME, id: 'calendar' })
    fireDragEventWithPayload(unpinSection, 'drop', { mime: SIDEBAR_PANEL_DRAG_MIME, id: 'calendar' })

    expect(useSettingsStore.getState().pinnedPanels).toEqual([])
  })

  test('pin drop is idempotent — same id dropped twice does not duplicate', () => {
    useSettingsStore.setState({ pinnedPanels: [['calendar']] })
    render(<Ribbon />)

    const pinSection = screen.getByTestId('activity-bar-pinned-section')
    fireDragEventWithPayload(pinSection, 'drop', { mime: TAB_DRAG_MIME, id: 'calendar' })

    // pinAsNewGroup bails when the id is already pinned somewhere.
    expect(useSettingsStore.getState().pinnedPanels).toEqual([['calendar']])
  })
})
