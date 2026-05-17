// Internal cross-component DOM events. We use the window event bus to keep
// components decoupled (e.g. the merge-editor view can request a sync without
// importing the sidebar's sync hook).

export const SYNC_REQUEST_EVENT = 'noteser:sync-request'
