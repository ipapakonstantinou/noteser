/**
 * featureTourNote.ts
 *
 * The "Feature tour" note that gets seeded into the user's vault when
 * they click the corresponding link in the WelcomePane.
 *
 * Goal: a fresh noteser user sees ONE folder (`Tutorial/`) containing
 * the markdown note AND the screenshots that the note references —
 * like a normal Obsidian vault. No network dependency on the noteser
 * source repo: the screenshots are bundled as static assets under
 * `public/feature-tour/` and seeded into IndexedDB as attachments on
 * first use.
 *
 * `seedFeatureTourNote()` is idempotent: clicking the link a second
 * time focuses the existing note (and re-seeds any missing images so
 * the tour stays viewable even if the user accidentally deleted one).
 */

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { putAttachmentAtPath, getAttachmentBlob } from '@/utils/attachments'

export const FEATURE_TOUR_TITLE = 'Feature tour'
export const TUTORIAL_FOLDER_NAME = 'Tutorial'

// Filenames bundled under `public/feature-tour/` — one per section in
// the body. The names match the docs/images/ originals so future
// re-captures can drop in without renaming.
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

// Body content of the seeded note. References use vault-relative paths
// (`Tutorial/X.png`) — AttachmentImage resolves these via IndexedDB
// because `Tutorial/` is registered as a recognised attachment prefix
// in `src/utils/attachments.ts`.
//
// We deliberately DO NOT include the H1 title here — the note's
// `title` field carries that; otherwise it would render twice.
export const FEATURE_TOUR_BODY = `> **Browser-based Obsidian, with GitHub sync and task management.**
> Built end-to-end by one person in **under 40 hours**, evenings and weekends,
> with **zero hand-written lines of code** — every feature shaped through
> natural-language conversation with Claude Code.

## The idea

I wanted Obsidian's editing experience, but in the browser, with my notes
versioned in a GitHub repo I already own. The same mental model — markdown
files in folders, wikilinks between them, tags emerging from \`#word\`
patterns, tasks tracked with \`- [ ]\` checkboxes — but accessible from any
device, with the durability and history that git gives you for free.

What's below is what that turned into.

---

## First run — Welcome tab

![Welcome tab — VS Code-style first-run experience](Tutorial/00-welcome.png)

Open the app for the first time and you land on a Welcome tab — same
shape VS Code uses for its welcome view. No popup, no wall of text:
just a "Start" grid for the common first actions, a row of curated
example vaults you can seed in one click, and a Learn section.
Closing the tab dismisses it for good.

---

## The editor

![Editor with live preview, sidebar tree, tabs](Tutorial/01-editor-hero.png)

A real markdown editor (CodeMirror 6) with **live preview** in the
Obsidian sense — headings, tags, code fences, and wikilinks render
inline as you type. The currently-edited line shows the raw markdown
so you can see the structure; every other line is rendered.

![Live-preview rendering of headings, tags, code, and wikilinks](Tutorial/02-live-preview.png)

Tasks (\`- [ ]\` / \`- [x]\`) toggle with a keyboard shortcut. Tags appear
in the sidebar automatically. Wikilinks (\`[[Note name]]\`) become
clickable jumps between notes.

---

## The workspace

![Sidebar with pinned Calendar panel, tab strip, and folder tree](Tutorial/03-sidebar-pane-model.png)

The sidebar uses Obsidian's stacked pane model:

- A row of **draggable panel icons** (Files, Search, Outline, Tags,
  Bookmarks, Related notes, Source Control, Calendar)
- **Pin** any panel to its own mini-strip at the top — drag-up,
  right-click, or keyboard
- **Multi-panel groups** — drop a panel onto another's strip to share
  a slot
- The pinned area **scrolls independently** so you can stack many
  groups without losing access to the main strip

Tabs work the way they do in Obsidian + VS Code: single-click opens a
preview tab; double-click pins; drag a tab to the right edge to split
the workspace into two horizontal panes.

---

## Quick switcher (Ctrl+K)

![Quick switcher with fuzzy + semantic mode](Tutorial/04-quick-switcher.png)

Fuse.js-powered fuzzy search across titles, content, and tags, with a
**semantic search** mode toggle that uses embeddings to find
conceptually-related notes (not just lexically-matching ones). The
embedding index re-builds itself when notes change.

---

## Templates — including auto-generated weekly review

![Templates modal with Meeting Notes, Daily Journal, Project Plan, Todo List, Weekly Review, Blank Note](Tutorial/05-templates-modal.png)

Six built-in templates. The Weekly Review one is special: it scans
the past 7 days of notes and **auto-aggregates open tasks, completed
tasks, and the most-used tags into a draft review note**. The other
templates are standard skeletons.

Daily / weekly / monthly notes plug into the calendar panel — clicking
a date opens (or creates) that day's note in the configured folder.

---

## Export — including PDF

![Export modal showing markdown / JSON / HTML / PDF options](Tutorial/06-export-modal-pdf.png)

Notes export as Markdown, JSON, or HTML (single note or full vault
zip). The **PDF option** opens the system print dialog so the user
can pick "Save as PDF" — no extra dependencies, prints cleanly with
page breaks between notes.

---

## Theming

![Settings → Appearance with preset themes and per-token color pickers](Tutorial/07-theme-editor.png)

Pick from preset themes (Default dark, Light, Sepia, Solarized dark) or
adjust individual color tokens with the picker grid. Changes apply
**live via CSS variables on \`:root\`** — no reload, and overrides sync
across devices via the vault settings file.

---

## GitHub sync

![Settings → GitHub sync with auto-sync, settings folder, vault gitignore editor, local overlay](Tutorial/08-sync-settings.png)

GitHub is the source of truth. One repo per vault, notes stored as
plain \`.md\` at the repo root, full pull-then-push pipeline:

- **Three-way merge** using the last-pushed SHA — most edits sync
  automatically without conflicts
- **Conflicts open as tabs** with a VS Code-style inline merge editor
  (line diffs, take-local / take-remote / keep-both)
- **Vault settings** travel with the repo — change a setting on one
  device, see it on the next
- **\`.gitignore\`** is respected both ways, with an in-app editor for
  the shared file plus a per-device overlay
- **OAuth device-flow** authentication; token stays in the browser

Plus a **VS Code-style Source Control panel** with commit messages
(optionally drafted by AI), per-file change badges, and an editor
gutter diff showing added / modified lines since the last push.

---

## AI features

Built on top of the user's own Anthropic or OpenAI API key — nothing
is centralised:

- **Per-note actions** — Summarize, Extract tasks, Suggest tags,
  Rewrite for clarity, Translate
- **Embeddings + Related notes panel** — semantic neighbours appear
  in the sidebar automatically as you write
- **Semantic search** in the Ctrl+K quick switcher
- **AI commit messages** — drafts a meaningful summary from the
  pending diff

---

## Productivity flourishes

- **Daily-note streak counter** — a 🔥 chip in the footer when there
  are consecutive daily notes
- **Trash folder** — synthetic \`.trash\` row at the top of the tree;
  deleted notes look like normal rows, restore from context menu
- **Drag-and-drop everywhere** — notes into folders, folders into
  folders, tabs between panes, panels between strips
- **Keyboard-first** — Ctrl+K search, Alt+N new note, Alt+Shift+L
  toggle task, customisable shortcut overrides
`

