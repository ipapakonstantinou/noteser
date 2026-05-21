'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal, Button } from '@/components/ui'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useUIStore, useSettingsStore } from '@/stores'
import { VAULT_SETTING_KEYS, type VaultSettingKey } from '@/stores/settingsStore'

// vs8x-conflict — key-by-key merge UI for vault settings drift.
//
// Opens when pullFromGitHub detects that BOTH local and remote have
// diverged from the last common state. The user picks a winning
// value per differing key; clicking Apply writes the chosen blend
// into the local store + sets vaultSettingsUpdatedAt to a fresh
// timestamp so the next push uploads the resolution.

interface ConflictData {
  remoteUpdatedAt: number
  remoteHash: string
  remoteVault: Record<string, unknown>
  localVault: Record<string, unknown>
  diffKeys: string[]
}

type Choice = 'local' | 'remote'

export const VaultSettingsConflictModal = () => {
  const { modal, closeModal } = useUIStore()
  const isOpen = modal.type === 'vault-settings-conflict'
  // Only treat modal.data as conflict-shaped when THIS modal is the one
  // open. `modal.data` is shared across every modal kind, so a delete-
  // confirm or templates open puts a totally different shape in there —
  // accessing data.diffKeys without this gate throws "not iterable" and
  // the dev overlay then traps all clicks. (Caught by qa-tester sweep.)
  const data: ConflictData | undefined = isOpen
    ? (modal.data as ConflictData | undefined)
    : undefined

  const [choices, setChoices] = useState<Record<string, Choice>>({})

  // Reset selections each time a conflict opens so a previous resolution
  // doesn't leak into a new one.
  useEffect(() => {
    if (!isOpen || !data) return
    const initial: Record<string, Choice> = {}
    for (const k of data.diffKeys) initial[k] = 'remote'
    setChoices(initial)
  }, [isOpen, data])

  const summary = useMemo(() => {
    if (!data || !Array.isArray(data.diffKeys)) return { local: 0, remote: 0 }
    let local = 0
    let remote = 0
    for (const k of data.diffKeys) {
      if (choices[k] === 'local') local++
      else remote++
    }
    return { local, remote }
  }, [choices, data])

  if (!isOpen || !data) return null

  const handleApply = () => {
    // Build the merged vault slice: every diffKey takes the chosen
    // side; every non-conflicting key takes whatever's in local (no
    // change). Then call applyRemoteVaultSettings with a fresh hash
    // recomputed by the caller AFTER setState lands — for simplicity
    // we just hand it the resolved object + a now() timestamp and let
    // the next push compute the hash organically.
    const merged: Record<string, unknown> = { ...data.localVault }
    for (const k of data.diffKeys) {
      const side = choices[k] || 'remote'
      merged[k] = side === 'local' ? data.localVault[k] : data.remoteVault[k]
    }
    // Filter to known vault keys (defensive against a stale payload).
    const allowed = new Set<string>(VAULT_SETTING_KEYS as readonly string[])
    const safe: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(merged)) {
      if (allowed.has(k)) safe[k] = v
    }
    // Apply with a fresh updatedAt so the next push uploads this
    // resolution. lastPushedHash deliberately set to '' so the push
    // step recomputes + uploads (this resolution IS the new state).
    useSettingsStore.getState().applyRemoteVaultSettings(
      safe as Partial<ReturnType<typeof useSettingsStore.getState>>,
      Date.now(),
      '',
    )
    closeModal()
  }

  const handleTakeAll = (side: Choice) => {
    const next: Record<string, Choice> = {}
    for (const k of data.diffKeys) next[k] = side
    setChoices(next)
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="xl">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500 flex-none mt-0.5" />
          <div>
            <h3 className="text-lg font-medium text-obsidianText">Settings drift detected</h3>
            <p className="text-xs text-obsidianSecondaryText mt-1">
              Both this device and the remote have changed settings since the last sync.
              Pick which side wins for each differing field. Non-conflicting fields
              are kept as they are.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => handleTakeAll('local')}
            className="px-2 py-1 rounded border border-obsidianBorder text-obsidianText hover:bg-obsidianHighlight/40"
            data-testid="vs8x-conflict-take-all-local"
          >
            Take all local
          </button>
          <button
            type="button"
            onClick={() => handleTakeAll('remote')}
            className="px-2 py-1 rounded border border-obsidianBorder text-obsidianText hover:bg-obsidianHighlight/40"
            data-testid="vs8x-conflict-take-all-remote"
          >
            Take all remote
          </button>
          <span className="ml-auto text-obsidianSecondaryText">
            Picked: {summary.local} local · {summary.remote} remote
          </span>
        </div>

        <div className="max-h-[55vh] overflow-y-auto border border-obsidianBorder rounded">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-obsidianGray text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
              <tr>
                <th className="text-left px-3 py-2">Key</th>
                <th className="text-left px-3 py-2">Local</th>
                <th className="text-left px-3 py-2">Remote</th>
              </tr>
            </thead>
            <tbody>
              {data.diffKeys.map(key => {
                const choice = choices[key] ?? 'remote'
                return (
                  <tr key={key} className="border-t border-obsidianBorder" data-testid={`vs8x-conflict-row-${key}`}>
                    <td className="px-3 py-2 text-obsidianText font-mono text-xs align-top">
                      {key}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`choice-${key}`}
                          checked={choice === 'local'}
                          onChange={() => setChoices(prev => ({ ...prev, [key]: 'local' }))}
                          className="mt-1 accent-obsidianAccentPurple"
                          data-testid={`vs8x-conflict-${key}-local`}
                        />
                        <code className="text-xs text-obsidianText break-all">
                          {formatValue(data.localVault[key])}
                        </code>
                      </label>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`choice-${key}`}
                          checked={choice === 'remote'}
                          onChange={() => setChoices(prev => ({ ...prev, [key]: 'remote' }))}
                          className="mt-1 accent-obsidianAccentPurple"
                          data-testid={`vs8x-conflict-${key}-remote`}
                        />
                        <code className="text-xs text-obsidianText break-all">
                          {formatValue(data.remoteVault[key])}
                        </code>
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-obsidianBorder">
          <Button variant="secondary" onClick={closeModal}>
            Cancel (keep current local)
          </Button>
          <Button variant="primary" onClick={handleApply} data-testid="vs8x-conflict-apply">
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// JSON.stringify with a generous string fallback for primitives, so
// the diff table reads naturally for both scalars and objects.
function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

export default VaultSettingsConflictModal
