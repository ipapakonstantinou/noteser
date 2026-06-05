'use client'

// Settings → Plugins.
//
// Lists every installed plugin (toggle / uninstall), and accepts a
// new plugin via URL paste. The paste flow:
//   1. User types/pastes a manifest.json URL
//   2. We click "Add" — calls installPluginFromUrl which fetches,
//      validates, stores, and boots the plugin
//   3. Errors surface as inline text + the existing toast system
//
// This is the v1 install surface. Vault-folder scan
// (.noteser/plugins/) lands in a follow-up.

import { useState } from 'react'
import { ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline'
import { usePluginInstallStore } from '@/stores/pluginInstallStore'
import { usePluginStore } from '@/stores/pluginStore'
import { useUIStore } from '@/stores'
import { uninstallPlugin } from '@/plugins/pluginHostSingleton'

export const PluginsSettingsPanel = () => {
  const records = usePluginInstallStore((s) => s.records)
  const setEnabled = usePluginInstallStore((s) => s.setEnabled)
  const loadedPlugins = usePluginStore((s) => s.loaded)
  const openModal = useUIStore((s) => s.openModal)

  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleAdd = () => {
    setError(null)
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Paste a manifest.json URL.')
      return
    }
    openModal({ type: 'plugin-install-confirm', data: { manifestUrl: trimmed } })
    setUrl('')
  }

  const handleUninstall = (pluginId: string) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Uninstall "${pluginId}"? Its data on noteser stays; only the plugin code is removed.`)
      if (!ok) return
    }
    uninstallPlugin(pluginId)
  }

  const recordList = Object.values(records).sort((a, b) => a.addedAt - b.addedAt)

  return (
    <div className="space-y-6">
      <header>
        <h3 className="text-base font-medium text-obsidianText border-b border-obsidianBorder pb-2 mb-3">
          Plugins
        </h3>
        <p className="text-xs text-obsidianSecondaryText">
          v1: load a plugin from any HTTPS URL that serves a manifest.json. The plugin code runs in a Web Worker sandbox.
        </p>
      </header>

      <section>
        <div className="text-sm text-obsidianText mb-1">Add a plugin</div>
        <p className="text-xs text-obsidianSecondaryText mb-2">
          Paste the URL of the plugin&apos;s manifest.json (e.g.{' '}
          <code className="text-[11px] bg-obsidianHighlight/40 px-1 rounded">https://example.com/my-plugin/manifest.json</code>
          ).
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/manifest.json"
            className="flex-1 appearance-none px-3 py-2 rounded-md border border-obsidianBorder bg-obsidianBlack/40 text-sm text-obsidianText placeholder:text-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="px-4 py-2 rounded-md bg-obsidianAccentPurple/80 hover:bg-obsidianAccentPurple text-white text-sm font-medium"
            data-testid="settings-plugins-add"
          >
            Add
          </button>
        </div>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
      </section>

      <section>
        <div className="text-sm text-obsidianText mb-3">Installed</div>
        {recordList.length === 0 ? (
          <p className="text-xs text-obsidianSecondaryText">
            Nothing installed yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y divide-obsidianBorder rounded-lg border border-obsidianBorder">
            {recordList.map((r) => {
              const m = r.manifest
              const running = m.id in loadedPlugins
              return (
                <li key={m.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-obsidianText">{m.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
                        v{m.version}
                      </span>
                      {running ? (
                        <span className="text-[10px] uppercase tracking-wide text-emerald-300">
                          running
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
                          stopped
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-obsidianSecondaryText mt-0.5">
                      <code className="text-[11px] bg-obsidianHighlight/40 px-1 rounded">{m.id}</code>
                      {m.author && <span> · by {m.author}</span>}
                    </div>
                    <div className="text-[11px] text-obsidianSecondaryText/80 mt-1 truncate">
                      from {r.sourceUrl}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <label className="flex items-center gap-1 text-xs text-obsidianText cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => setEnabled(m.id, e.target.checked)}
                      />
                      Enabled
                    </label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        title="Reload page to re-boot the plugin"
                        className="p-1 rounded hover:bg-obsidianHighlight/40 text-obsidianSecondaryText hover:text-obsidianText"
                      >
                        <ArrowPathIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUninstall(m.id)}
                        title="Uninstall"
                        className="p-1 rounded hover:bg-obsidianHighlight/40 text-obsidianSecondaryText hover:text-red-300"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="text-xs text-obsidianSecondaryText border-t border-obsidianBorder pt-4">
        Plugins run in an isolated Web Worker and only have access to the
        capabilities the host exposes. They cannot read your GitHub token
        or the contents of notes other than the active one. Toggle off if a
        plugin misbehaves; uninstall if you no longer want it. Toggling
        on / off requires a page reload.
      </section>
    </div>
  )
}