// Fetch the bundled PNG from the deployed app and store it in
// IndexedDB as an attachment under `Tutorial/<filename>`. Idempotent:
// returns early if the attachment is already present.
async function seedTutorialImage(filename: string): Promise<void> {
  const path = `${TUTORIAL_FOLDER_NAME}/${filename}`
  const existing = await getAttachmentBlob(path)
  if (existing) return
  try {
    const res = await fetch(`/feature-tour/${filename}`)
    if (!res.ok) return
    const blob = await res.blob()
    await putAttachmentAtPath(path, blob, filename)
  } catch {
    // Best-effort — if the asset fetch fails (offline, broken deploy),
    // the note still opens and renders text. The image positions show
    // as "Missing attachment" via AttachmentImage.
  }
}

/**
 * Seed (or focus) the Feature tour note. Returns the note id.
 *
 * Behaviour (intentionally healing — clicking this link should always
 * leave the user with a working tour, regardless of prior state):
 *
 *   1. Ensures the `Tutorial/` folder exists.
 *   2. Awaits image-attachment seeding so the note opens with images
 *      already in IndexedDB (no "Missing attachment" flash). Existing
 *      images are skipped.
 *   3. Finds an existing non-deleted "Feature tour" note ANYWHERE in
 *      the vault. If it's not in Tutorial/, MIGRATES it there. If its
 *      content drifted from FEATURE_TOUR_BODY (e.g. an older seed wrote
 *      raw GitHub URLs), RESETS the content to the current canonical
 *      body. Idempotent — repeated clicks just re-focus the note.
 *   4. If no existing note, creates one in Tutorial/.
 *
 * Returns a promise — call sites usually fire-and-forget.
 */
export async function seedFeatureTourNote(): Promise<string> {
  const { notes, addNote, updateNote } = useNoteStore.getState()
  const { ensureFolderPath } = useFolderStore.getState()
  const { openNote } = useWorkspaceStore.getState()

  // 1. Make sure the Tutorial folder exists. ensureFolderPath is
  //    idempotent — returns the existing folder id when present.
  const folderId = ensureFolderPath([TUTORIAL_FOLDER_NAME])

  // 2. Seed any missing screenshots. AWAIT so the note opens with
  //    images ready; a single broken-image flash is uglier than a
  //    ~1s pause before the note appears.
  await Promise.all(TUTORIAL_IMAGES.map(seedTutorialImage))

  // 3. Heal-or-create: look for ANY existing Feature tour note (not
  //    just one inside Tutorial/) so legacy root-level notes from
  //    earlier seed versions get migrated cleanly.
  const existing = notes.find(
    n => !n.isDeleted && n.title === FEATURE_TOUR_TITLE,
  )
  if (existing) {
    const patch: Partial<typeof existing> = {}
    if (existing.folderId !== folderId) patch.folderId = folderId
    if (existing.content !== FEATURE_TOUR_BODY) patch.content = FEATURE_TOUR_BODY
    if (Object.keys(patch).length > 0) updateNote(existing.id, patch)
    openNote(existing.id, { preview: false })
    return existing.id
  }

  const created = addNote({
    title: FEATURE_TOUR_TITLE,
    folderId,
    content: FEATURE_TOUR_BODY,
  })
  openNote(created.id, { preview: false })
  return created.id
}
