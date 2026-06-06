'use client'

// Manifest-preview modal for the plugin install flow.
//
// Two entry shapes via modal.data:
//   { manifestUrl: string }           — modal fetches + validates inline
//   { record: InstalledPluginRecord } — modal renders a pre-fetched record
//
// Three render states share the same modal shell so a failed fetch /
// invalid manifest surfaces inline instead of silently bouncing back to
// the Plugins panel:
//   - loading: spinner while fetching/validating
//   - error:   the error message, Close button only
//   - preview: name, version, author, description, homepage,
//              capabilities (surfaces + permissions) with prose,
//              Install / Cancel buttons
//
// Capability prose comes from SURFACE_DESCRIPTIONS / PERMISSION_DESCRIPTIONS
// in src/plugins/manifest.ts — do not invent new strings here.

import { useEffect, useRef, useState } from 'react'
import { CheckCircleIcon, ShieldCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore } from '@/stores'
import {
  confirmAndInstallPlugin,
  fetchPluginForInstall,
} from '@/plugins/pluginHostSingleton'
import {
  PERMISSION_DESCRIPTIONS,
  SURFACE_DESCRIPTIONS,
  type PluginPermission,
  type PluginSurfaceKind,
} from '@/plugins/manifest'
import type { InstalledPluginRecord } from '@/stores/pluginInstallStore'

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'preview'; record: InstalledPluginRecord }

interface CapabilityRow {
  key: string
  label: string
  description: string
}

