// Static catalog of every user-visible setting surfaced by SettingsModal.
//
// The catalog is consumed by the in-modal search UI to filter across
// label, description, category, and keywords without each panel having
// to declare its own searchable metadata. Adding a new setting means
// adding one entry here AND the actual UI in the panel — the search
// will not pick up controls that are not catalogued.

export type SettingsCategoryId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'sidebar'
  | 'attachments'
  | 'daily-notes'
  | 'templates'
  | 'github'
  | 'local-folder'
  | 'ai'
  | 'shortcuts'
  | 'export'
  | 'plugins'
  | 'beta'
  | 'about'

export interface SettingsCatalogEntry {
  id: string
  label: string
  description: string
  categoryId: SettingsCategoryId
  categoryLabel: string
  keywords?: readonly string[]
}

export const SETTINGS_CATALOG: readonly SettingsCatalogEntry[] = [
  // ── General ─────────────────────────────────────────────────────────
  {
    id: 'general.startupNote',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Open on launch',
    description: 'Which note opens automatically when Noteser starts. Leave on Welcome view to keep the current behaviour.',
    keywords: ['startup', 'boot', 'launch', 'welcome', 'home'],
  },
  {
    id: 'general.folderSortMode',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Sort notes within folders',
    description: 'How notes are ordered in the sidebar. Manual = insertion order.',
    keywords: ['sort', 'order', 'alphabetical', 'modified', 'created'],
  },
  {
    id: 'general.showHiddenFolders',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Show hidden folders',
    description: 'Folders whose name starts with a dot (.obsidian, .github, …). Turn off to suppress them from the sidebar.',
    keywords: ['hidden', 'dotfile', 'dot folder'],
  },
  {
    id: 'general.trashMode',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Delete behaviour',
    description: 'What happens when you delete a note. Trash keeps it recoverable via the Trash view. No trash deletes immediately.',
    keywords: ['delete', 'trash', 'remove'],
  },
  {
    id: 'general.trashFolderName',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Trash folder',
    description: 'Display name for the trash row in the sidebar. Renaming is cosmetic and syncs across devices; the trash never appears in your sync repo.',
    keywords: ['trash', 'folder', 'name', 'rename', 'recycle', 'bin'],
  },
  {
    id: 'general.confirmBeforeTrash',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Confirm before moving notes to trash',
    description: 'When off, deleting a note skips the confirmation and moves it straight to trash.',
    keywords: ['confirm', 'delete', 'trash', 'prompt'],
  },
  {
    id: 'general.confirmBulkDelete',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Confirm before bulk delete',
    description: 'Show a confirm dialog when deleting multiple notes via the sidebar multi-select.',
    keywords: ['confirm', 'delete', 'multi-select', 'bulk'],
  },
  {
    id: 'general.shareDefaultExpiryDays',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Default expiry',
    description: 'Days until newly-generated /share links stop rendering. 0 = no expiry.',
    keywords: ['share', 'expiry', 'link', 'url'],
  },
  {
    id: 'general.shareDefaultBurn',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Burn after first view',
    description: 'Mark /share links so the recipient browser refuses to re-render after the first successful view.',
    keywords: ['share', 'burn', 'link', 'one-time'],
  },
  {
    id: 'general.showWelcomeTab',
    categoryId: 'general',
    categoryLabel: 'General',
    label: 'Show welcome tab',
    description: 'Reopens the Welcome tab with the feature tour link, starter vaults, and getting-started shortcuts.',
    keywords: ['welcome', 'onboarding', 'tour'],
  },

  // ── Appearance ──────────────────────────────────────────────────────
  {
    id: 'appearance.themePresets',
    categoryId: 'appearance',
    categoryLabel: 'Appearance',
    label: 'Theme presets',
    description: 'Pick a preset palette. Changes apply instantly and sync across devices via your vault settings file.',
    keywords: ['theme', 'preset', 'palette', 'colors', 'dark', 'light'],
  },
  {
    id: 'appearance.themeTokens',
    categoryId: 'appearance',
    categoryLabel: 'Appearance',
    label: 'Individual tokens',
    description: 'Per-token color overrides for fine-grained tweaks on top of the active preset.',
    keywords: ['theme', 'color', 'token', 'override', 'css variable'],
  },
  {
    id: 'appearance.fontText',
    categoryId: 'appearance',
    categoryLabel: 'Appearance',
    label: 'Text font',
    description: 'Font used for note bodies. Choose a curated family or type a font installed on this device.',
    keywords: ['font', 'typography', 'text', 'body'],
  },
  {
    id: 'appearance.fontMono',
    categoryId: 'appearance',
    categoryLabel: 'Appearance',
    label: 'Monospace font',
    description: 'Font used for code blocks and inline code.',
    keywords: ['font', 'monospace', 'code', 'mono'],
  },
  {
    id: 'appearance.fontInterface',
    categoryId: 'appearance',
    categoryLabel: 'Appearance',
    label: 'Interface font',
    description: 'Font used for the sidebar, toolbars, and modals.',
    keywords: ['font', 'interface', 'ui', 'chrome'],
  },

  // ── Editor ──────────────────────────────────────────────────────────
  {
    id: 'editor.notesOpenInPreviewMode',
    categoryId: 'editor',
    categoryLabel: 'Editor',
    label: 'Open notes in preview mode',
    description: 'When ON (default), clicking a note opens the rendered markdown. Toggle to edit mode any time with the pencil icon.',
    keywords: ['preview', 'edit mode', 'render', 'markdown'],
  },
  {
    id: 'editor.autocorrect',
    categoryId: 'editor',
    categoryLabel: 'Editor',
    label: 'Autocorrect and word suggestions',
    description: 'Lets your keyboard autocorrect, auto-capitalisation, and predictive text suggestions work while you type.',
    keywords: ['autocorrect', 'spell', 'suggestion', 'keyboard', 'mobile'],
  },
  {
    id: 'editor.reopenTabsOnStartup',
    categoryId: 'editor',
    categoryLabel: 'Editor',
    label: 'Reopen tabs on startup',
    description: 'When ON (default), the notes you had open are reopened when you reload or return to noteser.',
    keywords: ['tabs', 'startup', 'restore', 'session'],
  },
  {
    id: 'editor.collaborationMode',
    categoryId: 'editor',
    categoryLabel: 'Editor',
    label: 'Collaboration',
    description: 'Real-time editing scope. Off keeps notes solo and fast. Per-note connects only for notes you set Live or open from a share link. Whole repo makes every note live.',
    keywords: ['collaboration', 'collab', 'live', 'real-time', 'realtime', 'share', 'yjs', 'websocket', 'multiplayer'],
  },
  {
    id: 'editor.taskListDensity',
    categoryId: 'editor',
    categoryLabel: 'Editor',
    label: 'Task list density',
    description: 'Spacing inside tasks query blocks. Comfortable matches Obsidian; Compact is the legacy noteser default.',
    keywords: ['task', 'density', 'spacing', 'compact', 'comfortable'],
  },
  {
    id: 'editor.taskQueryLenientDoneToday',
    categoryId: 'editor',
    categoryLabel: 'Editor',
    label: 'Match completed tasks without a date stamp as done today',
    description: 'When ON, done today also matches completed tasks without a completion date if their note was updated today.',
    keywords: ['task', 'done today', 'completion', 'query'],
  },

  // ── Sidebar ─────────────────────────────────────────────────────────
  {
    id: 'sidebar.hiddenTabs',
    categoryId: 'sidebar',
    categoryLabel: 'Sidebar',
    label: 'Hidden sidebar tabs',
    description: 'Tabs you have hidden from the sidebar strip. Show them again to restore.',
    keywords: ['sidebar', 'tabs', 'hidden', 'restore'],
  },

  // ── Attachments ─────────────────────────────────────────────────────
  {
    id: 'attachments.folder',
    categoryId: 'attachments',
    categoryLabel: 'Attachments',
    label: 'Attachments folder',
    description: 'Folder where new attachments are stored. Existing files keep their original path.',
    keywords: ['attachment', 'folder', 'images', 'files'],
  },
  {
    id: 'attachments.filenamePattern',
    categoryId: 'attachments',
    categoryLabel: 'Attachments',
    label: 'Filename pattern',
    description: 'Filename for new pasted/dropped images. Tokens: {date} {date:FORMAT} {noteTitle} {originalName} {counter}.',
    keywords: ['attachment', 'filename', 'pattern', 'paste', 'rename', 'image'],
  },
  {
    id: 'attachments.cleanupOrphans',
    categoryId: 'attachments',
    categoryLabel: 'Attachments',
    label: 'Clean up orphans',
    description: 'Delete attachments that are not referenced by any note.',
    keywords: ['orphan', 'cleanup', 'attachment', 'unused'],
  },

  // ── Daily and weekly notes ──────────────────────────────────────────
  {
    id: 'dailyNotes.folder',
    categoryId: 'daily-notes',
    categoryLabel: 'Daily and weekly notes',
    label: 'Daily notes folder',
    description: 'Where new daily notes are created.',
    keywords: ['daily', 'folder', 'journal'],
  },
  {
    id: 'dailyNotes.dateFormat',
    categoryId: 'daily-notes',
    categoryLabel: 'Daily and weekly notes',
    label: 'Daily note date format',
    description: 'Title format. Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd.',
    keywords: ['daily', 'date', 'format', 'title'],
  },
  {
    id: 'dailyNotes.weekStartDay',
    categoryId: 'daily-notes',
    categoryLabel: 'Daily and weekly notes',
    label: 'Calendar starts on',
    description: 'First day of the week in the sidebar Calendar grid. Per-device display preference, not synced.',
    keywords: ['calendar', 'week', 'sunday', 'monday'],
  },
  {
    id: 'weeklyNotes.folder',
    categoryId: 'daily-notes',
    categoryLabel: 'Daily and weekly notes',
    label: 'Weekly notes folder',
    description: 'Where new weekly notes are created.',
    keywords: ['weekly', 'folder', 'journal'],
  },
  {
    id: 'weeklyNotes.dateFormat',
    categoryId: 'daily-notes',
    categoryLabel: 'Daily and weekly notes',
    label: 'Weekly note title format',
    description: 'Title format for weekly notes. Tokens include WW / W (ISO week number).',
    keywords: ['weekly', 'date', 'format', 'iso week'],
  },

  // ── Templates ───────────────────────────────────────────────────────
  {
    id: 'templates.folder',
    categoryId: 'templates',
    categoryLabel: 'Templates',
    label: 'Templates folder',
    description: 'Where template notes live. Notes inside this folder appear in the template pickers.',
    keywords: ['template', 'folder'],
  },
  {
    id: 'templates.dailyTemplate',
    categoryId: 'templates',
    categoryLabel: 'Templates',
    label: 'Daily note template',
    description: 'When a daily note is created (Alt+D / calendar click), its content is seeded from this note.',
    keywords: ['template', 'daily', 'seed'],
  },
  {
    id: 'templates.weeklyTemplate',
    categoryId: 'templates',
    categoryLabel: 'Templates',
    label: 'Weekly note template',
    description: 'When a weekly note is created (calendar W-column click), its content is seeded from this note.',
    keywords: ['template', 'weekly', 'seed'],
  },

  // ── GitHub sync ─────────────────────────────────────────────────────
  {
    id: 'github.autoSyncOnStart',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Auto-sync on startup',
    description: 'When the app boots and a repo is connected, pull and push once automatically.',
    keywords: ['github', 'sync', 'startup', 'auto'],
  },
  {
    id: 'github.pullOnlyOnStartup',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Pull-only on startup',
    description: 'When auto-sync runs on boot, only PULL. Local edits stay local until you click Commit and Sync.',
    keywords: ['github', 'sync', 'pull', 'startup'],
  },
  {
    id: 'github.autoSyncIntervalMinutes',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Auto-sync every',
    description: 'Minutes between auto-syncs. 0 disables periodic syncing.',
    keywords: ['github', 'sync', 'interval', 'period', 'auto'],
  },
  {
    id: 'github.defaultCommitMessage',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Default commit message',
    description: 'Pre-fills the Source Control commit textarea. Supports {{date}} substitution.',
    keywords: ['commit', 'message', 'template', 'github'],
  },
  {
    id: 'github.settingsFolderPath',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Settings folder',
    description: 'Repo path that holds settings.json. Empty disables settings sync.',
    keywords: ['settings', 'folder', 'path', 'github', 'sync'],
  },
  {
    id: 'github.vaultGitignore',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Vault .gitignore',
    description: 'The shared ignore file at the repo root. Fetch, edit, and the next sync pushes your changes.',
    keywords: ['gitignore', 'ignore', 'github', 'vault'],
  },
  {
    id: 'github.localGitignoreOverlay',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Local ignore patterns',
    description: 'Per-device additions to the vault .gitignore. One pattern per line.',
    keywords: ['gitignore', 'ignore', 'local', 'overlay'],
  },
  {
    id: 'github.vaultEncryption',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Vault encryption',
    description: 'AES-GCM-encrypt note bodies before pushing to GitHub. Passphrase is never persisted.',
    keywords: ['encryption', 'aes', 'passphrase', 'security', 'github'],
  },
  {
    id: 'github.resetToRemote',
    categoryId: 'github',
    categoryLabel: 'GitHub sync',
    label: 'Reset to remote',
    description: 'Discard local edits to pushed notes and pull a fresh copy from the repo.',
    keywords: ['reset', 'remote', 'discard', 'github'],
  },

  // ── Local folder ────────────────────────────────────────────────────
  {
    id: 'localFolder.connect',
    categoryId: 'local-folder',
    categoryLabel: 'Local folder',
    label: 'Local folder sync',
    description: 'Mirror your vault to a folder on disk (Obsidian-style local vault). Push out for backup or re-import after editing elsewhere.',
    keywords: ['local', 'folder', 'sync', 'disk', 'obsidian', 'filesystem'],
  },
  {
    id: 'localFolder.inFolderGit',
    categoryId: 'local-folder',
    categoryLabel: 'Local folder',
    label: 'In-folder git',
    description: 'Initialise, set remote, commit, and push the connected local folder directly from noteser when it is a git repo.',
    keywords: ['git', 'commit', 'push', 'remote', 'local folder'],
  },

  // ── AI ──────────────────────────────────────────────────────────────
  {
    id: 'ai.provider',
    categoryId: 'ai',
    categoryLabel: 'AI',
    label: 'AI provider',
    description: 'Which AI service to call. Off disables every AI feature.',
    keywords: ['ai', 'provider', 'anthropic', 'openai', 'claude'],
  },
  {
    id: 'ai.apiKey',
    categoryId: 'ai',
    categoryLabel: 'AI',
    label: 'AI API key',
    description: 'Paste your provider key. Masked in this field; stored in localStorage.',
    keywords: ['ai', 'key', 'token', 'api'],
  },
  {
    id: 'ai.model',
    categoryId: 'ai',
    categoryLabel: 'AI',
    label: 'AI model',
    description: 'Free-form model id. Leave the suggested default unless you need a specific snapshot.',
    keywords: ['ai', 'model', 'gpt', 'claude'],
  },
  {
    id: 'ai.embeddingsEnabled',
    categoryId: 'ai',
    categoryLabel: 'AI',
    label: 'Enable AI embeddings',
    description: 'Index notes via OpenAI text-embedding-3-small to power the Related notes panel.',
    keywords: ['embeddings', 'related', 'openai', 'index', 'vector'],
  },
  {
    id: 'ai.commitMessages',
    categoryId: 'ai',
    categoryLabel: 'AI',
    label: 'AI-drafted commit messages',
    description: 'When syncing, ask the model to draft a one-line commit message from the pending diff.',
    keywords: ['commit', 'message', 'ai', 'sync', 'github'],
  },

  // ── Shortcuts ───────────────────────────────────────────────────────
  {
    id: 'shortcuts.all',
    categoryId: 'shortcuts',
    categoryLabel: 'Shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Rebind any of the application keyboard shortcuts. Click a combo to capture a new one.',
    keywords: ['keyboard', 'shortcut', 'hotkey', 'rebind', 'keybinding'],
  },

  // ── Export ──────────────────────────────────────────────────────────
  {
    id: 'export.action',
    categoryId: 'export',
    categoryLabel: 'Export',
    label: 'Export notes',
    description: 'Download all notes as markdown, JSON, or HTML.',
    keywords: ['export', 'download', 'backup', 'markdown', 'json', 'html'],
  },

  // ── Plugins ─────────────────────────────────────────────────────────
  {
    id: 'plugins.builtin',
    categoryId: 'plugins',
    categoryLabel: 'Plugins',
    label: 'Built-in plugins',
    description: 'One-click install for the first-party plugins that ship with noteser: Graph view, Kanban boards, callouts, word count, and more.',
    keywords: ['plugin', 'builtin', 'bundled', 'graph', 'kanban', 'callout', 'install'],
  },
  {
    id: 'plugins.add',
    categoryId: 'plugins',
    categoryLabel: 'Plugins',
    label: 'Add a plugin',
    description: 'Load a plugin from any HTTPS URL that serves a manifest.json. The plugin code runs in a Web Worker sandbox.',
    keywords: ['plugin', 'install', 'manifest', 'extension', 'add'],
  },
  {
    id: 'plugins.scanVault',
    categoryId: 'plugins',
    categoryLabel: 'Plugins',
    label: 'Scan vault for plugins',
    description: 'Look through your vault for notes titled manifest.json that declare a plugin.',
    keywords: ['plugin', 'vault', 'scan', 'manifest'],
  },
  {
    id: 'plugins.installed',
    categoryId: 'plugins',
    categoryLabel: 'Plugins',
    label: 'Installed plugins',
    description: 'Toggle, reload, or uninstall plugins you have installed.',
    keywords: ['plugin', 'installed', 'uninstall', 'enable', 'disable'],
  },

  // ── Beta ────────────────────────────────────────────────────────────
  {
    id: 'beta.enabled',
    categoryId: 'beta',
    categoryLabel: 'Beta',
    label: 'Enable beta features',
    description: 'Master switch. Individual flags have no effect when this is off.',
    keywords: ['beta', 'experimental', 'preview', 'flag'],
  },
  {
    id: 'beta.flags',
    categoryId: 'beta',
    categoryLabel: 'Beta',
    label: 'Beta feature flags',
    description: 'Opt into work-in-progress features. They may be buggy or removed.',
    keywords: ['beta', 'experimental', 'flag', 'feature'],
  },

  // ── About ───────────────────────────────────────────────────────────
  {
    id: 'about.version',
    categoryId: 'about',
    categoryLabel: 'About',
    label: 'Version and build',
    description: 'Current noteser version and build id.',
    keywords: ['version', 'build', 'release'],
  },
  {
    id: 'about.help',
    categoryId: 'about',
    categoryLabel: 'About',
    label: 'Help and docs',
    description: 'In-app help: getting started, GitHub sync, local folder, shortcuts, FAQ.',
    keywords: ['help', 'docs', 'faq', 'getting started'],
  },
  {
    id: 'about.reportBug',
    categoryId: 'about',
    categoryLabel: 'About',
    label: 'Report a bug',
    description: 'Open the bug report form with diagnostics attached.',
    keywords: ['bug', 'report', 'issue', 'feedback'],
  },
  {
    id: 'about.launchUpdates',
    categoryId: 'about',
    categoryLabel: 'About',
    label: 'Get launch updates',
    description: 'A short email when sync, mobile, and the next features land. No spam.',
    keywords: ['email', 'updates', 'newsletter', 'launch'],
  },
]
