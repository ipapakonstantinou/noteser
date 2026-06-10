export const STORAGE_KEYS = {
  notes: 'noteser-notes',
  folders: 'noteser-folders',
  workspace: 'noteser-workspace',
  settings: 'noteser-settings',
  github: 'noteser-github',
  ui: 'noteser-ui',
  tags: 'noteser-tags',
  attachmentPrefix: 'noteser-attachment:',
  attachmentTombstones: 'noteser-attachment-tombstones',
  // One-time #179 migration marker: legacy feature-tour screenshots have
  // been retro-flagged doNotSync. Written only after a successful pass.
  tourAttachmentsFlagged: 'noteser-tour-attachments-flagged',
} as const
