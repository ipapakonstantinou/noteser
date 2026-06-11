/**
 * @jest-environment jsdom
 *
 * Settings → Plugins → Scan vault for plugins. The scanner reads
 * the live note + folder stores and renders results inline. The
 * Install button on each result hands the assembled record to the
 * existing plugin-install-confirm modal (same path the URL flow
 * uses), so the test asserts on uiStore.modal — not on the modal
 * itself.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../plugins/pluginHostSingleton', () => ({
  fetchPluginForInstall: jest.fn(),
  fetchPluginForInstallFromVault: jest.fn(),
  uninstallPlugin: jest.fn(),
}))

// The panel's Built-in plugins section fetches the bundled manifests on
// mount. Keep that fetch pending forever so its post-await setState
// never fires outside act() — these tests exercise the vault-scan flow,
// not the builtin catalog.
beforeAll(() => {
  global.fetch = jest.fn(() => new Promise<Response>(() => { /* never settles */ }))
})

import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginsSettingsPanel } from '../../components/modals/PluginsSettingsPanel'
import { useNoteStore } from '../../stores/noteStore'
import { useFolderStore } from '../../stores/folderStore'
import { useUIStore } from '../../stores/uiStore'
import { usePluginInstallStore } from '../../stores/pluginInstallStore'
import type { Note, Folder } from '../../types'

const mockedHost = jest.requireMock('../../plugins/pluginHostSingleton') as {
  fetchPluginForInstall: jest.Mock
  fetchPluginForInstallFromVault: jest.Mock
  uninstallPlugin: jest.Mock
}

const validManifestBody = JSON.stringify({
  id: 'word-count',
  name: 'Word count',
  version: '1.0.0',
  main: 'https://example.com/word-count/main.js',
  surfaces: { commands: [{ id: 'show', title: 'Word count: show' }] },
})

function makeNote(partial: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: partial.id,
    title: partial.title,
    content: partial.content ?? '',
    folderId: partial.folderId ?? null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
  }
}

function makeFolder(partial: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    id: partial.id,
    name: partial.name,
    parentId: partial.parentId ?? null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    order: 0,
  }
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [] })
  usePluginInstallStore.setState({ records: {} })
  useUIStore.setState({ modal: { type: null } })
  mockedHost.fetchPluginForInstall.mockReset()
  mockedHost.fetchPluginForInstallFromVault.mockReset()
  mockedHost.uninstallPlugin.mockReset()
})

test('empty-state copy when nothing in the vault looks like a manifest', async () => {
  render(<PluginsSettingsPanel />)
  await userEvent.click(screen.getByTestId('settings-plugins-scan'))
  expect(await screen.findByTestId('settings-plugins-scan-empty')).toHaveTextContent(
    /No plugin manifests found in this vault/,
  )
})

test('lists each valid manifest with name, version, and path', async () => {
  useFolderStore.setState({ folders: [makeFolder({ id: 'f1', name: 'Plugins' })] })
  useNoteStore.setState({
    notes: [
      makeNote({
        id: 'n1',
        title: 'manifest.json',
        content: validManifestBody,
        folderId: 'f1',
      }),
    ],
    selectedNoteId: null,
  })

  render(<PluginsSettingsPanel />)
  await userEvent.click(screen.getByTestId('settings-plugins-scan'))
  const list = await screen.findByTestId('settings-plugins-scan-results')
  expect(list).toHaveTextContent('Word count')
  expect(list).toHaveTextContent('v1.0.0')
  expect(list).toHaveTextContent('Plugins/manifest.json')
  expect(list).toHaveTextContent('word-count')
})

test('skips notes titled manifest.json that fail validation, with a skip count', async () => {
  useNoteStore.setState({
    notes: [
      makeNote({ id: 'bad1', title: 'manifest.json', content: 'not json' }),
      makeNote({ id: 'bad2', title: 'manifest.json', content: '{}' }),
    ],
    selectedNoteId: null,
  })
  render(<PluginsSettingsPanel />)
  await userEvent.click(screen.getByTestId('settings-plugins-scan'))
  const empty = await screen.findByTestId('settings-plugins-scan-empty')
  expect(empty).toHaveTextContent(/Skipped 2 note\(s\)/)
})

test('clicking Install on a candidate opens the existing confirm modal with a record', async () => {
  useNoteStore.setState({
    notes: [
      makeNote({ id: 'n1', title: 'manifest.json', content: validManifestBody }),
    ],
    selectedNoteId: null,
  })
  const fakeRecord = {
    manifest: JSON.parse(validManifestBody),
    mainSource: 'export default {}',
    hash: 'abc',
    sourceUrl: 'vault: manifest.json',
    addedAt: 0,
    enabled: true,
  }
  mockedHost.fetchPluginForInstallFromVault.mockResolvedValueOnce(fakeRecord)

  render(<PluginsSettingsPanel />)
  await userEvent.click(screen.getByTestId('settings-plugins-scan'))
  await userEvent.click(await screen.findByTestId('settings-plugins-scan-install-word-count'))

  await waitFor(() => {
    expect(useUIStore.getState().modal.type).toBe('plugin-install-confirm')
  })
  expect(mockedHost.fetchPluginForInstallFromVault).toHaveBeenCalledTimes(1)
  expect(useUIStore.getState().modal.data).toEqual({ record: fakeRecord })
})

test('renders the error state when fetching the bundle for a candidate fails', async () => {
  useNoteStore.setState({
    notes: [
      makeNote({ id: 'n1', title: 'manifest.json', content: validManifestBody }),
    ],
    selectedNoteId: null,
  })
  mockedHost.fetchPluginForInstallFromVault.mockRejectedValueOnce(new Error('HTTP 500 fetching main.js'))

  render(<PluginsSettingsPanel />)
  await userEvent.click(screen.getByTestId('settings-plugins-scan'))
  await userEvent.click(await screen.findByTestId('settings-plugins-scan-install-word-count'))

  const err = await screen.findByTestId('settings-plugins-scan-error')
  expect(err).toHaveTextContent('Could not read vault: HTTP 500 fetching main.js')
})

test('surface-level error state covers a thrown scan (defensive path)', async () => {
  // Force noteStore.getState() to throw on the next call by monkey-patching
  // its getState. This exercises the catch in handleScan().
  const original = useNoteStore.getState
  useNoteStore.getState = (() => {
    throw new Error('store unavailable')
  }) as typeof useNoteStore.getState

  try {
    render(<PluginsSettingsPanel />)
    await act(async () => {
      await userEvent.click(screen.getByTestId('settings-plugins-scan'))
    })
    const err = await screen.findByTestId('settings-plugins-scan-error')
    expect(err).toHaveTextContent('Could not read vault: store unavailable')
  } finally {
    useNoteStore.getState = original
  }
})
