/**
 * @jest-environment node
 *
 * Integration test for the week-2 command surface adapter.
 *
 * Plugin manifests landed via `usePluginStore.addReady` must surface
 * as `Command` entries in the palette, grouped under "Plugins". Running
 * the command must route through `getPluginHost().invokeCommand`.
 */

import { getAllCommands } from '@/utils/commands'
import { usePluginStore } from '@/stores/pluginStore'
import type { PluginManifest } from '@/plugins/manifest'

// Mock getPluginHost so we can assert invokeCommand was called without
// constructing a real Worker (which is jsdom-incompatible). The other
// tests in this repo all use relative paths for jest.mock — `@/` does
// not resolve cleanly through Jest's mock collector.
jest.mock('../../plugins/pluginHostSingleton', () => {
  const invokeSpy = jest.fn()
  return {
    getPluginHost: () => ({ invokeCommand: invokeSpy }),
    __invokeSpy: invokeSpy,
  }
})

const mockedHost = jest.requireMock('../../plugins/pluginHostSingleton') as {
  __invokeSpy: jest.Mock
}

const testManifest: PluginManifest = {
  id: 'echo',
  name: 'Echo plugin',
  version: '1.0.0',
  surfaces: {
    commands: [
      { id: 'say', title: 'Echo: say hello' },
      { id: 'shout', title: 'Echo: SHOUT', shortcut: 'Mod+Shift+E' },
    ],
  },
}

describe('plugin commands in the palette', () => {
  beforeEach(() => {
    usePluginStore.getState().clear()
    mockedHost.__invokeSpy.mockClear()
  })

  test('plugin commands appear in getAllCommands under the "Plugins" group', () => {
    usePluginStore.getState().addReady(testManifest)
    const cmds = getAllCommands()
    const plugins = cmds.filter((c) => c.group === 'Plugins')
    expect(plugins).toHaveLength(2)
    expect(plugins.map((c) => c.id).sort()).toEqual([
      'plugin.echo.say',
      'plugin.echo.shout',
    ])
  })

  test('command title comes straight from the manifest', () => {
    usePluginStore.getState().addReady(testManifest)
    const cmds = getAllCommands()
    const say = cmds.find((c) => c.id === 'plugin.echo.say')
    expect(say?.label).toBe('Echo: say hello')
  })

  test('command shortcut is surfaced as `combo`', () => {
    usePluginStore.getState().addReady(testManifest)
    const cmds = getAllCommands()
    const shout = cmds.find((c) => c.id === 'plugin.echo.shout')
    expect(shout?.combo).toBe('Mod+Shift+E')
  })

  test('description references the plugin name', () => {
    usePluginStore.getState().addReady(testManifest)
    const cmds = getAllCommands()
    const say = cmds.find((c) => c.id === 'plugin.echo.say')
    expect(say?.description).toContain('Echo plugin')
  })

  test('running the command calls host.invokeCommand with the right ids', () => {
    usePluginStore.getState().addReady(testManifest)
    const say = getAllCommands().find((c) => c.id === 'plugin.echo.say')
    say?.run()
    expect(mockedHost.__invokeSpy).toHaveBeenCalledWith('echo', 'say')
  })

  test('no plugin loaded → no Plugins-group commands', () => {
    const cmds = getAllCommands()
    expect(cmds.filter((c) => c.group === 'Plugins')).toHaveLength(0)
  })

  test('two plugins shipping the same local command id stay distinct', () => {
    usePluginStore.getState().addReady(testManifest)
    usePluginStore.getState().addReady({
      id: 'other',
      name: 'Other plugin',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'say', title: 'Other: say hi' }] },
    })
    const cmds = getAllCommands()
    const sayLikes = cmds.filter((c) => c.id.startsWith('plugin.') && c.id.endsWith('.say'))
    expect(sayLikes.map((c) => c.id).sort()).toEqual([
      'plugin.echo.say',
      'plugin.other.say',
    ])
  })
})
