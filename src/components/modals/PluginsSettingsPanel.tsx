'use client'

// Settings → Plugins.
//
// Lists every installed plugin (toggle / uninstall), and accepts a
// new plugin via URL paste or by scanning the vault for in-vault
// manifest.json notes. Both paths hand the assembled
// InstalledPluginRecord to the existing plugin-install-confirm modal
// so the user sees the same preview + permissions screen.

import { useMemo, useState } from 'react'
import { ArrowPathIcon, ShieldExclamationIcon, TrashIcon } from '@heroicons/react/24/outline'
import { usePluginInstallStore } from '@/stores/pluginInstallStore'
import { usePluginStore } from '@/stores/pluginStore'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useUIStore } from '@/stores'
import {
  fetchPluginForInstallFromVault,
  setPluginPermissionRevoked,
  uninstallPlugin,
} from '@/plugins/pluginHostSingleton'
import { scanVaultForManifests, type VaultManifestCandidate } from '@/plugins/vaultScan'
import {
  isDestructivePermission,
  PERMISSION_DESCRIPTIONS,
  type PluginPermission,
} from '@/plugins/manifest'
import { readPluginAudit, type PluginAuditEntry } from '@/utils/pluginAudit'

export const PluginsSettingsPanel = () => {
  const records = usePluginInstallStore((s) => s.records)
  const setEnabled = usePluginInstallStore((s) => s.setEnabled)
  const loadedPlugins = usePluginStore((s) => s.loaded)
  const openModal = useUIStore((s) => s.openModal)

  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [scanState, setScanState] = useState<
    | { kind: 'idle' }
    | { kind: 'scanning' }
    | { kind: 'done'; candidates: VaultManifestCandidate[]; skipped: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const [installingNoteId, setInstallingNoteId] = useState<string | null>(null)

  const handleAdd = async () => {
    setError(null)
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Paste a manifest.json URL.')
      return
    }
    openModal({ type: 'plugin-install-confirm', data: { manifestUrl: trimmed } })
    setUrl('')
  }

  const handleScan = () => {
    setScanState({ kind: 'scanning' })
    try {
      const notes = useNoteStore.getState().notes
      const folders = useFolderStore.getState().folders
      const result = scanVaultForManifests(notes, folders)
      setScanState({ kind: 'done', candidates: result.candidates, skipped: result.skipped })
    } catch (err) {
      setScanState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleInstallFromVault = async (candidate: VaultManifestCandidate) => {
    setInstallingNoteId(candidate.noteId)
    try {
      const record = await fetchPluginForInstallFromVault(candidate)
      openModal({ type: 'plugin-install-confirm', data: { record } })
    } catch (err) {
      setScanState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setInstallingNoteId(null)
    }
  }

  const handleUninstall = (pluginId: string) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Uninstall "${pluginId}"? Its data on noteser stays; only the plugin code is removed.`)
      if (!ok) return
    }
    uninstallPlugin(pluginId)
  }

  // Sort once per `records` mutation rather than on every keystroke
  // elsewhere. Object.values returns a fresh array each call so .sort
  // is a real cost on every render without this.
  const recordList = useMemo(
    () => Object.values(records).sort((a, b) => a.addedAt - b.addedAt),
    [records],
  )

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
        <div className="text-sm text-obsidianText mb-1">Scan vault for plugins</div>
        <p className="text-xs text-obsidianSecondaryText mb-2">
          Look through your vault for notes titled <code className="text-[11px] bg-obsidianHighlight/40 px-1 rounded">manifest.json</code> that declare a plugin. Each match shows up below with an Install button.
        </p>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanState.kind === 'scanning'}
          className="px-3 py-1.5 rounded-md border border-obsidianBorder bg-obsidianBlack/40 hover:bg-obsidianHighlight/40 text-sm text-obsidianText disabled:opacity-60"
          data-testid="settings-plugins-scan"
        >
          {scanState.kind === 'scanning' ? 'Scanning…' : 'Scan vault for plugins'}
        </button>

        {scanState.kind === 'error' && (
          <p className="text-xs text-red-300 mt-2" data-testid="settings-plugins-scan-error">
            Could not read vault: {scanState.message}
          </p>
        )}

        {scanState.kind === 'done' && scanState.candidates.length === 0 && (
          <p className="text-xs text-obsidianSecondaryText mt-2" data-testid="settings-plugins-scan-empty">
            No plugin manifests found in this vault.
            {scanState.skipped > 0 && ` Skipped ${scanState.skipped} note(s) titled manifest.json that did not match the plugin schema.`}
          </p>
        )}

        {scanState.kind === 'done' && scanState.candidates.length > 0 && (
          <ul
            className="mt-2 divide-y divide-obsidianBorder rounded-lg border border-obsidianBorder"
            data-testid="settings-plugins-scan-results"
          >
            {scanState.candidates.map((c) => (
              <li key={c.noteId} className="p-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-obsidianText">{c.manifest.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
                      v{c.manifest.version}
                    </span>
                  </div>
                  <div className="text-xs text-obsidianSecondaryText mt-0.5">
                    <code className="text-[11px] bg-obsidianHighlight/40 px-1 rounded">{c.manifest.id}</code>
                    {c.manifest.author && <span> · by {c.manifest.author}</span>}
                  </div>
                  <div className="text-[11px] text-obsidianSecondaryText/80 mt-1 truncate">
                    {c.pathInVault}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleInstallFromVault(c)}
                  disabled={installingNoteId !== null}
                  className="px-3 py-1.5 rounded-md bg-obsidianAccentPurple/80 hover:bg-obsidianAccentPurple text-white text-xs font-medium disabled:opacity-60"
                  data-testid={`settings-plugins-scan-install-${c.manifest.id}`}
                >
                  {installingNoteId === c.noteId ? 'Preparing…' : 'Install'}
                </button>
              </li>
            ))}
          </ul>
        )}
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
              const declaredPermissions: PluginPermission[] = m.permissions ?? []
              const revoked = new Set<PluginPermission>(r.revokedPermissions ?? [])
              const grantedDestructive = declaredPermissions.filter(isDestructivePermission)
              return (
                <li
                  key={m.id}
                  className="p-3 flex flex-col gap-2"
                  data-testid={`settings-plugins-row-${m.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
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
                        {/* PR D: destructive-permission badge. Persists for
                            as long as the destructive permission stays
                            declared in the manifest — even after the user
                            revokes it from the toggle row below. The
                            user always sees at a glance which plugins
                            were granted dangerous capabilities. */}
                        {grantedDestructive.length > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-red-300 bg-red-500/10 border border-red-500/40 px-1.5 py-0.5 rounded"
                            title={grantedDestructive
                              .map((p) => PERMISSION_DESCRIPTIONS[p])
                              .join(' ')}
                            data-testid={`settings-plugins-destructive-badge-${m.id}`}
                          >
                            <ShieldExclamationIcon className="w-3 h-3" />
                            Destructive
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
                  </div>
                  {declaredPermissions.length > 0 && (
                    <div
                      className="border-t border-obsidianBorder pt-2 mt-1 space-y-2"
                      data-testid={`settings-plugins-permissions-${m.id}`}
                    >
                      <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
                        Permissions
                      </div>
                      {declaredPermissions.map((perm) => {
                        const destructive = isDestructivePermission(perm)
                        return (
                          <label
                            key={perm}
                            className={`flex items-start gap-2 text-xs cursor-pointer ${
                              destructive ? 'text-red-200' : 'text-obsidianText'
                            }`}
                            data-testid={`settings-plugins-permission-${m.id}-${perm}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={!revoked.has(perm)}
                              onChange={(e) =>
                                setPluginPermissionRevoked(m.id, perm, !e.target.checked)
                              }
                            />
                            <span className="flex-1">
                              <span className="font-medium">{perm}</span>
                              <span className="block text-[11px] text-obsidianSecondaryText/80 mt-0.5">
                                {PERMISSION_DESCRIPTIONS[perm]}
                              </span>
                              {revoked.has(perm) && (
                                <span className="block text-[11px] text-amber-300 mt-0.5">
                                  Revoked — the plugin&apos;s next call to this capability will be rejected.
                                </span>
                              )}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <PluginAuditPanel />

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

const PluginAuditPanel = () => {
  // The audit log is a localStorage-backed ring buffer. We snapshot on
  // mount + on every Refresh click — no live subscription, because the
  // log is append-only and the Settings modal is short-lived.
  const [entries, setEntries] = useState<ReadonlyArray<PluginAuditEntry>>(() => readPluginAudit())
  const refresh = () => setEntries(readPluginAudit())
  // Newest first for the table; original buffer is oldest-first.
  const newestFirst = useMemo(() => entries.slice().reverse(), [entries])
  return (
    <section data-testid="settings-plugins-audit">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-obsidianText">Plugin activity</div>
        <button
          type="button"
          onClick={refresh}
          className="text-[11px] text-obsidianSecondaryText hover:text-obsidianText"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-obsidianSecondaryText mb-2">
        Every vault change made by a plugin lands here so you can trace
        unexpected edits. Up to 500 entries are kept locally.
      </p>
      {newestFirst.length === 0 ? (
        <p
          className="text-xs text-obsidianSecondaryText"
          data-testid="settings-plugins-audit-empty"
        >
          No plugin activity yet.
        </p>
      ) : (
        <ul className="divide-y divide-obsidianBorder rounded-lg border border-obsidianBorder max-h-48 overflow-y-auto">
          {newestFirst.slice(0, 50).map((e) => (
            <li
              key={`${e.ts}-${e.pluginId}-${e.op}-${e.target}`}
              className="p-2 text-[11px] flex items-start gap-2"
              data-testid="settings-plugins-audit-entry"
            >
              <span className="text-obsidianSecondaryText whitespace-nowrap">
                {new Date(e.ts).toLocaleString()}
              </span>
              <span className="text-obsidianText">
                <code className="text-[10px] bg-obsidianHighlight/40 px-1 rounded">
                  {e.pluginId}
                </code>{' '}
                <span
                  className={
                    e.op === 'delete' ? 'text-red-300 font-medium' : 'text-amber-300 font-medium'
                  }
                >
                  {e.op}
                </span>{' '}
                <span className="text-obsidianSecondaryText break-all">{e.target}</span>
                {e.conflictResolved === 'suffix' && (
                  <span className="text-[10px] uppercase ml-1 text-amber-300">renamed</span>
                )}
                {e.ok === false && (
                  <span className="text-[10px] uppercase ml-1 text-red-300">failed</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
