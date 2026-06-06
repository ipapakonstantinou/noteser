/**
 * @jest-environment jsdom
 *
 * Coverage for the v1.2 `setPermissionRevoked` action on
 * usePluginInstallStore. The host re-checks revocation per-dispatch,
 * so the store API needs to be idempotent + must not lose unrelated
 * record fields when the user toggles a permission.
 */

import { usePluginInstallStore, type InstalledPluginRecord } from '@/stores/pluginInstallStore'

beforeEach(() => {
  usePluginInstallStore.setState({ records: {} })
})

function record(): InstalledPluginRecord {
  return {
    manifest: {
      id: 'evt',
      name: 'Evt',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.events', 'file-open'],
    },
    mainSource: '/* */',
    hash: 'deadbeef',
    sourceUrl: 'https://example.com/manifest.json',
    addedAt: 0,
    enabled: true,
  }
}

describe('setPermissionRevoked', () => {
  test('revokes a permission without unloading the plugin', () => {
    usePluginInstallStore.getState().install(record())
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'vault.events', true)
    expect(
      usePluginInstallStore.getState().records['evt'].revokedPermissions,
    ).toEqual(['vault.events'])
    expect(usePluginInstallStore.getState().records['evt'].enabled).toBe(true)
  })

  test('idempotent — toggling the same value twice does not duplicate', () => {
    usePluginInstallStore.getState().install(record())
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'vault.events', true)
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'vault.events', true)
    expect(
      usePluginInstallStore.getState().records['evt'].revokedPermissions,
    ).toEqual(['vault.events'])
  })

  test('toggling back to granted removes the entry', () => {
    usePluginInstallStore.getState().install(record())
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'vault.events', true)
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'vault.events', false)
    // PR C's spec: keep the field as an array (possibly empty) so the
    // record shape stays stable across grant flips.
    expect(
      usePluginInstallStore.getState().records['evt'].revokedPermissions,
    ).toEqual([])
  })

  test('no-op for unknown plugin id', () => {
    expect(() =>
      usePluginInstallStore
        .getState()
        .setPermissionRevoked('does-not-exist', 'vault.events', true),
    ).not.toThrow()
    expect(usePluginInstallStore.getState().records).toEqual({})
  })

  test('multiple revocations on the same plugin track every entry', () => {
    usePluginInstallStore.getState().install(record())
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'vault.events', true)
    usePluginInstallStore.getState().setPermissionRevoked('evt', 'file-open', true)
    const revoked = usePluginInstallStore.getState().records['evt']
      .revokedPermissions
    expect(revoked).toEqual(expect.arrayContaining(['vault.events', 'file-open']))
    expect(revoked).toHaveLength(2)
  })
})
