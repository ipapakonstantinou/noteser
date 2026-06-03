'use client'

// Confirmation modal for installing a plugin from a manifest URL.
// Shown after the manifest + bundle have been fetched and validated,
// before they are persisted or the worker is booted.
//
// Surfaces:
//   - Plugin id, name, version, author
//   - Source URL the bundle was fetched from
//   - Surfaces declared (commands, panels, code-block renderers)
//   - Capability PERMISSIONS the plugin asks for, with the
//     human-readable description from PERMISSION_DESCRIPTIONS
//   - Install / Cancel buttons
//
// The user grants ALL declared permissions or none — v1.1 keeps this
// coarse-grained to match Apple/Android app-install ergonomics. v2
// may add per-permission toggles if the use case warrants.

import { useState } from 'react'
import { CheckCircleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore } from '@/stores'
import { confirmAndInstallPlugin } from '@/plugins/pluginHostSingleton'
import { PERMISSION_DESCRIPTIONS, type PluginPermission } from '@/plugins/manifest'
import type { InstalledPluginRecord } from '@/stores/pluginInstallStore'

export const PluginInstallConfirmModal = () => {
  const { modal, closeModal } = useUIStore()
  const isOpen = modal.type === 'plugin-install-confirm'
  const record = (modal.data?.record as InstalledPluginRecord | undefined) ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen || !record) return null

  const { manifest } = record
  const surfaces = manifest.surfaces
  const surfaceLines: string[] = []
  if (surfaces.commands && surfaces.commands.length > 0) {
    surfaceLines.push(`${surfaces.commands.length} command(s) in the palette`)
  }
  if (surfaces.sidebarPanels && surfaces.sidebarPanels.length > 0) {
    surfaceLines.push(`${surfaces.sidebarPanels.length} sidebar panel(s)`)
  }
  if (surfaces.codeBlockRenderers && surfaces.codeBlockRenderers.length > 0) {
    const langs = surfaces.codeBlockRenderers.map((r) => `\`\`\`${r.language}`).join(', ')
    surfaceLines.push(`code-block renderer(s) for ${langs}`)
  }

  const permissions: PluginPermission[] = manifest.permissions ?? []

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await confirmAndInstallPlugin(record)
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={() => (busy ? undefined : closeModal())} title="Install plugin?">
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-obsidianText">{manifest.name}</span>
            <span className="text-xs text-obsidianSecondaryText">v{manifest.version}</span>
          </div>
          <div className="text-xs text-obsidianSecondaryText mt-0.5">
            <code className="text-[11px] bg-obsidianHighlight/40 px-1 rounded">{manifest.id}</code>
            {manifest.author && <span> · by {manifest.author}</span>}
          </div>
          <div className="text-[11px] text-obsidianSecondaryText/80 mt-1 break-all">
            from {record.sourceUrl}
          </div>
        </div>

        {surfaceLines.length > 0 && (
          <section>
            <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1">
              Adds to Noteser
            </div>
            <ul className="text-sm text-obsidianText space-y-1 list-disc list-inside">
              {surfaceLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1 flex items-center gap-1">
            <ShieldCheckIcon className="w-3 h-3" />
            Permissions
          </div>
          {permissions.length === 0 ? (
            <p className="text-sm text-obsidianText">
              None. This plugin runs in a sandboxed Web Worker with no DOM, no GitHub token, and no
              access to other notes&apos; bodies.
            </p>
          ) : (
            <ul className="space-y-2">
              {permissions.map((perm) => (
                <li key={perm} className="flex items-start gap-2 text-sm">
                  <CheckCircleIcon className="w-4 h-4 mt-0.5 text-amber-400 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-obsidianText">{perm}</span>
                    <div className="text-xs text-obsidianSecondaryText mt-0.5">
                      {PERMISSION_DESCRIPTIONS[perm]}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <div className="text-xs text-red-300">{error}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
          <Button variant="ghost" onClick={() => closeModal()} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={busy} data-testid="plugin-install-confirm">
            {busy ? 'Installing…' : 'Install'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
