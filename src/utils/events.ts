// Internal cross-component DOM events. We use the window event bus to keep
// components decoupled (e.g. the merge-editor view can request a sync without
// importing the sidebar's sync hook).

export const SYNC_REQUEST_EVENT = 'noteser:sync-request'

// Fired whenever the IDB attachment store changes (save / put / delete) so
// UI consumers (FolderTree, Settings) can refresh without polling.
export const ATTACHMENTS_CHANGED_EVENT = 'noteser:attachments-changed'
