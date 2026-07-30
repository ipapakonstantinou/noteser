// Vault settings sync (vs8x).
//
// A small JSON file at `${settingsFolderPath}/settings.json` in the
// synced repo carries the vault-tagged subset of useSettingsStore. The
// rest of the store (UI prefs, API keys, sync cadence) stays in IDB
// per-device. LWW based on an embedded `updatedAt` field.
//
// The file is intentionally simple — no encryption, no per-field
// merging. If two devices conflict, the newer `updatedAt` wins.

import { VAULT_SETTING_KEYS, type SettingsState, type VaultSettingKey } from '@/stores/settingsStore'

export const VAULT_SETTINGS_FILE = 'settings.json'

export interface VaultSettingsFile {
  version: 1
  updatedAt: number
  // Each field is optional so a future-added vault key reaching an
  // older client doesn't crash the parse — unknown keys are ignored on
  // apply.
  vault: Partial<Pick<SettingsState, VaultSettingKey>>
}

// Pick only the vault-tagged keys from a settings state snapshot.
export function pickVaultSlice(state: SettingsState): Partial<Pick<SettingsState, VaultSettingKey>> {
  const out: Partial<Pick<SettingsState, VaultSettingKey>> = {}
  for (const k of VAULT_SETTING_KEYS) {
    // The `as never` is a TS dance: `out[k]` and `state[k]` are
    // co-typed but the compiler can't see that K is uniform across
    // both sides because we're iterating a tuple.
    ;(out as Record<string, unknown>)[k] = state[k]
  }
  return out
}

// Build the canonical JSON blob written to the repo. Keys are sorted
// so the hash is stable across runs — Object.keys() ordering isn't
// guaranteed and would cause spurious "settings changed" pushes.
export function serializeVaultSettings(slice: Partial<Pick<SettingsState, VaultSettingKey>>, updatedAt: number): string {
  const sortedVault: Record<string, unknown> = {}
  for (const k of [...VAULT_SETTING_KEYS].sort()) {
    if (k in slice) sortedVault[k] = (slice as Record<string, unknown>)[k]
  }
  const payload: VaultSettingsFile = {
    version: 1,
    updatedAt,
    vault: sortedVault as Partial<Pick<SettingsState, VaultSettingKey>>,
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

// Per-key value checks for a file that arrives from the repo. The key
// whitelist below is not a boundary on its own: anyone who can write to the
// vault repo could set a whitelisted key to any shape and the value went into
// the store verbatim. Anything that fails its check is dropped and the rest of
// the file still applies.
const MAX_STR = 512
const MAX_RECORD_KEYS = 500

const isStr = (v: unknown): boolean => typeof v === 'string' && v.length <= MAX_STR
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v)
const isBool = (v: unknown): boolean => typeof v === 'boolean'
const isOneOf = (...allowed: string[]) => (v: unknown): boolean =>
  typeof v === 'string' && allowed.includes(v)
const isRecordOf = (check: (v: unknown) => boolean) => (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length > MAX_RECORD_KEYS) return false
  return entries.every(([k, val]) => k.length <= MAX_STR && check(val))
}

// Typed on VaultSettingKey so adding a vault-synced key without a check here
// fails the build instead of shipping an unvalidated field.
const VALUE_CHECKS: Record<VaultSettingKey, (v: unknown) => boolean> = {
  folderSortMode: isOneOf('alphabetical', 'modified', 'created', 'manual'),
  taskListDensity: isOneOf('compact', 'comfortable'),
  showHiddenFolders: isBool,
  attachmentsFolder: isStr,
  attachmentFilenamePattern: isStr,
  dailyNotesFolder: isStr,
  dailyNoteDateFormat: isStr,
  weeklyNotesFolder: isStr,
  weeklyNoteDateFormat: isStr,
  monthlyNotesFolder: isStr,
  monthlyNoteDateFormat: isStr,
  templatesFolder: isStr,
  dailyNoteTemplatePath: isStrOrNull,
  weeklyNoteTemplatePath: isStrOrNull,
  dailyNoteTemplateId: isStrOrNull,
  weeklyNoteTemplateId: isStrOrNull,
  trashMode: isOneOf('trash', 'hardDelete'),
  trashFolderName: isStr,
  confirmBulkDelete: isBool,
  betaEnabled: isBool,
  betaFlags: isRecordOf(isBool),
  themeOverrides: isRecordOf(isStr),
  fontText: isStr,
  fontMono: isStr,
  fontInterface: isStr,
  vaultEncryptionEnabled: isBool,
  vaultEncryptionSalt: isStrOrNull,
  vaultEncryptionCanary: isStrOrNull,
  defaultCommitMessage: isStr,
}

// Parse a raw blob fetched from the repo. Returns null on any error so
// callers can skip the apply step gracefully — the user shouldn't see
// their sync fail because a peer wrote a malformed JSON.
export function parseVaultSettings(raw: string): VaultSettingsFile | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (typeof obj !== 'object' || obj === null) return null
    const o = obj as Record<string, unknown>
    if (o.version !== 1) return null
    if (typeof o.updatedAt !== 'number') return null
    if (typeof o.vault !== 'object' || o.vault === null) return null
    // Whitelist-filter the vault payload so a malicious file can't slip
    // in keys we don't intend to sync (e.g. aiApiKey), then type-check each
    // value so a whitelisted key can't carry an arbitrary shape.
    const vaultRaw = o.vault as Record<string, unknown>
    const vault: Partial<Pick<SettingsState, VaultSettingKey>> = {}
    for (const k of VAULT_SETTING_KEYS) {
      if (!(k in vaultRaw)) continue
      if (!VALUE_CHECKS[k](vaultRaw[k])) continue
      ;(vault as Record<string, unknown>)[k] = vaultRaw[k]
    }
    return { version: 1, updatedAt: o.updatedAt, vault }
  } catch {
    return null
  }
}

// Deterministic short hash used to skip unchanged-on-disk pushes.
// Not cryptographic — collision avoidance is good enough here because
// the input is small and we hash the canonical serialization.
export function vaultSettingsHash(serialized: string): string {
  let h = 0x811c9dc5 // FNV-1a 32-bit
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// Build the full repo path for the vault settings file. Returns null
// when settingsFolderPath is empty so the sync layer can skip
// settings sync entirely (opt-out).
export function vaultSettingsRepoPath(settingsFolderPath: string): string | null {
  const trimmed = settingsFolderPath.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return null
  return `${trimmed}/${VAULT_SETTINGS_FILE}`
}
