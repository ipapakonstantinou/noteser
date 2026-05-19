import type { Folder, Note } from '@/types'
import type { FolderSortMode } from '@/stores'
import { sortNotes } from './sortNotes'

// One row in the flattened, keyboard-navigable tree view.
// `kind` distinguishes folders from notes so callers can dispatch on Enter
// (toggle expand vs open). `depth` is 0 for root entries and increases by 1
// for each parent level — used both for indent rendering and arrow-left
// "jump to parent" behaviour.
export interface TreeRow {
  kind: 'folder' | 'note'
  id: string
  depth: number
  parentFolderId: string | null
  name: string
}

export interface FlattenOptions {
  /** When true, dotfile folders (name starts with `.`) are skipped. */
  showHiddenFolders?: boolean
  /** Sort mode for notes inside each folder (and root). Defaults to
   *  'alphabetical' to keep navigation deterministic. */
  noteSortMode?: FolderSortMode
}

const isHiddenFolderName = (name: string): boolean => name.startsWith('.')

// Build the ordered list of visible rows for the folder tree — the same
// order in which FolderTree renders rows. Used both for arrow-key
// navigation and find-as-you-type letter jumps.
//
// Order matches the renderer:
//   1. Each root folder (sorted alphabetically, case-insensitive).
//      When expanded, immediately followed by its visible children
//      (child folders first, then its notes), recursively.
//   2. After all root folders, the root-level notes (sorted by
//      `noteSortMode`).
//
// Attachments are intentionally excluded — they sit inside folders but the
// keyboard story focuses on folders + notes per the spec.
export function getFlattenedTreeOrder(
  folders: Folder[],
  notes: Note[],
  expanded: Record<string, boolean>,
  options: FlattenOptions = {},
): TreeRow[] {
  const { showHiddenFolders = false, noteSortMode = 'alphabetical' } = options

  // Drop soft-deleted entities up front so the recursion stays focused on
  // the rendered set.
  const activeFolders = folders.filter(f => !f.isDeleted)
  const activeNotes = notes.filter(n => !n.isDeleted)

  // Index folders by parent for O(1) child lookups during recursion.
  const childFoldersByParent = new Map<string | null, Folder[]>()
  for (const f of activeFolders) {
    const key = f.parentId ?? null
    const arr = childFoldersByParent.get(key)
    if (arr) arr.push(f)
    else childFoldersByParent.set(key, [f])
  }
  // Sort each child group alphabetically (case-insensitive) — root and
  // nested folders share this rule in the live renderer.
  for (const arr of childFoldersByParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  const filterHidden = (items: Folder[]): Folder[] =>
    showHiddenFolders ? items : items.filter(f => !isHiddenFolderName(f.name))

  const out: TreeRow[] = []

  const visitFolder = (folder: Folder, depth: number): void => {
    out.push({
      kind: 'folder',
      id: folder.id,
      depth,
      parentFolderId: folder.parentId ?? null,
      name: folder.name,
    })
    if (!expanded[folder.id]) return

    // Children: nested folders first, then notes inside this folder.
    const children = filterHidden(childFoldersByParent.get(folder.id) ?? [])
    for (const child of children) visitFolder(child, depth + 1)

    const folderNotes = sortNotes(
      activeNotes.filter(n => n.folderId === folder.id),
      noteSortMode,
    )
    for (const note of folderNotes) {
      out.push({
        kind: 'note',
        id: note.id,
        depth: depth + 1,
        parentFolderId: folder.id,
        name: note.title,
      })
    }
  }

  const rootFolders = filterHidden(childFoldersByParent.get(null) ?? [])
  for (const folder of rootFolders) visitFolder(folder, 0)

  const rootNotes = sortNotes(activeNotes.filter(n => !n.folderId), noteSortMode)
  for (const note of rootNotes) {
    out.push({
      kind: 'note',
      id: note.id,
      depth: 0,
      parentFolderId: null,
      name: note.title,
    })
  }

  return out
}

// Index lookup helper — returns -1 if no row matches the given
// (kind, id) pair. Tiny but extracted so the FolderTree key handler stays
// readable.
export function findRowIndex(
  rows: TreeRow[],
  kind: 'folder' | 'note',
  id: string,
): number {
  return rows.findIndex(r => r.kind === kind && r.id === id)
}

// Find the next row whose name starts with `letter` (case-insensitive),
// beginning the search just after `fromIndex` and wrapping back to the
// start. Returns -1 when no row matches. Used for find-as-you-type.
export function findNextRowByLetter(
  rows: TreeRow[],
  letter: string,
  fromIndex: number,
): number {
  if (rows.length === 0) return -1
  const target = letter.toLowerCase()
  const n = rows.length
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n
    if (rows[idx].name.toLowerCase().startsWith(target)) return idx
  }
  return -1
}
