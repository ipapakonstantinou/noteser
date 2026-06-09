// Vault-folder scan: walk the user's notes for in-vault plugin
// manifests. A vault manifest is a note whose title is "manifest.json"
// (case-insensitive) and whose body parses as a JSON object with the
// minimum fields the URL installer requires: a "main" string + the
// fields validateManifest() accepts.
//
// The scan is pure — it reads from arrays the caller passed in, never
// from a fresh store snapshot, so it tests cleanly. The PluginsSettingsPanel
// is responsible for handing it the live notes + folders list.

import { validateManifest, type PluginManifest } from './manifest'
import type { Note, Folder } from '@/types'

export interface VaultManifestCandidate {
  /** Validated + normalised manifest. */
  manifest: PluginManifest
  /** The `main` URL from the raw manifest JSON. The installer fetches
   *  this verbatim when the user confirms install. */
  mainUrl: string
  /** Note id whose body contained the manifest. */
  noteId: string
  /** Folder-prefixed display path, e.g. "Plugins/word-count/manifest.json".
   *  Plain string for display only. */
  pathInVault: string
}

export interface VaultScanResult {
  candidates: VaultManifestCandidate[]
  /** Notes whose title matched but whose body failed to parse or
   *  validate. Surfaced as a count so the user knows the scan saw
   *  something but skipped it. */
  skipped: number
}

const MANIFEST_TITLE_RE = /^manifest\.json$/i

export function scanVaultForManifests(
  notes: ReadonlyArray<Note>,
  folders: ReadonlyArray<Folder>,
): VaultScanResult {
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const candidates: VaultManifestCandidate[] = []
  let skipped = 0

  for (const note of notes) {
    if (note.isDeleted) continue
    if (!MANIFEST_TITLE_RE.test(note.title ?? '')) continue

    const candidate = tryParseManifestNote(note, byId)
    if (candidate === null) {
      skipped += 1
      continue
    }
    candidates.push(candidate)
  }

  candidates.sort((a, b) => a.pathInVault.localeCompare(b.pathInVault))
  return { candidates, skipped }
}

function tryParseManifestNote(
  note: Note,
  byId: ReadonlyMap<string, Folder>,
): VaultManifestCandidate | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(note.content ?? '')
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const raw = parsed as Record<string, unknown>
  const mainField = raw.main
  if (typeof mainField !== 'string' || mainField.length === 0) return null

  // Strip `main` before validating — the schema treats it as unknown.
  const { main: _omit, ...rest } = raw
  void _omit
  const result = validateManifest(rest)
  if (!result.ok || !result.manifest) return null

  return {
    manifest: result.manifest,
    mainUrl: mainField,
    noteId: note.id,
    pathInVault: buildPath(note, byId),
  }
}

function buildPath(note: Note, byId: ReadonlyMap<string, Folder>): string {
  const segs: string[] = []
  let cur = note.folderId ? byId.get(note.folderId) : undefined
  for (let i = 0; cur && i < 32; i++) {
    if (cur.isDeleted) break
    segs.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  segs.push(note.title ?? 'manifest.json')
  return segs.join('/')
}
