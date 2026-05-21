/**
 * vaultSettingsConflictModal.test.tsx
 *
 * Verifies the merge UI for vs8x-conflict: renders per-key radios,
 * "take all local / remote" presets, and Apply writes the chosen
 * blend into settingsStore via applyRemoteVaultSettings.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { VaultSettingsConflictModal } from '../components/modals/VaultSettingsConflictModal'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'

beforeEach(() => {
  useUIStore.setState({
    modal: {
      type: 'vault-settings-conflict',
      data: {
        remoteUpdatedAt: 1000,
        remoteHash: 'remote-hash',
        remoteVault: {
          folderSortMode: 'alphabetical',
          taskListDensity: 'compact',
        },
        localVault: {
          folderSortMode: 'modified',
          taskListDensity: 'comfortable',
        },
        diffKeys: ['folderSortMode', 'taskListDensity'],
      },
    },
  })
})

test('renders a row per diffKey with both values visible', () => {
  render(<VaultSettingsConflictModal />)
  expect(screen.getByTestId('vs8x-conflict-row-folderSortMode')).toBeInTheDocument()
  expect(screen.getByTestId('vs8x-conflict-row-taskListDensity')).toBeInTheDocument()
  expect(screen.getByText('modified')).toBeInTheDocument()
  expect(screen.getByText('alphabetical')).toBeInTheDocument()
})

test('"take all local" sets every radio to local', () => {
  render(<VaultSettingsConflictModal />)
  fireEvent.click(screen.getByTestId('vs8x-conflict-take-all-local'))
  expect((screen.getByTestId('vs8x-conflict-folderSortMode-local') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByTestId('vs8x-conflict-taskListDensity-local') as HTMLInputElement).checked).toBe(true)
})

test('Apply writes the chosen blend + closes the modal', () => {
  // Mix: take local for folderSortMode, remote for taskListDensity.
  render(<VaultSettingsConflictModal />)
  fireEvent.click(screen.getByTestId('vs8x-conflict-folderSortMode-local'))
  fireEvent.click(screen.getByTestId('vs8x-conflict-taskListDensity-remote'))
  fireEvent.click(screen.getByTestId('vs8x-conflict-apply'))

  const settings = useSettingsStore.getState()
  expect(settings.folderSortMode).toBe('modified')         // local kept
  expect(settings.taskListDensity).toBe('compact')         // remote won
  // Modal closed after apply.
  expect(useUIStore.getState().modal.type).toBeNull()
})

test('Cancel keeps the modal open until... it closes; settings unchanged', () => {
  // We can't observe "modal stays open" via render in this minimal
  // setup (the cancel button calls closeModal), but we CAN confirm
  // that pressing Cancel doesn't mutate settingsStore.
  useSettingsStore.setState({ folderSortMode: 'modified' })
  render(<VaultSettingsConflictModal />)
  fireEvent.click(screen.getByText(/Cancel/))
  expect(useSettingsStore.getState().folderSortMode).toBe('modified')
})

test('does NOT crash when a different modal is open with a non-conflict data payload', () => {
  // Regression: VaultSettingsConflictModal is always mounted at the
  // root of the tree (alongside DeleteConfirmModal, TemplatesModal,
  // etc.). When the user opens ANY other modal, modal.data carries that
  // modal's payload — e.g. { type: 'note', id } for delete. The old
  // implementation cast modal.data as ConflictData unconditionally and
  // iterated data.diffKeys inside a useMemo, throwing "is not iterable"
  // and trapping clicks behind the Next.js dev overlay. (Caught by the
  // qa-tester sweep on 2026-05-21.)
  useUIStore.setState({
    modal: { type: 'delete', data: { type: 'note', id: 'some-id' } },
  })
  // Render must not throw, and the modal must render NOTHING (it's not
  // the active modal type).
  expect(() => render(<VaultSettingsConflictModal />)).not.toThrow()
  // No vs8x-* testids should appear in the DOM.
  expect(screen.queryByTestId('vs8x-conflict-apply')).not.toBeInTheDocument()
})
