/**
 * shortcuts.ts
 *
 * Data-driven keyboard-shortcut definitions and combo-parsing helpers.
 *
 * The legacy `useKeyboardShortcuts` hook had a long `if/else` ladder. We move
 * the per-shortcut metadata into `SHORTCUTS` so the hook can iterate, match,
 * and dispatch generically, and so the Settings UI can present every binding
 * with an override path.
 *
 * Cross-platform note: `Ctrl` and `Meta` (Cmd on macOS) are treated as the
 * same modifier for matching purposes. A combo defined as `Ctrl+K` therefore
 * also fires for `Cmd+K`. This matches user expectation (and the existing
 * hook's behaviour). The canonical combo string remains `Ctrl+...`.
 */

/** Actions the keyboard hook knows how to dispatch. Keeping this a union
 *  lets `useKeyboardShortcuts` exhaustively switch on it. */
export type ShortcutAction =
  | 'newNote'
  | 'openSearch'
  | 'toggleSidebar'
  | 'togglePreview'
  | 'newFolder'
  | 'deleteNote'
  | 'openToday'
  | 'openRandomNote'
  | 'focusSidebar'
  | 'openCommandPalette'
  | 'closeTab'
  | 'openSettings'

export interface ShortcutDef {
  id: string
  label: string
  description?: string
  defaultCombo: string
  action: ShortcutAction
}

/** Canonical list of user-configurable shortcuts. The hook reads this; the
 *  Settings UI renders it. Order = display order. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'newNote',
    label: 'New note',
    description: 'Create a new untitled note at the vault root.',
    defaultCombo: 'Alt+N',
    action: 'newNote',
  },
  {
    id: 'openSearch',
    label: 'Open search',
    description: 'Open the search palette.',
    defaultCombo: 'Ctrl+K',
    action: 'openSearch',
  },
  {
    id: 'toggleSidebar',
    label: 'Toggle sidebar',
    description: 'Show or hide the left sidebar.',
    defaultCombo: 'Ctrl+B',
    action: 'toggleSidebar',
  },
  {
    id: 'togglePreview',
    label: 'Toggle preview',
    description: 'Switch the active editor between live preview and rendered preview.',
    defaultCombo: 'Ctrl+E',
    action: 'togglePreview',
  },
  {
    id: 'newFolder',
    label: 'New folder',
    description: 'Create a new folder at the vault root.',
    defaultCombo: 'Ctrl+Shift+N',
    action: 'newFolder',
  },
  {
    id: 'deleteNote',
    label: 'Delete selected note',
    description: 'Soft-delete the currently selected note.',
    defaultCombo: 'Ctrl+Delete',
    action: 'deleteNote',
  },
  {
    id: 'openToday',
    label: "Open today's daily note",
    description: "Open (and create if missing) today's daily note.",
    defaultCombo: 'Alt+D',
    action: 'openToday',
  },
  {
    id: 'openRandomNote',
    label: 'Open a random note',
    description: "Jump to a random non-deleted note — Wikipedia's \"Random article\" for your vault.",
    defaultCombo: 'Alt+R',
    action: 'openRandomNote',
  },
  {
    id: 'focusSidebar',
    label: 'Focus folder tree',
    description: 'Move keyboard focus to the sidebar folder tree so arrow keys drive navigation.',
    defaultCombo: 'Ctrl+1',
    action: 'focusSidebar',
  },
  {
    id: 'openCommandPalette',
    label: 'Open command palette',
    description: 'Show all commands with fuzzy search.',
    defaultCombo: 'Ctrl+Shift+P',
    action: 'openCommandPalette',
  },
  {
    id: 'closeTab',
    label: 'Close active tab',
    description: 'Close the currently focused tab. Matches Obsidian / VS Code.',
    defaultCombo: 'Ctrl+W',
    action: 'closeTab',
  },
  {
    id: 'openSettings',
    label: 'Open settings',
    description: 'Open the Settings modal. Matches Obsidian.',
    defaultCombo: 'Ctrl+,',
    action: 'openSettings',
  },
]

export interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  /** Canonical lowercase key. For letters: 'k'. For special keys: 'arrowup',
   *  'escape', 'enter', 'delete', 'f1' … */
  key: string
}

// Names we accept (case-insensitive) as modifier tokens in a combo string.
const MOD_TOKENS = new Set([
  'ctrl', 'control',
  'shift',
  'alt', 'option', 'opt',
  'meta', 'cmd', 'command', 'super', 'win',
  'mod', // alias for Ctrl/Meta (we set both)
])

/** Lower-case + map a couple of common aliases so display/match are stable.
 *  Inverse of `keyDisplay`. */
function normaliseKey(raw: string): string {
  const k = raw.toLowerCase()
  // Map common variants to a single canonical form.
  if (k === 'esc') return 'escape'
  if (k === 'del') return 'delete'
  if (k === 'ins') return 'insert'
  if (k === 'spacebar' || k === 'space') return ' '
  return k
}

/** Parse a combo string like 'Ctrl+Shift+K' or 'Mod+Enter' into a
 *  ParsedCombo. Tokens are case-insensitive. Unknown tokens are treated as
 *  the key (last one wins). */
