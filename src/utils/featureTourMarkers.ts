/**
 * featureTourMarkers.ts
 *
 * Pure constants + detection helpers for the seeded "Feature tour" content.
 *
 * Split out of featureTourNote.ts because the noteStore persist migration
 * (v4, issue #179) needs to recognise previously-seeded tour notes, and
 * featureTourNote.ts imports the noteStore — importing it back from the
 * store would create a cycle. This module is dependency-free on purpose.
 */

export const FEATURE_TOUR_TITLE = 'Feature tour'

// Subdirectory under the user's attachments folder where tour screenshots
// live. Keeps tutorial assets cordoned off from the user's own attachments.
export const TUTORIAL_ASSETS_SUBDIR = 'feature-tour'

// Bundled screenshot filenames — matched 1:1 with PNGs in
// `public/feature-tour/`. Re-captures can drop in here without renaming
// since the body builder references them by these names.
export const TUTORIAL_IMAGES = [
  '00-welcome.png',
  '01-editor-hero.png',
  '02-live-preview.png',
  '03-sidebar-pane-model.png',
  '04-quick-switcher.png',
  '05-templates-modal.png',
  '06-export-modal-pdf.png',
  '07-theme-editor.png',
  '08-sync-settings.png',
] as const

// A distinctive substring every seeded tour body contains regardless of the
// user's attachments-folder setting (the body embeds
// `<attachmentsFolder>/feature-tour/00-welcome.png`). Used by the noteStore
// v4 migration to retro-flag legacy seeds with `doNotSync` (#179).
const TOUR_BODY_MARKER = `${TUTORIAL_ASSETS_SUBDIR}/${TUTORIAL_IMAGES[0]}`

/**
 * Does this (title, content) pair look like a SEEDED Feature tour note?
 * Deliberately conservative: requires both the exact seeded title AND a
 * reference to a bundled tour screenshot, so a user's own note that merely
 * shares the title keeps syncing normally.
 */
export function isSeededFeatureTourNote(title: string, content: string): boolean {
  return title === FEATURE_TOUR_TITLE && (content ?? '').includes(TOUR_BODY_MARKER)
}

/**
 * Is this attachment path one of the bundled tour screenshots — i.e. a
 * known tutorial filename whose immediate parent directory is the tour
 * subdir (`<anything>/feature-tour/<bundled-image>.png`)? Used ONLY by the
 * one-time boot migration that retro-flags legacy seeds (#179); the push
 * path itself never excludes by path (a user could legitimately own a
 * folder with this name) — it honours the per-record doNotSync flag.
 */
export function isTourAssetPath(path: string): boolean {
  const segments = path.split('/')
  if (segments.length < 2) return false
  const file = segments[segments.length - 1]
  const dir = segments[segments.length - 2]
  return dir === TUTORIAL_ASSETS_SUBDIR && (TUTORIAL_IMAGES as readonly string[]).includes(file)
}
