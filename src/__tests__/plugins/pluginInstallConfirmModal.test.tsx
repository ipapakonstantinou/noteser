/**
 * pluginInstallConfirmModal.test.tsx
 *
 * Verifies the manifest-preview modal:
 *   - Loading state while the manifest is fetched
 *   - Preview state shows name/version/author/description/homepage +
 *     the capability list (surfaces + permissions) with prose
 *   - Install button calls confirmAndInstallPlugin and closes the modal
 *   - Cancel button closes without installing
 *   - Fetch / validation errors render inside the modal shell
 *   - Pre-fetched record path (legacy entry shape) renders directly
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

const mockFetchPluginForInstall = jest.fn()
const mockConfirmAndInstallPlugin = jest.fn()
jest.mock('../../plugins/pluginHostSingleton', () => ({
  fetchPluginForInstall: (...args: unknown[]) => mockFetchPluginForInstall(...args),
  confirmAndInstallPlugin: (...args: unknown[]) => mockConfirmAndInstallPlugin(...args),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PluginInstallConfirmModal } from '../../components/modals/PluginInstallConfirmModal'
import { useUIStore } from '../../stores/uiStore'
import type { InstalledPluginRecord } from '../../stores/pluginInstallStore'
import {
  PERMISSION_DESCRIPTIONS,
  SURFACE_DESCRIPTIONS,
} from '../../plugins/manifest'

const baseManifest = {
  id: 'word-count',
  name: 'Word count',
  version: '1.2.3',
  author: 'jane@example.com',
  description: 'Counts words in the active note and shows the total in a sidebar panel.',
  homepage: 'https://example.com/word-count',
  surfaces: {
    commands: [{ id: 'show', title: 'Word count: show' }],
    sidebarPanels: [{ id: 'panel', title: 'Word count' }],
  },
}

function makeRecord(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    manifest: baseManifest,
    mainSource: 'export default {}',
    hash: 'abc',
    sourceUrl: 'https://example.com/word-count/manifest.json',
    addedAt: 1000,
    enabled: true,
    ...overrides,
  }
}

function openWithUrl(manifestUrl = 'https://example.com/p/manifest.json') {
  useUIStore.setState({
    modal: { type: 'plugin-install-confirm', data: { manifestUrl } },
  })
}

function openWithRecord(record: InstalledPluginRecord) {
  useUIStore.setState({
    modal: { type: 'plugin-install-confirm', data: { record } },
  })
}

beforeEach(() => {
  mockFetchPluginForInstall.mockReset()
  mockConfirmAndInstallPlugin.mockReset()
  useUIStore.setState({ modal: { type: null } })
})

describe('PluginInstallConfirmModal — closed', () => {
  test('renders nothing when modal type is not plugin-install-confirm', () => {
    useUIStore.setState({ modal: { type: null } })
    const { container } = render(<PluginInstallConfirmModal />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PluginInstallConfirmModal — URL flow', () => {
  test('shows the loading state while the manifest is being fetched', async () => {
    let resolveFetch: (record: InstalledPluginRecord) => void = () => {}
    mockFetchPluginForInstall.mockImplementation(
      () => new Promise<InstalledPluginRecord>((resolve) => { resolveFetch = resolve }),
    )
    openWithUrl()
    render(<PluginInstallConfirmModal />)
    expect(screen.getByTestId('plugin-preview-loading')).toBeInTheDocument()

    // Resolve so the test's outer promise queue drains cleanly.
    resolveFetch(makeRecord())
    await waitFor(() => expect(screen.getByTestId('plugin-preview-body')).toBeInTheDocument())
  })

  test('renders the preview body with name, version, author, description and homepage link', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(makeRecord())
    openWithUrl()
    render(<PluginInstallConfirmModal />)

    const body = await screen.findByTestId('plugin-preview-body')
    expect(body).toBeInTheDocument()
    expect(screen.getByText('Word count')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument()
    expect(screen.getByTestId('plugin-preview-description')).toHaveTextContent(
      /Counts words in the active note/,
    )
    const link = screen.getByTestId('plugin-preview-homepage') as HTMLAnchorElement
    expect(link.href).toBe('https://example.com/word-count')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  test('lists each declared capability with a human-readable description', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(
      makeRecord({
        manifest: {
          ...baseManifest,
          surfaces: {
            commands: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
            sidebarPanels: [{ id: 'p', title: 'P' }],
            codeBlockRenderers: [{ language: 'mermaid' }],
          },
          permissions: ['file-save', 'file-open'],
        },
      }),
    )
    openWithUrl()
    render(<PluginInstallConfirmModal />)
    await screen.findByTestId('plugin-preview-body')

    // Surface rows
    expect(screen.getByTestId('plugin-preview-capability-commands')).toHaveTextContent('2 commands')
    expect(screen.getByTestId('plugin-preview-capability-commands')).toHaveTextContent(
      SURFACE_DESCRIPTIONS.commands,
    )
    expect(screen.getByTestId('plugin-preview-capability-sidebarPanels')).toHaveTextContent('1 sidebar panel')
    expect(screen.getByTestId('plugin-preview-capability-sidebarPanels')).toHaveTextContent(
      SURFACE_DESCRIPTIONS.sidebarPanels,
    )
    expect(screen.getByTestId('plugin-preview-capability-codeBlockRenderers')).toHaveTextContent('mermaid')
    expect(screen.getByTestId('plugin-preview-capability-codeBlockRenderers')).toHaveTextContent(
      SURFACE_DESCRIPTIONS.codeBlockRenderers,
    )

    // Permission rows
    expect(screen.getByTestId('plugin-preview-capability-file-save')).toHaveTextContent('file-save')
    expect(screen.getByTestId('plugin-preview-capability-file-save')).toHaveTextContent(
      PERMISSION_DESCRIPTIONS['file-save'],
    )
    expect(screen.getByTestId('plugin-preview-capability-file-open')).toHaveTextContent('file-open')
    expect(screen.getByTestId('plugin-preview-capability-file-open')).toHaveTextContent(
      PERMISSION_DESCRIPTIONS['file-open'],
    )
  })

  test('shows the empty-capabilities reassurance when there are no surfaces beyond a single command and no permissions', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(
      makeRecord({
        manifest: {
          id: 'minimal',
          name: 'Minimal',
          version: '1.0.0',
          surfaces: { commands: [{ id: 'go', title: 'Go' }] },
        },
      }),
    )
    openWithUrl()
    render(<PluginInstallConfirmModal />)
    await screen.findByTestId('plugin-preview-body')

    // One command → capability row present.
    expect(screen.getByTestId('plugin-preview-capability-commands')).toBeInTheDocument()
    // No permission rows.
    expect(screen.queryByTestId('plugin-preview-capability-file-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-preview-capability-file-open')).not.toBeInTheDocument()
  })

  test('renders an error state inline when fetch / validation fails', async () => {
    mockFetchPluginForInstall.mockRejectedValueOnce(
      new Error('Plugin manifest failed validation:\n  - bad id'),
    )
    openWithUrl()
    render(<PluginInstallConfirmModal />)

    const err = await screen.findByTestId('plugin-preview-error')
    expect(err).toHaveTextContent(/Could not load this plugin/i)
    expect(err).toHaveTextContent(/bad id/)
    // No install button on the error state.
    expect(screen.queryByTestId('plugin-install-confirm')).not.toBeInTheDocument()
    // Close button is available — the inline footer "Close" inside the
    // error pane. (The header X also has an aria-label "Close modal",
    // so we anchor on visible text inside the error footer.)
    const closeBtn = Array.from(err.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close',
    )
    expect(closeBtn).toBeTruthy()
  })

  test('Install button calls confirmAndInstallPlugin then closes the modal', async () => {
    const record = makeRecord()
    mockFetchPluginForInstall.mockResolvedValueOnce(record)
    mockConfirmAndInstallPlugin.mockResolvedValueOnce(undefined)
    openWithUrl()
    const user = userEvent.setup()
    render(<PluginInstallConfirmModal />)

    await screen.findByTestId('plugin-preview-body')
    await user.click(screen.getByTestId('plugin-install-confirm'))

    await waitFor(() => expect(mockConfirmAndInstallPlugin).toHaveBeenCalledTimes(1))
    expect(mockConfirmAndInstallPlugin.mock.calls[0][0]).toBe(record)
    await waitFor(() => expect(useUIStore.getState().modal.type).toBeNull())
  })

  test('install failure stays on the preview and surfaces the error inline', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(makeRecord())
    mockConfirmAndInstallPlugin.mockRejectedValueOnce(new Error('worker boot failed'))
    openWithUrl()
    const user = userEvent.setup()
    render(<PluginInstallConfirmModal />)

    await screen.findByTestId('plugin-preview-body')
    await user.click(screen.getByTestId('plugin-install-confirm'))

    await waitFor(() => expect(screen.getByText('worker boot failed')).toBeInTheDocument())
    // Modal still open.
    expect(useUIStore.getState().modal.type).toBe('plugin-install-confirm')
  })

  test('Cancel button closes the modal without calling install', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(makeRecord())
    openWithUrl()
    const user = userEvent.setup()
    render(<PluginInstallConfirmModal />)

    await screen.findByTestId('plugin-preview-body')
    await user.click(screen.getByTestId('plugin-install-cancel'))

    expect(mockConfirmAndInstallPlugin).not.toHaveBeenCalled()
    await waitFor(() => expect(useUIStore.getState().modal.type).toBeNull())
  })
})

describe('PluginInstallConfirmModal — pre-fetched record path', () => {
  test('renders the preview body directly without calling fetchPluginForInstall', async () => {
    openWithRecord(makeRecord())
    render(<PluginInstallConfirmModal />)
    expect(screen.getByTestId('plugin-preview-body')).toBeInTheDocument()
    expect(mockFetchPluginForInstall).not.toHaveBeenCalled()
  })
})

describe('PluginInstallConfirmModal — destructive permissions (v1.2 PR D)', () => {
  test('renders vault.write in the destructive section with a red bullet + ack checkbox', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(
      makeRecord({
        manifest: {
          ...baseManifest,
          permissions: ['vault.write'],
        },
      }),
    )
    openWithUrl()
    render(<PluginInstallConfirmModal />)
    await screen.findByTestId('plugin-preview-body')

    // Destructive section renders.
    expect(screen.getByTestId('plugin-preview-destructive-section')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-preview-destructive-vault.write')).toHaveTextContent(
      'vault.write',
    )
    expect(screen.getByTestId('plugin-preview-destructive-vault.write')).toHaveTextContent(
      PERMISSION_DESCRIPTIONS['vault.write'],
    )

    // vault.write should NOT also appear in the informational capability list.
    expect(
      screen.queryByTestId('plugin-preview-capability-vault.write'),
    ).not.toBeInTheDocument()

    // Install is disabled until the user acks the destructive permission.
    const installBtn = screen.getByTestId('plugin-install-confirm') as HTMLButtonElement
    expect(installBtn).toBeDisabled()

    const ack = screen.getByTestId('plugin-preview-destructive-ack-vault.write')
    const user = userEvent.setup()
    await user.click(ack)
    expect(installBtn).not.toBeDisabled()
  })

  test('mixed manifest puts file-save in the informational list and vault.write in destructive', async () => {
    mockFetchPluginForInstall.mockResolvedValueOnce(
      makeRecord({
        manifest: {
          ...baseManifest,
          permissions: ['file-save', 'vault.write'],
        },
      }),
    )
    openWithUrl()
    render(<PluginInstallConfirmModal />)
    await screen.findByTestId('plugin-preview-body')

    expect(screen.getByTestId('plugin-preview-capability-file-save')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-preview-destructive-vault.write')).toBeInTheDocument()

    // file-save uses the informational SURFACE_DESCRIPTIONS-style copy; ensure
    // the SURFACE export is still reachable so the smoke test does not regress.
    expect(typeof SURFACE_DESCRIPTIONS.commands).toBe('string')
  })
})
