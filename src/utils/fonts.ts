// Font settings (fnt1).
//
// Three user-pickable font families applied as CSS variables on :root:
//   --font-text       reading-mode body + editor content
//   --font-mono       code blocks, inline code, live-preview/editor monospace
//   --font-interface  the app chrome (sidebar, modals, buttons)
//
// globals.css declares the DEFAULTS for each variable, so an unset /
// empty override reproduces today's look exactly — these stacks below
// match the historical hard-coded values that used to live in
// globals.css, markdownLivePreview.ts, and CodeMirrorEditor.tsx.
//
// We deliberately ship NO web-font downloads. The curated choices are
// system / widely-installed families plus generic-family fallbacks, and
// the "Custom" escape hatch lets a user name any font installed on
// their own machine (Obsidian's "Appearance → Font" model).

// CSS-variable name (without the leading --) per slot. Kept as a const
// map so the apply helper, the hook, and tests all reference one source.
export const FONT_SLOTS = {
  text: 'font-text',
  mono: 'font-mono',
  interface: 'font-interface',
} as const

export type FontSlotId = keyof typeof FONT_SLOTS

// Generic fallbacks appended to a user's chosen family so a typo /
// missing font still degrades to a sensible system family rather than
// the browser default serif. Per-slot because the text slot wants a
// monospace fallback today (the editor is a monospace source view) while
// the interface slot wants sans-serif.
export const FONT_FALLBACKS: Record<FontSlotId, string> = {
  // The editor + reading mode are historically a monospace source view,
  // so the text slot falls back through the same monospace stack as the
  // mono slot. A user who picks a serif/sans still gets it; the fallback
  // only matters when their pick is unavailable.
  text: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace',
  mono: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace',
  interface: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

export interface FontSlot {
  id: FontSlotId
  cssVar: string
  label: string
  description: string
  // The value used when no override is set. Matches globals.css so the
  // Settings UI can show "System default" as the selected option and the
  // rendered app looks unchanged.
  defaultStack: string
  // Curated dropdown choices (3-5). The empty-string value means "System
  // default" → clears the override → falls back to defaultStack.
  options: { value: string; label: string }[]
}

// "System default" is represented by an empty override (cleared variable).
export const SYSTEM_DEFAULT_VALUE = ''

export const FONT_SLOTS_DEF: readonly FontSlot[] = [
  {
    id: 'text',
    cssVar: FONT_SLOTS.text,
    label: 'Text font',
    description:
      'The note editor and reading-mode body text. Defaults to the monospace source view noteser has always used.',
    defaultStack: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace',
    options: [
      { value: SYSTEM_DEFAULT_VALUE, label: 'System default (monospace)' },
      { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: 'System sans-serif' },
      { value: 'Georgia, "Times New Roman", serif', label: 'Serif (Georgia)' },
      { value: '"Iowan Old Style", "Palatino Linotype", Palatino, serif', label: 'Book serif' },
    ],
  },
  {
    id: 'mono',
    cssVar: FONT_SLOTS.mono,
    label: 'Monospace / code font',
    description:
      'Code blocks, inline code, and the editor / live-preview monospace.',
    defaultStack: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace',
    options: [
      { value: SYSTEM_DEFAULT_VALUE, label: 'System default' },
      { value: '"JetBrains Mono", ui-monospace, monospace', label: 'JetBrains Mono' },
      { value: '"Fira Code", ui-monospace, monospace', label: 'Fira Code' },
      { value: 'Consolas, "Courier New", monospace', label: 'Consolas' },
    ],
  },
  {
    id: 'interface',
    cssVar: FONT_SLOTS.interface,
    label: 'Interface font',
    description:
      'The app chrome — sidebar, menus, modals, and buttons. Defaults to Inter / the system UI stack.',
    defaultStack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    options: [
      { value: SYSTEM_DEFAULT_VALUE, label: 'System default (Inter)' },
      { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: 'System sans-serif' },
      { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica / Arial' },
      { value: 'Georgia, "Times New Roman", serif', label: 'Serif (Georgia)' },
    ],
  },
] as const

// Build the effective font-family string for a slot from a raw user
// value. A custom family is appended with the slot's generic fallback so
// an unavailable / mistyped font degrades gracefully. An empty value
// means "system default" and should CLEAR the variable (handled by the
// apply helper) — this function returns '' for that case.
export function buildFontStack(slotId: FontSlotId, rawValue: string): string {
  const value = rawValue.trim()
  if (!value) return ''
  // If the user already typed a comma-separated stack (e.g. one of our
  // curated options), trust it as-is — don't double-append fallbacks.
  if (value.includes(',')) return value
  // A single family name: quote it if it contains spaces and wasn't
  // already quoted, then append the slot fallback.
  const needsQuote = /\s/.test(value) && !/^['"].*['"]$/.test(value)
  const family = needsQuote ? `"${value}"` : value
  return `${family}, ${FONT_FALLBACKS[slotId]}`
}

// Apply the three font overrides to :root. An empty / missing value for
// a slot CLEARS its variable so the default declared in globals.css
// takes over. Safe to call repeatedly + on every override change.
export function applyFontOverrides(fonts: {
  fontText?: string
  fontMono?: string
  fontInterface?: string
}): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const apply = (slotId: FontSlotId, raw: string | undefined) => {
    const stack = buildFontStack(slotId, raw ?? '')
    if (stack) {
      root.style.setProperty(`--${FONT_SLOTS[slotId]}`, stack)
    } else {
      root.style.removeProperty(`--${FONT_SLOTS[slotId]}`)
    }
  }
  apply('text', fonts.fontText)
  apply('mono', fonts.fontMono)
  apply('interface', fonts.fontInterface)
}
