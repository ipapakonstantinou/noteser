// Public entry — re-exports the runtime helper + every type.

export { definePlugin } from './sdk'
export type {
  PluginCtx,
  PluginHandlers,
  PluginDefinition,
} from './sdk'

export type {
  PluginManifest,
  PluginSurfaces,
  PluginCommand,
  PluginSidebarPanel,
  PluginCodeBlockRenderer,
} from './manifest'

// `validateManifest` is host-side; published intentionally so plugin
// authors can sanity-check their own manifest at build time.
export { validateManifest } from './manifest'
export type { ManifestValidationResult } from './manifest'
