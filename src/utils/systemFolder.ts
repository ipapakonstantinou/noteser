// Reusable abstraction for a "configurable system folder" — the pattern
// shared by attachments, the (upcoming) daily-notes folder, and the
// (upcoming) templates folder. Each has the same shape:
//
//   - A persisted string in the settings store.
//   - A default value used when the setting is empty.
//   - A normaliser that strips stray slashes and falls back to the default.
//   - A path-prefix check that always recognises the historical default for
//     back-compat (so renaming the folder doesn't break existing refs in
//     pre-existing notes).
//
// Build a SystemFolder once per system, then call `.get()` / `.prefixes()`
// / `.matchesPath()` from any callsite. The instance reads the store live
// — there's no caching, so changes to the setting take effect immediately.

import { useSettingsStore } from '@/stores/settingsStore'
import type { SettingsState } from '@/stores/settingsStore'

// Only setting keys whose stored value is a string can hold a folder name.
type StringSettingKey = {
  [K in keyof SettingsState]: SettingsState[K] extends string ? K : never
}[keyof SettingsState]

export interface SystemFolderConfig {
  // Key in the settings store that holds the user-configured folder name.
  settingKey: StringSettingKey
  // Folder name used when the setting is empty / blank / null. Also used
  // as the "historical" prefix in `prefixes()` for back-compat.
  defaultValue: string
  // When true (default), `prefixes()` also includes `defaultValue/` so
  // paths under the historical folder are still recognised after a rename.
  // Disable for folders that should NOT keep accepting the old prefix
  // (none today, but kept for future flexibility).
  includeLegacyPrefix?: boolean
}

export class SystemFolder {
  constructor(private readonly config: SystemFolderConfig) {}

  // Trim whitespace, strip leading/trailing slashes, collapse repeats.
  // Falls back to the configured default on empty / whitespace / null.
  normalize(input: string | undefined | null): string {
    if (!input) return this.config.defaultValue
    const trimmed = input
      .trim()
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\/{2,}/g, '/')
    return trimmed || this.config.defaultValue
  }

  // Current folder name from the settings store. Wrapped in try/catch so
  // SSR / test environments that haven't initialised the store fall back
  // to the default rather than throw.
  get(): string {
    try {
      // The StringSettingKey constraint guarantees the value is a string,
      // but Zustand's typing returns the union — narrow defensively.
      const raw = useSettingsStore.getState()[this.config.settingKey] as unknown
      return this.normalize(typeof raw === 'string' ? raw : null)
    } catch {
      return this.config.defaultValue
    }
  }

  // Path prefixes that count as belonging to this folder. Always includes
  // the current folder; also includes the historical default (with a
  // trailing slash) when includeLegacyPrefix is left at its default.
  prefixes(): string[] {
    const current = this.get()
    if (current === this.config.defaultValue) return [`${current}/`]
    if (this.config.includeLegacyPrefix !== false) {
      return [`${current}/`, `${this.config.defaultValue}/`]
    }
    return [`${current}/`]
  }

  // True iff the given path lies under any of the recognised prefixes.
  matchesPath(path: string): boolean {
    return this.prefixes().some(p => path.startsWith(p))
  }

  // The historical default value — useful when callers need a stable
  // identifier (e.g. for the `noteser-attachment:` IDB key prefix that
  // must not change with the user's setting).
  get defaultName(): string {
    return this.config.defaultValue
  }
}

// ── Pre-built singletons for the system folders we ship ─────────────────────

// Attachments folder. Default name `attachments`. Renaming it (via the
// Settings input) makes new attachments land in the new folder while
// existing refs under `attachments/` still resolve.
export const attachmentsFolder = new SystemFolder({
  settingKey: 'attachmentsFolder',
  defaultValue: 'attachments',
})

// Daily notes folder. Default name `Daily Notes`. New daily notes land
// here; the calendar view also reads from here when listing days that
// have a note.
export const dailyNotesFolder = new SystemFolder({
  settingKey: 'dailyNotesFolder',
  defaultValue: 'Daily Notes',
})

// Templates folder. Default name `Templates`. The Settings panel
// populates the daily-note template picker from notes inside this folder.
export const templatesFolder = new SystemFolder({
  settingKey: 'templatesFolder',
  defaultValue: 'Templates',
})
