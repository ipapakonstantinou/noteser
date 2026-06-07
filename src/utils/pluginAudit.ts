// Plugin audit trail. Every destructive plugin action lands here so
// the user (and bug reports) can see what a plugin did to their vault
// after the fact.
//
// Storage strategy:
//   - In-memory ring buffer (MAX_ENTRIES) keyed by ts. Single source of
//     truth for the running session.
//   - On every append, schedule a debounced flush to localStorage. The
//     log persists across reloads so a "plugin trashed my notes!"
//     report has a paper trail even after the user refreshes.
//
// We DELIBERATELY do not use the Zustand stores + idbStorage path the
// rest of the app uses. The audit log must keep functioning even when
// IndexedDB is busy migrating, when a plugin is mid-write, or when the
// noteser stores are unloaded for tests. localStorage is synchronous,
// small, and survives across tabs of the same origin — exactly the
// guarantees we want for "what just happened" tracing.
//
// PR D (Plugin API v1.2) — see docs/plugins-v1.2-impl-notes.md.

const STORAGE_KEY = 'noteser-plugin-audit'
const MAX_ENTRIES = 500
const FLUSH_DEBOUNCE_MS = 250

/** Single audit log entry. Emitted by `recordPluginWrite` after the
 *  host has accepted (or attempted) a plugin's vault mutation.
 *  Stable on-disk shape — never break this without bumping
 *  `STORAGE_VERSION`. */
export interface PluginAuditEntry {
  /** Wall-clock at the moment the host applied (or rejected) the op. */
  ts: number
  /** Plugin manifest id that requested the write. */
  pluginId: string
  /** One of the four `vault.write` operations. */
  op: 'create' | 'update' | 'delete' | 'createFolder'
  /** Note id (for create/update/delete) or folder path (for
   *  createFolder). Allows the user to cross-reference the entry with
   *  the trash or vault tree. */
  target: string
  /** Outcome of the op. `error` is populated only when ok===false. */
  ok: boolean
  error?: string
  /** For `create` calls where the host had to append " (imported)" to
   *  resolve a title collision — surfaced so the user can see the
   *  rename. */
  conflictResolved?: 'none' | 'suffix'
}

const STORAGE_VERSION = 1

interface PersistedShape {
  v: typeof STORAGE_VERSION
  entries: PluginAuditEntry[]
}

let buffer: PluginAuditEntry[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Lazily-loaded ring buffer. First access hydrates from localStorage
 *  if a prior session left anything behind, then bounds to MAX_ENTRIES. */
function getBuffer(): PluginAuditEntry[] {
  if (buffer !== null) return buffer
  buffer = loadFromStorage()
  return buffer
}

function loadFromStorage(): PluginAuditEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedShape | PluginAuditEntry[] | null
    if (Array.isArray(parsed)) {
      // Legacy / un-versioned shape — treat the array as the entries.
      return parsed.slice(-MAX_ENTRIES)
    }
    if (parsed && parsed.v === STORAGE_VERSION && Array.isArray(parsed.entries)) {
      return parsed.entries.slice(-MAX_ENTRIES)
    }
  } catch {
    // Corrupt JSON, version mismatch, or storage quota issue. Reset to
    // an empty log rather than crash the host.
  }
  return []
}

function scheduleFlush(): void {
  if (typeof localStorage === 'undefined') return
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      const payload: PersistedShape = {
        v: STORAGE_VERSION,
        entries: getBuffer(),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Quota exceeded or storage disabled — drop the flush silently.
      // The in-memory buffer is still authoritative for the running
      // session; we just lose persistence across reload.
    }
  }, FLUSH_DEBOUNCE_MS)
}

/** Append one entry to the audit log. Called from the host's vault.write
 *  handler after the noteStore / folderStore mutation has been applied
 *  (or rejected). Bounds the in-memory log to MAX_ENTRIES — oldest
 *  entries roll off. */
export function recordPluginWrite(entry: Omit<PluginAuditEntry, 'ts'> & { ts?: number }): void {
  const buf = getBuffer()
  const ts = typeof entry.ts === 'number' ? entry.ts : Date.now()
  const full: PluginAuditEntry = {
    ts,
    pluginId: entry.pluginId,
    op: entry.op,
    target: entry.target,
    ok: entry.ok,
    ...(entry.error !== undefined ? { error: entry.error } : {}),
    ...(entry.conflictResolved !== undefined
      ? { conflictResolved: entry.conflictResolved }
      : {}),
  }
  buf.push(full)
  if (buf.length > MAX_ENTRIES) {
    buf.splice(0, buf.length - MAX_ENTRIES)
  }
  scheduleFlush()
}

/** Snapshot of every audit entry currently held in memory. Returns a
 *  freshly-allocated array so callers can sort / filter without
 *  mutating the buffer. Newest entry last. */
export function readPluginAudit(): ReadonlyArray<PluginAuditEntry> {
  return getBuffer().slice()
}

/** Same as `readPluginAudit` but filtered to one plugin id. Used by
 *  the per-plugin "Recent activity" view in Settings → Plugins. */
export function readPluginAuditFor(pluginId: string): ReadonlyArray<PluginAuditEntry> {
  return getBuffer().filter((e) => e.pluginId === pluginId)
}

/** Test-only: clear the in-memory buffer + persisted log. Production
 *  code never calls this — the log is a permanent trail. */
export function clearPluginAuditForTests(): void {
  buffer = []
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}
