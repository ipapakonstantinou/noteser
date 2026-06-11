/**
 * trashSettingsPanel.test.tsx
 *
 * #178 — Settings → General grows a dedicated "Trash" sub-section that
 * groups the keep-trash vs delete-permanently toggle (`trashMode`), the
 * configurable trash folder name (`trashFolderName`), and the two
 * delete-confirmation toggles:
 *   - the section renders with all four controls
 *   - the Delete behaviour select round-trips into settingsStore.trashMode
 *   - the Trash folder input commits (and normalises a blank back to `.trash`)
 *   - both settings are vault-synced (VAULT_SETTING_KEYS) so they reach
 *     other devices via the settings file — the trash folder itself never
 *     exists in the repo tree (trashed notes are deleted from the remote
 *     on push), which is why renaming is safe for existing vaults
 *   - the in-modal settings search can find the Trash folder entry
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralPanel } from '../components/modals/settings/panels/GeneralPanel'
import { SETTINGS_CATALOG } from '../components/modals/settings/settingsCatalog'
import { filterSettingsCatalog } from '../components/modals/settings/filterSettingsCatalog'
import { useSettingsStore, VAULT_SETTING_KEYS } from '../stores/settingsStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'

beforeEach(() => {
  useSettingsStore.setState({
    trashMode: 'trash',
    trashFolderName: '.trash',
    confirmBeforeTrash: true,
    confirmBulkDelete: true,
  })
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
})

const trashSection = () => screen.getByTestId('settings-trash-section')

describe('Settings → General → Trash section (#178)', () => {
  test('renders the Trash heading with all four controls', () => {
    render(<GeneralPanel />)
    const section = trashSection()
    expect(within(section).getByText('Trash')).toBeInTheDocument()
    expect(within(section).getByText('Delete behaviour')).toBeInTheDocument()
    expect(within(section).getByText('Trash folder')).toBeInTheDocument()
    expect(within(section).getByText('Confirm before moving notes to trash')).toBeInTheDocument()
    expect(within(section).getByText('Confirm before bulk delete')).toBeInTheDocument()
  })

  test('Delete behaviour select flips trashMode to hardDelete and back', async () => {
    const user = userEvent.setup()
    render(<GeneralPanel />)
    const select = screen.getByTestId('settings-trash-mode')

    await user.selectOptions(select, 'hardDelete')
    expect(useSettingsStore.getState().trashMode).toBe('hardDelete')

    await user.selectOptions(select, 'trash')
    expect(useSettingsStore.getState().trashMode).toBe('trash')
  })

  test('committing a new trash folder name updates the store', async () => {
    const user = userEvent.setup()
    render(<GeneralPanel />)
    const input = within(trashSection()).getByDisplayValue('.trash')

    await user.clear(input)
    await user.type(input, '.recycle')
    await user.tab() // blur commits
    expect(useSettingsStore.getState().trashFolderName).toBe('.recycle')
  })

  test('a blank trash folder name normalises back to ".trash"', async () => {
    useSettingsStore.setState({ trashFolderName: '.recycle' })
    const user = userEvent.setup()
    render(<GeneralPanel />)
    const input = within(trashSection()).getByDisplayValue('.recycle')

    await user.clear(input)
    await user.tab()
    expect(useSettingsStore.getState().trashFolderName).toBe('.trash')
  })

  test('both trash settings are vault-synced so they round-trip across devices', () => {
    expect(VAULT_SETTING_KEYS).toContain('trashMode')
    expect(VAULT_SETTING_KEYS).toContain('trashFolderName')
  })

  test('the settings search surfaces the Trash folder entry', () => {
    const ids = filterSettingsCatalog(SETTINGS_CATALOG, 'trash').map(e => e.id)
    expect(ids).toContain('general.trashFolderName')
    expect(ids).toContain('general.trashMode')
  })
})