export function parseCombo(str: string): ParsedCombo {
  const parsed: ParsedCombo = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  }
  if (!str) return parsed
  const tokens = str.split('+').map(t => t.trim()).filter(Boolean)
  for (const tok of tokens) {
    const low = tok.toLowerCase()
    if (MOD_TOKENS.has(low)) {
      if (low === 'ctrl' || low === 'control') parsed.ctrl = true
      else if (low === 'shift') parsed.shift = true
      else if (low === 'alt' || low === 'option' || low === 'opt') parsed.alt = true
      else if (low === 'meta' || low === 'cmd' || low === 'command' || low === 'super' || low === 'win') parsed.meta = true
      else if (low === 'mod') { parsed.ctrl = true; parsed.meta = true }
    } else {
      parsed.key = normaliseKey(tok)
    }
  }
  return parsed
}

/** True if `event` matches `combo`. Ctrl and Meta are treated as a single
 *  "Mod" modifier — a combo requiring Ctrl also fires for Meta and vice
 *  versa. This keeps Mac (Cmd+K) and Linux/Windows (Ctrl+K) symmetric. */
export function matchEvent(combo: ParsedCombo, event: KeyboardEvent): boolean {
  const wantMod = combo.ctrl || combo.meta
  const haveMod = event.ctrlKey || event.metaKey
  if (wantMod !== haveMod) return false
  if (combo.shift !== event.shiftKey) return false
  if (combo.alt !== event.altKey) return false
  const eventKey = normaliseKey(event.key)
  return eventKey === combo.key
}

/** Modifier keys whose own `event.key` value should not be treated as the
 *  "main" key when we're building a combo from an event. */
const MODIFIER_KEY_NAMES = new Set([
  'control', 'shift', 'alt', 'meta',
  'altgraph', 'capslock', 'numlock', 'scrolllock',
  'os', 'fn',
])

/** True if at least one modifier is held. Used by the rebind UI to validate
 *  that the user isn't trying to bind a bare letter (which would swallow all
 *  typing). Function keys (F1–F24) are also allowed without a modifier. */
function isAcceptableComboKey(key: string, hasModifier: boolean): boolean {
  if (hasModifier) return true
  // F-keys are acceptable bare (Obsidian behaviour).
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return true
  return false
}

/** Format a real KeyboardEvent into the canonical combo string. Returns
 *  `null` for modifier-only presses (so the rebind UI can ignore them and
 *  wait for the next event). */
export function formatEventAsCombo(event: KeyboardEvent): string | null {
  const rawKey = event.key
  if (!rawKey) return null
  if (MODIFIER_KEY_NAMES.has(rawKey.toLowerCase())) return null

  const parts: string[] = []
  // Treat Ctrl and Meta as Mod for the matcher, but preserve whichever the
  // user actually pressed in the canonical string. Ctrl takes precedence
  // because that's the form most cross-platform docs show.
  if (event.ctrlKey) parts.push('Ctrl')
  else if (event.metaKey) parts.push('Meta')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')

  const hasModifier = parts.length > 0
  const key = normaliseKey(rawKey)
  if (!isAcceptableComboKey(key, hasModifier)) return null

  parts.push(keyDisplay(key))
  return parts.join('+')
}

/** Pretty-print a canonical key for display. Inverse of `normaliseKey` for
 *  the common cases; letters get uppercased. */
function keyDisplay(key: string): string {
  if (key.length === 1) return key.toUpperCase()
  // Title-case the special names: 'arrowup' -> 'ArrowUp', 'escape' -> 'Escape'.
  if (key.startsWith('arrow')) {
    return 'Arrow' + key.slice(5).charAt(0).toUpperCase() + key.slice(6)
  }
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** Pretty version of a combo string for the Settings UI. We keep the literal
 *  form (Ctrl/Alt/Shift) on all platforms — simpler, and matches the way the
 *  app stores them. The keys themselves get normalised into title case so
 *  user-typed input like `ctrl+k` round-trips to `Ctrl+K`. */
export function comboToDisplay(combo: string): string {
  if (!combo) return ''
  const tokens = combo.split('+').map(t => t.trim()).filter(Boolean)
  const display: string[] = []
  for (const tok of tokens) {
    const low = tok.toLowerCase()
    if (low === 'ctrl' || low === 'control') display.push('Ctrl')
    else if (low === 'shift') display.push('Shift')
    else if (low === 'alt' || low === 'option' || low === 'opt') display.push('Alt')
    else if (low === 'meta' || low === 'cmd' || low === 'command' || low === 'super' || low === 'win') display.push('Meta')
    else if (low === 'mod') display.push('Mod')
    else display.push(keyDisplay(normaliseKey(tok)))
  }
  return display.join('+')
}

/** Resolve the active combo for a shortcut, honoring any override. */
export function activeComboFor(
  def: ShortcutDef,
  overrides: Record<string, string>,
): string {
  const o = overrides[def.id]
  return o && o.length > 0 ? o : def.defaultCombo
}
