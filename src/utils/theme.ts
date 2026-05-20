// Theme token registry (th3m) + preset palettes.
//
// Single source of truth for which CSS variables make up the
// noteser palette + a couple of pre-baked alternates. The pickers
// in Settings → Appearance read from THEME_TOKENS; the apply-theme
// hook writes overrides to :root.

export interface ThemeToken {
  // CSS variable name (without the leading --).
  cssVar: string
  // Tailwind token name that references it via var().
  tailwind: string
  // Human label for the Settings UI.
  label: string
  // Fallback default — matches the value in globals.css.
  defaultColor: string
}

export const THEME_TOKENS: readonly ThemeToken[] = [
  { cssVar: 'obsidian-black',           tailwind: 'obsidianBlack',          label: 'Background',         defaultColor: '#1b1b1b' },
  { cssVar: 'obsidian-gray',            tailwind: 'obsidianGray',           label: 'Surface',            defaultColor: '#242424' },
  { cssVar: 'obsidian-dark-gray',       tailwind: 'obsidianDarkGray',       label: 'Raised surface',     defaultColor: '#333333' },
  { cssVar: 'obsidian-accent',          tailwind: 'obsidianAccent',         label: 'Button',             defaultColor: '#3a3a3a' },
  { cssVar: 'obsidian-highlight',       tailwind: 'obsidianHighlight',      label: 'Selection',          defaultColor: '#4d4d4d' },
  { cssVar: 'obsidian-border',          tailwind: 'obsidianBorder',         label: 'Border',             defaultColor: '#444444' },
  { cssVar: 'obsidian-text',            tailwind: 'obsidianText',           label: 'Text',               defaultColor: '#dadada' },
  { cssVar: 'obsidian-secondary-text',  tailwind: 'obsidianSecondaryText',  label: 'Secondary text',     defaultColor: '#bababa' },
  { cssVar: 'obsidian-accent-purple',   tailwind: 'obsidianAccentPurple',   label: 'Interactive accent', defaultColor: '#7b5cf5' },
]

// Pre-baked themes. Each one is a complete override map keyed by
// cssVar — applying replaces every token. Empty record = "use the
// built-in defaults from globals.css."
export interface ThemePreset {
  id: string
  label: string
  description: string
  overrides: Record<string, string>
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'default',
    label: 'Default (dark)',
    description: 'The original obsidian-inspired dark palette.',
    overrides: {}, // empty = use globals.css defaults
  },
  {
    id: 'light',
    label: 'Light',
    description: 'High-contrast light variant. Good for printing.',
    overrides: {
      'obsidian-black':          '#ffffff',
      'obsidian-gray':           '#f4f4f6',
      'obsidian-dark-gray':      '#e6e6ea',
      'obsidian-accent':         '#d9d9df',
      'obsidian-highlight':      '#cfd5e8',
      'obsidian-border':         '#cccccc',
      'obsidian-text':           '#1b1b1b',
      'obsidian-secondary-text': '#5a5a5a',
      'obsidian-accent-purple':  '#6b4cf0',
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    description: 'Warm paper-like tones — easy on the eyes for long reading.',
    overrides: {
      'obsidian-black':          '#f4ecd8',
      'obsidian-gray':           '#ebe1c6',
      'obsidian-dark-gray':      '#e2d6b3',
      'obsidian-accent':         '#d6c9a5',
      'obsidian-highlight':      '#c9b889',
      'obsidian-border':         '#bda978',
      'obsidian-text':           '#3b2f1e',
      'obsidian-secondary-text': '#695740',
      'obsidian-accent-purple':  '#8b5a2b',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized dark',
    description: 'Ethan Schoonover\'s classic — selective contrast on muted base tones.',
    overrides: {
      'obsidian-black':          '#002b36',
      'obsidian-gray':           '#073642',
      'obsidian-dark-gray':      '#0e4555',
      'obsidian-accent':         '#155566',
      'obsidian-highlight':      '#1d6677',
      'obsidian-border':         '#586e75',
      'obsidian-text':           '#eee8d5',
      'obsidian-secondary-text': '#93a1a1',
      'obsidian-accent-purple':  '#6c71c4',
    },
  },
]

// Apply a Record<cssVar, color> to :root. Empty / missing values
// are CLEARED — so removing a single token reverts to the default
// declared in globals.css. Safe to call repeatedly + on every
// override change.
export function applyThemeOverrides(overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const token of THEME_TOKENS) {
    const value = overrides[token.cssVar]
    if (value && value.trim().length > 0) {
      root.style.setProperty(`--${token.cssVar}`, value)
    } else {
      root.style.removeProperty(`--${token.cssVar}`)
    }
  }
}
