/**
 * @jest-environment jsdom
 *
 * Plugin v1.2 PR E — Settings → Plugins revocation of
 * `fs.open-directory`. The store action + UI wiring landed in PR C;
 * this suite covers the `fs.open-directory` arm of the same plumbing
 * so we can prove the revocation path works for the new permission.
 *
 * See docs/plugins-v1.2-plan.md section 4.3 and the impl notes for
 * PR E.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import {
  usePluginInstallStore,
  type InstalledPluginRecord,
} from '@/stores/pluginInstallStore'

function makeRecord(
  overrides: Partial<InstalledPluginRecord> = {},
): InstalledPluginRecord {
  return {
    manifest: {
      id: 'folder-demo',
      name: 'Folder demo',
      version: '0.1.0',
      surfaces: { commands: [{ id: 'pick', title: 'Pick' }] },
      permissions: ['fs.open-directory'],
    },
    mainSource: 'export default {}',
    hash: 'abc',
    sourceUrl: 'https://example.com/folder-demo/manifest.json',
    addedAt: 1000,
    enabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  usePluginInstallStore.setState({ records: {} })
})

describe('pluginInstallStore — fs.open-directory revocation', () => {
  test('setPermissionRevoked(true) appends to revokedPermissions', () => {
    const rec = makeRecord()
    usePluginInstallStore.getState().install(rec)
    usePluginInstallStore
      .getState()
      .setPermissionRevoked(rec.manifest.id, 'fs.open-directory', true)
    const next = usePluginInstallStore.getState().records[rec.manifest.id]
    expect(next.revokedPermissions).toEqual(['fs.open-directory'])
  })

  test('setPermissionRevoked(false) clears the permission from the revoked list', () => {
    const rec = makeRecord({ revokedPermissions: ['fs.open-directory'] })
    usePluginInstallStore.getState().install(rec)
    usePluginInstallStore
      .getState()
      .setPermissionRevoked(rec.manifest.id, 'fs.open-directory', false)
    const next = usePluginInstallStore.getState().records[rec.manifest.id]
    expect(next.revokedPermissions).toEqual([])
  })

  test('setPermissionRevoked is a no-op when the state already matches', () => {
    const rec = makeRecord({ revokedPermissions: ['fs.open-directory'] })
    usePluginInstallStore.getState().install(rec)
    const before = usePluginInstallStore.getState().records[rec.manifest.id]
    usePluginInstallStore
      .getState()
      .setPermissionRevoked(rec.manifest.id, 'fs.open-directory', true)
    const after = usePluginInstallStore.getState().records[rec.manifest.id]
    // The store early-returns when the value did not change; the
    // record reference is preserved.
    expect(after).toBe(before)
  })

  test('setPermissionRevoked is a no-op for an unknown plugin id', () => {
    const before = { ...usePluginInstallStore.getState().records }
    usePluginInstallStore
      .getState()
      .setPermissionRevoked('no-such-plugin', 'fs.open-directory', true)
    expect(usePluginInstallStore.getState().records).toEqual(before)
  })

  test('toggling the same permission twice ends up at the original state', () => {
    const rec = makeRecord()
    usePluginInstallStore.getState().install(rec)
    usePluginInstallStore
      .getState()
      .setPermissionRevoked(rec.manifest.id, 'fs.open-directory', true)
    usePluginInstallStore
      .getState()
      .setPermissionRevoked(rec.manifest.id, 'fs.open-directory', false)
    const next = usePluginInstallStore.getState().records[rec.manifest.id]
    expect(next.revokedPermissions).toEqual([])
  })
})
