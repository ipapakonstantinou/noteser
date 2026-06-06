// Plugin manifest schema + validator. Every plugin declares what it
// wants the host to surface via this object. The host validates against
// this schema BEFORE spawning the Worker, so a malformed plugin never
// runs.
//
// The schema is intentionally narrow for v1 (commands / sidebar panels
// / code-block renderers only). Unknown top-level keys are rejected
// silently — extra fields in the manifest are a smell, not a feature.

export interface PluginManifest {
  id: string
  name: string
  version: string
  author?: string
  surfaces: PluginSurfaces
  /** Capabilities the plugin asks for at install time. The user grants
   *  each one in the install-preview modal; the host refuses any
   *  capability call that was not granted. v1.1 added `file-save` /
   *  `file-open`; v1.2 PR E added `fs.open-directory`. */
  permissions?: PluginPermission[]
}

/** Capability identifiers the validator accepts. Plugins targeting an
 *  older host that does not know a v1.2 permission will fail manifest
 *  validation there — see plugins-v1.2-plan.md section 10. */
export const PERMISSIONS = ['file-save', 'file-open', 'fs.open-directory'] as const
export type PluginPermission = (typeof PERMISSIONS)[number]

export interface PluginSurfaces {
  commands?: PluginCommand[]
  sidebarPanels?: PluginSidebarPanel[]
  codeBlockRenderers?: PluginCodeBlockRenderer[]
  fullscreenViews?: PluginFullscreenView[]
}

export interface PluginCommand {
  /** Stable identifier within the plugin. Host namespaces as
   *  `<pluginId>.<commandId>` so two plugins can ship the same id. */
  id: string
  title: string
  /** Optional, "Mod+Alt+W" style. Host registers as a global shortcut
   *  only if no other plugin or core action owns it. */
  shortcut?: string
}

export interface PluginSidebarPanel {
  id: string
  title: string
  /** Heroicon name from the curated set the host knows how to render.
   *  Unknown names fall back to a generic puzzle-piece icon. */
  icon?: string
}

export interface PluginCodeBlockRenderer {
  /** The fence language to claim, e.g. "mermaid", "chart". Case
   *  insensitive; the host lowercases on register. First plugin to
   *  claim a language wins; later registrations log a warning. */
  language: string
}

/** v1.2 PR B — a full-window view the plugin can request the host to
 *  mount. Only one fullscreen view (across all installed plugins) is
 *  open at a time. */
export interface PluginFullscreenView {
  id: string
  title: string
  icon?: string
}

/** Stable identifier shape: lowercase letters, digits, dashes; 2-60
 *  chars, starts and ends with alphanumeric. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/
/** Semver-ish: major.minor.patch with optional pre-release suffix. */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/

export interface ManifestValidationResult {
  ok: boolean
  /** Empty when ok===true. */
  errors: string[]
  /** Normalised manifest (e.g. languages lowercased, defaults applied). */
  manifest?: PluginManifest
}

/**
 * Validate + normalise a parsed JS object claiming to be a manifest.
 *
 * Returns errors as plain strings so the host can show them in the
 * "add plugin from URL" preview modal without further translation.
 *
 * Pure function — safe to call in the main thread or the worker.
 */
export function validateManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = []

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['Manifest must be a JSON object.'] }
  }
  const m = input as Record<string, unknown>

  const id = m.id
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    errors.push('Manifest "id" must be a lowercase kebab-case string (2-60 chars).')
  }

  if (typeof m.name !== 'string' || m.name.length === 0 || m.name.length > 80) {
    errors.push('Manifest "name" must be a non-empty string up to 80 chars.')
  }

  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) {
    errors.push('Manifest "version" must be semver (e.g. "1.0.0").')
  }

  if (m.author !== undefined && typeof m.author !== 'string') {
    errors.push('Manifest "author" must be a string when present.')
  }

  if (!isPlainObject(m.surfaces)) {
    errors.push('Manifest "surfaces" must be an object.')
  }

  const surfaces = isPlainObject(m.surfaces)
    ? (m.surfaces as Record<string, unknown>)
    : {}

  const commands = validateCommands(surfaces.commands, errors)
  const sidebarPanels = validateSidebarPanels(surfaces.sidebarPanels, errors)
  const codeBlockRenderers = validateCodeBlockRenderers(surfaces.codeBlockRenderers, errors)
  const fullscreenViews = validateFullscreenViews(surfaces.fullscreenViews, errors)
  const permissions = validatePermissions(m.permissions, errors)

  if (errors.length > 0) return { ok: false, errors }

  // At least one surface entry is required — a plugin with empty
  // surfaces has nothing to do.
  const total =
    (commands?.length ?? 0) +
    (sidebarPanels?.length ?? 0) +
    (codeBlockRenderers?.length ?? 0) +
    (fullscreenViews?.length ?? 0)
  if (total === 0) {
    return {
      ok: false,
      errors: ['Manifest must declare at least one surface (command, panel, renderer, or fullscreen view).'],
    }
  }

  const normalised: PluginManifest = {
    id: id as string,
    name: m.name as string,
    version: m.version as string,
    author: m.author as string | undefined,
    surfaces: {
      ...(commands && commands.length > 0 ? { commands } : {}),
      ...(sidebarPanels && sidebarPanels.length > 0 ? { sidebarPanels } : {}),
      ...(codeBlockRenderers && codeBlockRenderers.length > 0
        ? { codeBlockRenderers }
        : {}),
      ...(fullscreenViews && fullscreenViews.length > 0
        ? { fullscreenViews }
        : {}),
    },
    ...(permissions && permissions.length > 0 ? { permissions } : {}),
  }
  return { ok: true, errors: [], manifest: normalised }
}