export const PluginInstallConfirmModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const isOpen = modal.type === 'plugin-install-confirm'
  const data = modal.data ?? {}
  const initialRecord = (data.record as InstalledPluginRecord | undefined) ?? null
  const manifestUrl = typeof data.manifestUrl === 'string' ? data.manifestUrl : null

  const [state, setState] = useState<PreviewState>(() =>
    initialRecord
      ? { status: 'preview', record: initialRecord }
      : manifestUrl
        ? { status: 'loading' }
        : { status: 'error', message: 'No plugin URL or manifest provided.' },
  )
  const [busy, setBusy] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const fetchKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      fetchKeyRef.current = null
      setBusy(false)
      setInstallError(null)
      return
    }
    if (initialRecord) {
      setState({ status: 'preview', record: initialRecord })
      return
    }
    if (!manifestUrl) {
      setState({ status: 'error', message: 'No plugin URL or manifest provided.' })
      return
    }
    if (fetchKeyRef.current === manifestUrl) return
    fetchKeyRef.current = manifestUrl
    setState({ status: 'loading' })
    let cancelled = false
    void (async () => {
      try {
        const record = await fetchPluginForInstall(manifestUrl)
        if (cancelled) return
        setState({ status: 'preview', record })
      } catch (err) {
        if (cancelled) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, manifestUrl, initialRecord])

  if (!isOpen) return null

  const handleClose = () => {
    if (busy) return
    closeModal()
  }

  const handleConfirm = async () => {
    if (state.status !== 'preview') return
    setBusy(true)
    setInstallError(null)
    try {
      await confirmAndInstallPlugin(state.record)
      closeModal()
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Install plugin?">
      {state.status === 'loading' && (
        <div className="py-8 flex flex-col items-center justify-center gap-2" data-testid="plugin-preview-loading">
          <svg
            className="animate-spin h-5 w-5 text-obsidianAccentPurple"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-xs text-obsidianSecondaryText">Fetching plugin manifest…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="space-y-4" data-testid="plugin-preview-error">
          <div className="flex items-start gap-2 text-sm text-red-300">
            <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">Could not load this plugin.</div>
              <div className="text-xs text-red-300/80 mt-1 whitespace-pre-wrap break-words">
                {state.message}
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-obsidianBorder">
            <Button variant="ghost" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {state.status === 'preview' && (
        <PreviewBody
          record={state.record}
          busy={busy}
          installError={installError}
          onCancel={handleClose}
          onInstall={handleConfirm}
        />
      )}
    </Modal>
  )
}

interface PreviewBodyProps {
  record: InstalledPluginRecord
  busy: boolean
  installError: string | null
  onCancel: () => void
  onInstall: () => void
}

const PreviewBody = ({ record, busy, installError, onCancel, onInstall }: PreviewBodyProps) => {
  const { manifest } = record
  const surfaceRows = buildSurfaceRows(manifest.surfaces)
  const permissions: PluginPermission[] = manifest.permissions ?? []

  return (
    <div className="space-y-4" data-testid="plugin-preview-body">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold text-obsidianText">{manifest.name}</span>
          <span className="text-xs text-obsidianSecondaryText">v{manifest.version}</span>
        </div>
        <div className="text-xs text-obsidianSecondaryText mt-0.5">
          <code className="text-[11px] bg-obsidianHighlight/40 px-1 rounded">{manifest.id}</code>
          {manifest.author && <span> · by {manifest.author}</span>}
        </div>
        {manifest.homepage && (
          <div className="text-[11px] mt-1 break-all">
            <a
              href={manifest.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-obsidianAccentPurple hover:underline"
              data-testid="plugin-preview-homepage"
            >
              {manifest.homepage}
            </a>
          </div>
        )}
        <div className="text-[11px] text-obsidianSecondaryText/80 mt-1 break-all">
          from {record.sourceUrl}
        </div>
        {manifest.description && (
          <p
            className="text-sm text-obsidianText mt-3 whitespace-pre-wrap"
            data-testid="plugin-preview-description"
          >
            {manifest.description}
          </p>
        )}
      </div>

      <section>
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1 flex items-center gap-1">
          <ShieldCheckIcon className="w-3 h-3" />
          Capabilities
        </div>
        {surfaceRows.length === 0 && permissions.length === 0 ? (
          <p className="text-sm text-obsidianText">
            None. This plugin runs in a sandboxed Web Worker with no DOM, no GitHub token, and no
            access to other notes&apos; bodies.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="plugin-preview-capabilities">
            {surfaceRows.map((row) => (
              <li
                key={row.key}
                className="flex items-start gap-2 text-sm"
                data-testid={`plugin-preview-capability-${row.key}`}
              >
                <CheckCircleIcon className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" />
                <div>
                  <span className="font-medium text-obsidianText">{row.label}</span>
                  <div className="text-xs text-obsidianSecondaryText mt-0.5">{row.description}</div>
                </div>
              </li>
            ))}
            {permissions.map((perm) => (
              <li
                key={perm}
                className="flex items-start gap-2 text-sm"
                data-testid={`plugin-preview-capability-${perm}`}
              >
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

      {installError && <div className="text-xs text-red-300">{installError}</div>}

      <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
        <Button variant="ghost" onClick={onCancel} disabled={busy} data-testid="plugin-install-cancel">
          Cancel
        </Button>
        <Button onClick={onInstall} disabled={busy} data-testid="plugin-install-confirm">
          {busy ? 'Installing…' : 'Install'}
        </Button>
      </div>
    </div>
  )
}

function buildSurfaceRows(surfaces: InstalledPluginRecord['manifest']['surfaces']): CapabilityRow[] {
  const rows: CapabilityRow[] = []
  if (surfaces.commands && surfaces.commands.length > 0) {
    rows.push({
      key: 'commands' satisfies PluginSurfaceKind,
      label: `${surfaces.commands.length} command${surfaces.commands.length === 1 ? '' : 's'}`,
      description: SURFACE_DESCRIPTIONS.commands,
    })
  }
  if (surfaces.sidebarPanels && surfaces.sidebarPanels.length > 0) {
    rows.push({
      key: 'sidebarPanels' satisfies PluginSurfaceKind,
      label: `${surfaces.sidebarPanels.length} sidebar panel${surfaces.sidebarPanels.length === 1 ? '' : 's'}`,
      description: SURFACE_DESCRIPTIONS.sidebarPanels,
    })
  }
  if (surfaces.codeBlockRenderers && surfaces.codeBlockRenderers.length > 0) {
    const langs = surfaces.codeBlockRenderers.map((r) => r.language).join(', ')
    rows.push({
      key: 'codeBlockRenderers' satisfies PluginSurfaceKind,
      label: `code-block renderer${surfaces.codeBlockRenderers.length === 1 ? '' : 's'} (${langs})`,
      description: SURFACE_DESCRIPTIONS.codeBlockRenderers,
    })
  }
  return rows
}
