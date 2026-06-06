// Public entry — re-exports the runtime helper + every type.

export { definePlugin } from './sdk'
export type {
  PluginCtx,
  PluginHandlers,
  PluginDefinition,
  NoteWithBody,
  Unsubscribe,
  DirectoryEntry,
  DirectoryEntries,
} from './sdk'

// v1.2 — VNode shapes plus the shared event-handler record. PR A adds
// the types only; new SDK methods (event registration, fullscreen,
// vault, fs) ship in later v1.2 PRs.
export type {
  VNode,
  VNodeText,
  VNodeCallout,
  VNodeButton,
  VNodeInput,
  VNodeList,
  VNodeLink,
  VNodeRadio,
  VNodeSvg,
  VNodeBox,
  VNodeEvent,
  SvgChild,
} from './sdk'

export type {
  PluginManifest,
  PluginSurfaces,
  PluginCommand,
  PluginSidebarPanel,
  PluginCodeBlockRenderer,
  PluginPermission,
  PluginFullscreenView,
} from './manifest'

export { PERMISSIONS } from './manifest'

// `validateManifest` is host-side; published intentionally so plugin
// authors can sanity-check their own manifest at build time.
export { validateManifest } from './manifest'
export type { ManifestValidationResult } from './manifest'
