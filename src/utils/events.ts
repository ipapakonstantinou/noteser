// Internal cross-component DOM events. We use the window event bus to keep
// components decoupled (e.g. the merge-editor view can request a sync without
// importing the sidebar's sync hook).

export const SYNC_REQUEST_EVENT = 'noteser:sync-request'

// Fired whenever the IDB attachment store changes (save / put / delete) so
// UI consumers (FolderTree, Settings) can refresh without polling.
export const ATTACHMENTS_CHANGED_EVENT = 'noteser:attachments-changed'

// Fired by the outline navigator when the user clicks a heading. The
// EditorContent for the matching note listens and scrolls its CodeMirror
// view to the target line.
//   detail: { noteId: string; line: number }   // line is 1-indexed
export const SCROLL_TO_LINE_EVENT = 'noteser:scroll-to-line'
