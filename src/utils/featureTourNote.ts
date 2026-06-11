/**
 * featureTourNote.ts
 *
 * Bundled "Feature tour" content seeded into a fresh user's vault.
 *
 * Layout after a successful seed:
 *
 *   /Feature tour            ← markdown note at vault root
 *   /Files/                  ← user's attachments folder (current setting)
 *     /feature-tour/
 *       /00-welcome.png      ← 9 bundled screenshots stored as attachments
 *       /01-editor-hero.png
 *       …
 *
 * Why `Files/feature-tour/` rather than a dedicated `Tutorial/` folder:
 * the user explicitly wanted screenshots in the standard attachments
 * location, with the note itself sitting at root — matching how a
 * normal Obsidian vault organises things.
 *
 * The seed is healing: every click finds ANY existing "Feature tour"
 * note in the vault, picks one canonical copy, refreshes its content +
 * folder placement, and soft-deletes duplicates. Image attachments
 * already in IndexedDB are skipped on re-runs so repeat clicks are
 * fast.
 */

import { useNoteStore } from '@/stores/noteStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import {
  putAttachmentAtPath,
  getAttachmentBlob,
  setAttachmentDoNotSync,
  listAttachmentPaths,
} from '@/utils/attachments'
import { attachmentsFolder } from '@/utils/systemFolder'
import {
  FEATURE_TOUR_TITLE,
  TUTORIAL_ASSETS_SUBDIR,
  TUTORIAL_IMAGES,
  isTourAssetPath,
} from '@/utils/featureTourMarkers'
import { STORAGE_KEYS } from '@/utils/storageKeys'
import type { Note } from '@/types'

// Constants live in featureTourMarkers.ts (dependency-free, so the noteStore
// v4 migration can use them without an import cycle). Re-exported here to
// preserve the long-standing public surface of this module.
export { FEATURE_TOUR_TITLE, TUTORIAL_ASSETS_SUBDIR, TUTORIAL_IMAGES }

// Compute the attachment path for a given filename, using the user's
// CURRENT attachments folder setting (default `Files`). Exposed so
// tests can verify the path scheme.
export function tourAssetPath(filename: string): string {
  return `${attachmentsFolder.get()}/${TUTORIAL_ASSETS_SUBDIR}/${filename}`
}

// Build the markdown body. Done as a function (not a constant) so the
// image references track the user's attachments-folder setting if it
// gets renamed between seed runs. The title is carried by Note.title,
// not by an H1 in the body — otherwise it would render twice.
export function buildFeatureTourBody(): string {
  const path = (file: string) => tourAssetPath(file)
  return `> **Browser-based Obsidian, with GitHub sync and task management.**
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

![Welcome tab — VS Code-style first-run experience](${path('00-welcome.png')})

Open the app for the first time and you land on a Welcome tab — same
shape VS Code uses for its welcome view. No popup, no wall of text:
just a "Start" grid for the common first actions, a row of curated
example vaults you can seed in one click, and a Learn section.
Closing the tab dismisses it for good.

---

## The editor

![Editor with live preview, sidebar tree, tabs](${path('01-editor-hero.png')})

A real markdown editor (CodeMirror 6) with **live preview** in the
Obsidian sense — headings, tags, code fences, and wikilinks render
inline as you type. The currently-edited line shows the raw markdown
so you can see the structure; every other line is rendered.

![Live-preview rendering of headings, tags, code, and wikilinks](${path('02-live-preview.png')})

Tasks (\`- [ ]\` / \`- [x]\`) toggle with a keyboard shortcut. Tags appear
in the sidebar automatically. Wikilinks (\`[[Note name]]\`) become
clickable jumps between notes.

---

## The workspace

![Sidebar with pinned Calendar panel, tab strip, and folder tree](${path('03-sidebar-pane-model.png')})

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

![Quick switcher with fuzzy + semantic mode](${path('04-quick-switcher.png')})

Fuse.js-powered fuzzy search across titles, content, and tags, with a
**semantic search** mode toggle that uses embeddings to find
conceptually-related notes (not just lexically-matching ones). The
embedding index re-builds itself when notes change.

---

## Templates — including auto-generated weekly review

![Templates modal with Meeting Notes, Daily Journal, Project Plan, Todo List, Weekly Review, Blank Note](${path('05-templates-modal.png')})

Six built-in templates. The Weekly Review one is special: it scans
the past 7 days of notes and **auto-aggregates open tasks, completed
tasks, and the most-used tags into a draft review note**. The other
templates are standard skeletons.

Daily / weekly / monthly notes plug into the calendar panel — clicking
a date opens (or creates) that day's note in the configured folder.

---

## Export — including PDF

![Export modal showing markdown / JSON / HTML / PDF options](${path('06-export-modal-pdf.png')})

Notes export as Markdown, JSON, or HTML (single note or full vault
zip). The **PDF option** opens the system print dialog so the user
can pick "Save as PDF" — no extra dependencies, prints cleanly with
page breaks between notes.

---

## Theming

![Settings → Appearance with preset themes and per-token color pickers](${path('07-theme-editor.png')})

Pick from preset themes (Default dark, Light, Sepia, Solarized dark) or
adjust individual color tokens with the picker grid. Changes apply
**live via CSS variables on \`:root\`** — no reload, and overrides sync
across devices via the vault settings file.

---

## GitHub sync

![Settings → GitHub sync with auto-sync, settings folder, vault gitignore editor, local overlay](${path('08-sync-settings.png')})

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

---

## Coming back to this tour

Closed the Welcome tab and want it back? Go to **Settings → General →
"Show welcome tab"** to reopen it any time. You can also pin the
Feature tour note (right-click in the sidebar → Pin) so it stays at
the top of your file list.
`
}