function validateCommands(input: unknown, errors: string[]): PluginCommand[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    errors.push('"surfaces.commands" must be an array when present.')
    return undefined
  }
  return input.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      errors.push(`surfaces.commands[${idx}] must be an object.`)
      return null
    }
    const c = entry as Record<string, unknown>
    if (typeof c.id !== 'string' || !ID_RE.test(c.id)) {
      errors.push(`surfaces.commands[${idx}].id must be lowercase kebab-case.`)
    }
    if (typeof c.title !== 'string' || c.title.length === 0 || c.title.length > 80) {
      errors.push(`surfaces.commands[${idx}].title must be a non-empty string up to 80 chars.`)
    }
    if (c.shortcut !== undefined && typeof c.shortcut !== 'string') {
      errors.push(`surfaces.commands[${idx}].shortcut must be a string when present.`)
    }
    return {
      id: c.id as string,
      title: c.title as string,
      ...(typeof c.shortcut === 'string' ? { shortcut: c.shortcut } : {}),
    }
  }).filter((x): x is PluginCommand => x !== null)
}

function validateSidebarPanels(input: unknown, errors: string[]): PluginSidebarPanel[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    errors.push('"surfaces.sidebarPanels" must be an array when present.')
    return undefined
  }
  return input.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      errors.push(`surfaces.sidebarPanels[${idx}] must be an object.`)
      return null
    }
    const p = entry as Record<string, unknown>
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) {
      errors.push(`surfaces.sidebarPanels[${idx}].id must be lowercase kebab-case.`)
    }
    if (typeof p.title !== 'string' || p.title.length === 0 || p.title.length > 80) {
      errors.push(`surfaces.sidebarPanels[${idx}].title must be a non-empty string up to 80 chars.`)
    }
    if (p.icon !== undefined && typeof p.icon !== 'string') {
      errors.push(`surfaces.sidebarPanels[${idx}].icon must be a string when present.`)
    }
    return {
      id: p.id as string,
      title: p.title as string,
      ...(typeof p.icon === 'string' ? { icon: p.icon } : {}),
    }
  }).filter((x): x is PluginSidebarPanel => x !== null)
}

function validateCodeBlockRenderers(
  input: unknown,
  errors: string[],
): PluginCodeBlockRenderer[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    errors.push('"surfaces.codeBlockRenderers" must be an array when present.')
    return undefined
  }
  return input.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      errors.push(`surfaces.codeBlockRenderers[${idx}] must be an object.`)
      return null
    }
    const r = entry as Record<string, unknown>
    if (typeof r.language !== 'string' || r.language.length === 0 || r.language.length > 40) {
      errors.push(
        `surfaces.codeBlockRenderers[${idx}].language must be a non-empty string up to 40 chars.`,
      )
      return null
    }
    return { language: r.language.toLowerCase() }
  }).filter((x): x is PluginCodeBlockRenderer => x !== null)
}

function validatePermissions(
  input: unknown,
  errors: string[],
): PluginPermission[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    errors.push('"permissions" must be an array when present.')
    return undefined
  }
  const out: PluginPermission[] = []
  const seen = new Set<string>()
  for (let i = 0; i < input.length; i++) {
    const entry = input[i]
    if (typeof entry !== 'string') {
      errors.push(`permissions[${i}] must be a string.`)
      continue
    }
    if (!(PERMISSIONS as readonly string[]).includes(entry)) {
      errors.push(
        `permissions[${i}] "${entry}" is not a known capability. Known: ${PERMISSIONS.join(', ')}.`,
      )
      continue
    }
    if (seen.has(entry)) continue
    seen.add(entry)
    out.push(entry as PluginPermission)
  }
  return out
}

function validateFullscreenViews(
  input: unknown,
  errors: string[],
): PluginFullscreenView[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    errors.push('"surfaces.fullscreenViews" must be an array when present.')
    return undefined
  }
  const seen = new Set<string>()
  return input.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      errors.push(`surfaces.fullscreenViews[${idx}] must be an object.`)
      return null
    }
    const v = entry as Record<string, unknown>
    if (typeof v.id !== 'string' || !ID_RE.test(v.id)) {
      errors.push(`surfaces.fullscreenViews[${idx}].id must be lowercase kebab-case.`)
      return null
    }
    if (typeof v.title !== 'string' || v.title.length === 0 || v.title.length > 80) {
      errors.push(
        `surfaces.fullscreenViews[${idx}].title must be a non-empty string up to 80 chars.`,
      )
      return null
    }
    if (v.icon !== undefined && typeof v.icon !== 'string') {
      errors.push(`surfaces.fullscreenViews[${idx}].icon must be a string when present.`)
      return null
    }
    if (seen.has(v.id)) {
      errors.push(`surfaces.fullscreenViews[${idx}].id "${v.id}" is duplicated.`)
      return null
    }
    seen.add(v.id)
    return {
      id: v.id,
      title: v.title,
      ...(typeof v.icon === 'string' ? { icon: v.icon } : {}),
    }
  }).filter((x): x is PluginFullscreenView => x !== null)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
