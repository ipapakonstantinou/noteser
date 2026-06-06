// PluginInstaller — pure functions for fetching a plugin from a URL
// and validating it before the user is asked to confirm the install.
//
// The flow:
//   1. Fetch the manifest.json from the given base URL
//   2. Validate the manifest against the v1 schema (rejects unknown
//      fields, garbage types, missing required pieces)
//   3. Fetch the main.js bundle pointed to by the manifest
//   4. Compute a SHA-256 hash of the bundle bytes for integrity
//      tracking (recorded with the install; checked on every reload
//      so a tampered or swapped bundle gets flagged)
//   5. Return the assembled record. The CALLER decides whether to
//      ask the user to confirm.
//
// All network reads use the global `fetch`. Strict timeouts to keep
// a slow remote from hanging the install UI.

import { validateManifest, type PluginManifest } from './manifest'

export interface FetchedPlugin {
  manifest: PluginManifest
  /** Source code of the plugin's main module, fetched verbatim from
   *  the manifest's `main` URL. The host ships this string to the
   *  worker via `host:boot`. */
  mainSource: string
  /** SHA-256 of the mainSource bytes, hex-encoded. */
  hash: string
  /** Where the user said the plugin lives. Used as the canonical
   *  source URL for hash verification on future loads. */
  sourceUrl: string
}

export interface FetchOptions {
  /** Per-request timeout in milliseconds. Total fetch budget for an
   *  install is `2 * timeoutMs` (manifest + main). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Fetch + validate a plugin from a manifest URL. Caller decides
 * what to do with the result (show preview modal, prompt user,
 * store + boot).
 *
 * The manifest must be JSON with a `main` field pointing at the
 * plugin's bundled JS module. Absolute and relative URLs both work
 * — relative is resolved against the manifest URL.
 */
export async function fetchPluginFromUrl(
  manifestUrl: string,
  opts: FetchOptions = {},
): Promise<FetchedPlugin> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!isHttpsOrLocalhost(manifestUrl)) {
    throw new Error(
      'Plugin manifest URL must use HTTPS. Plain HTTP is only accepted from localhost (dev mode).',
    )
  }

  const manifestRaw = await fetchText(manifestUrl, timeoutMs)
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(manifestRaw)
  } catch (err) {
    throw new Error(`Plugin manifest is not valid JSON: ${asMessage(err)}`)
  }

  // The manifest as published includes a `main` field pointing at the
  // bundle; the validator does not know about `main` (it is not a
  // surface declaration). Pluck it out + validate the rest.
  const manifestObj = (manifestJson ?? {}) as Record<string, unknown>
  const mainField = manifestObj.main
  if (typeof mainField !== 'string' || mainField.length === 0) {
    throw new Error('Plugin manifest must include a non-empty "main" field pointing at the bundle.')
  }
  // Build the rest without `main` so the schema check stays narrow.
  const { main: _omit, ...rest } = manifestObj
  void _omit
  const validation = validateManifest(rest)
  if (!validation.ok || !validation.manifest) {
    throw new Error(`Plugin manifest failed validation:\n  - ${validation.errors.join('\n  - ')}`)
  }

  const mainUrl = new URL(mainField, manifestUrl).toString()
  if (!isHttpsOrLocalhost(mainUrl)) {
    throw new Error(
      'Plugin main.js URL must use HTTPS. Plain HTTP is only accepted from localhost (dev mode).',
    )
  }
  const mainSource = await fetchText(mainUrl, timeoutMs)
  const hash = await sha256Hex(mainSource)

  return {
    manifest: validation.manifest,
    mainSource,
    hash,
    sourceUrl: manifestUrl,
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/** Hex-encoded SHA-256 of `s` using SubtleCrypto. Available in every
 *  modern browser + Node 22. */
export async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const arr = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i].toString(16)
    out += b.length === 1 ? '0' + b : b
  }
  return out
}

function isHttpsOrLocalhost(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
    return false
  } catch {
    return false
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