// Fetch the bundled PNG from /feature-tour/<filename> and store it
// in IndexedDB at the resolved tourAssetPath. Idempotent: returns
// early when the attachment is already present.
async function seedTutorialImage(filename: string): Promise<void> {
  const path = tourAssetPath(filename)
  const existing = await getAttachmentBlob(path)
  if (existing) {
    // Healing for legacy seeds (#179): records stored before the doNotSync
    // flag existed must pick it up so they stop pushing to the vault repo.
    await setAttachmentDoNotSync(path, true)
    return
  }
  try {
    const res = await fetch(`/feature-tour/${filename}`)
    if (!res.ok) return
    const blob = await res.blob()
    // doNotSync (#179): demo screenshots are app-local — they must never be
    // pushed into the user's real vault repo.
    await putAttachmentAtPath(path, blob, filename, { doNotSync: true })
  } catch {
    // Best-effort — if the fetch fails, the note still opens. Missing
    // images render as "Missing attachment" via AttachmentImage.
  }
}

/**
 * Seed (or focus) the Feature tour note. Returns the note id.
 *
 * Behaviour (intentionally healing — clicking should always leave the
 * user with one working tour, regardless of prior IDB state):
 *
 *   1. Seeds missing screenshots into `Files/feature-tour/`.
 *   2. Awaits the fetches so the note opens with images already in
 *      IDB (no broken-image flash).
 *   3. Finds ALL existing non-deleted "Feature tour" notes anywhere.
 *      Picks one as canonical (preferring vault-root, else newest).
 *      Refreshes its folderId (→ null = root) + content. Soft-deletes
 *      every other duplicate.
 *   4. If no existing note, creates one at root.
 *
 * Returns a promise — call sites usually await to know the seed
 * completed before doing UI follow-up.
 */
export async function seedFeatureTourNote(): Promise<string> {
  const noteState = useNoteStore.getState()
  const { openNote } = useWorkspaceStore.getState()
  const body = buildFeatureTourBody()

  // 1. Seed missing screenshots in parallel.
  await Promise.all(TUTORIAL_IMAGES.map(seedTutorialImage))

  // 2. Find ALL Feature tour notes (re-read state — fresh).
  const freshNotes = useNoteStore.getState().notes
  const candidates: Note[] = freshNotes.filter(
    n => !n.isDeleted && n.title === FEATURE_TOUR_TITLE,
  )

  if (candidates.length > 0) {
    // Prefer the one already at root (folderId === null), else the
    // most recently updated (preserves any user edits between
    // duplicates).
    const canonical =
      candidates.find(n => n.folderId === null)
      ?? [...candidates].sort((a, b) => b.updatedAt - a.updatedAt)[0]

    const updateNote = useNoteStore.getState().updateNote
    const deleteNote = useNoteStore.getState().deleteNote

    // Heal canonical: ensure at root + canonical content + sync opt-out.
    const patch: Partial<Note> = {}
    if (canonical.folderId !== null) patch.folderId = null
    if (canonical.content !== body) patch.content = body
    // doNotSync (#179): legacy seeds predate the flag — heal it on so the
    // tour note stops being pushed into the user's real vault repo.
    if (canonical.doNotSync !== true) patch.doNotSync = true
    if (Object.keys(patch).length > 0) updateNote(canonical.id, patch)

    // Soft-delete duplicates.
    for (const dup of candidates) {
      if (dup.id !== canonical.id) deleteNote(dup.id)
    }

    openNote(canonical.id, { preview: false })
    return canonical.id
  }

  // 3. Fresh user — create at root. doNotSync (#179): the tour note is
  // app-local demo content and must never sync to the user's vault repo.
  const created = noteState.addNote({
    title: FEATURE_TOUR_TITLE,
    folderId: null,
    content: body,
    doNotSync: true,
  })
  openNote(created.id, { preview: false })
  return created.id
}

/**
 * One-time boot migration (#179): retro-flag tour screenshots that a LEGACY
 * seed stored before the doNotSync flag existed, so they stop being pushed
 * into the user's real vault repo on the next sync.
 *
 * Detection is deliberately narrow — exact bundled filenames whose immediate
 * parent directory is `feature-tour/` (see isTourAssetPath). This path match
 * is ONLY a migration heuristic over local IDB records; the push path itself
 * never excludes by path, it honours the per-record flag.
 *
 * Does NOT touch the remote: a legacy user whose vault repo already holds
 * the images keeps them until they delete them manually — we never
 * auto-delete remote files.
 *
 * Guarded by a localStorage key written only on success, so a failed/stalled
 * IDB pass retries on the next boot. Best-effort by design: a failure here
 * must never block app startup.
 */
export async function flagLegacyTourAttachments(): Promise<void> {
  try {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(STORAGE_KEYS.tourAttachmentsFlagged) === '1') return
  } catch {
    return
  }
  try {
    const paths = await listAttachmentPaths()
    for (const path of paths) {
      if (isTourAssetPath(path)) await setAttachmentDoNotSync(path, true)
    }
    localStorage.setItem(STORAGE_KEYS.tourAttachmentsFlagged, '1')
  } catch {
    // Best-effort — the guard key is only written on success, so the next
    // boot retries.
  }
}
