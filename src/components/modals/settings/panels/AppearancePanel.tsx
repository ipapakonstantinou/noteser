'use client'

import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores'
import { THEME_TOKENS, THEME_PRESETS } from '@/utils/theme'
import { FONT_SLOTS_DEF, type FontSlot } from '@/utils/fonts'
import {
  Field,
  SettingsSelect,
} from '../index'
import { PanelHeading } from '../PanelHeading'

export function AppearancePanel() {
  const overrides = useSettingsStore(s => s.themeOverrides)
  const setThemeToken = useSettingsStore(s => s.setThemeToken)
  const setThemeOverrides = useSettingsStore(s => s.setThemeOverrides)
  const resetThemeOverrides = useSettingsStore(s => s.resetThemeOverrides)

  // Read the live computed value off :root when no override is set
  // so the color picker shows the actual rendered color, not just
  // the hard-coded default. Falls back to the token's
  // defaultColor when SSR / no DOM.
  const getEffective = (cssVar: string, fallback: string): string => {
    const ov = overrides?.[cssVar]
    if (ov) return ov
    if (typeof document === 'undefined') return fallback
    const computed = getComputedStyle(document.documentElement).getPropertyValue(`--${cssVar}`).trim()
    return computed || fallback
  }

  return (
    <div className="space-y-4" data-testid="settings-panel-appearance">
      <PanelHeading>Appearance</PanelHeading>
      <p className="text-xs text-obsidianSecondaryText -mt-2">
        Pick a preset or tweak individual colors. Changes apply
        instantly and sync across devices via your vault settings file.
      </p>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          Presets
        </div>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setThemeOverrides(preset.overrides)}
              title={preset.description}
              data-testid={`theme-preset-${preset.id}`}
              className="px-3 py-1.5 text-sm rounded border border-obsidianBorder bg-obsidianDarkGray hover:bg-obsidianHighlight text-obsidianText"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-3 mt-3 border-t border-obsidianBorder">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
            Individual tokens
          </div>
          <button
            type="button"
            onClick={resetThemeOverrides}
            className="text-xs text-obsidianAccentPurple hover:underline"
            data-testid="theme-reset"
          >
            Reset all
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {THEME_TOKENS.map(token => {
            const value = getEffective(token.cssVar, token.defaultColor)
            return (
              <label
                key={token.cssVar}
                className="flex items-center gap-2 text-sm text-obsidianText"
              >
                <input
                  type="color"
                  // <input type=color> requires a 7-char #rrggbb. If
                  // the effective color is an hsl()/named/8-char hex
                  // we coerce to a safe default for the picker; the
                  // actual stored override stays in the original
                  // format until the user picks a new value.
                  value={normalizeForPicker(value, token.defaultColor)}
                  onChange={e => setThemeToken(token.cssVar, e.target.value)}
                  className="w-8 h-8 rounded border border-obsidianBorder bg-transparent cursor-pointer"
                  data-testid={`theme-input-${token.cssVar}`}
                />
                <span className="flex-1 truncate">{token.label}</span>
              </label>
            )
          })}
        </div>
      </div>

      <FontsSection />
    </div>
  )
}

// Font pickers (fnt1). One row per slot: a curated dropdown plus a
// free-text Custom field for any locally-installed family. The dropdown
// shows "Custom…" whenever the stored value isn't one of the curated
// options, and reveals the text input so the user can type a family.
function FontsSection() {
  const fontText = useSettingsStore(s => s.fontText)
  const fontMono = useSettingsStore(s => s.fontMono)
  const fontInterface = useSettingsStore(s => s.fontInterface)
  const setFontText = useSettingsStore(s => s.setFontText)
  const setFontMono = useSettingsStore(s => s.setFontMono)
  const setFontInterface = useSettingsStore(s => s.setFontInterface)

  const values: Record<string, string> = {
    text: fontText,
    mono: fontMono,
    interface: fontInterface,
  }
  const setters: Record<string, (v: string) => void> = {
    text: setFontText,
    mono: setFontMono,
    interface: setFontInterface,
  }

  return (
    <div
      className="space-y-4 pt-3 mt-3 border-t border-obsidianBorder"
      data-testid="settings-fonts"
    >
      <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
        Fonts
      </div>
      <p className="text-xs text-obsidianSecondaryText -mt-2">
        Choose a curated family or type the name of any font installed on
        this device. No fonts are downloaded. &ldquo;System default&rdquo;
        keeps today&apos;s look.
      </p>
      {FONT_SLOTS_DEF.map(slot => (
        <FontSlotRow
          key={slot.id}
          slot={slot}
          value={values[slot.id]}
          onChange={setters[slot.id]}
        />
      ))}
    </div>
  )
}

function FontSlotRow({
  slot,
  value,
  onChange,
}: {
  slot: FontSlot
  value: string
  onChange: (v: string) => void
}) {
  // Is the stored value one of the curated options? If not, the user is
  // in "Custom" mode and we surface the text field pre-filled with it.
  const isCurated = slot.options.some(o => o.value === value)
  const [custom, setCustom] = useState(isCurated ? '' : value)
  // Selecting "Custom…" flips this on without immediately writing a value
  // (an empty custom field would be treated as system default until typed).
  const [customMode, setCustomMode] = useState(!isCurated)
  const [draft, setDraft] = useState(custom)

  // Keep local state in sync if the store value changes underneath us
  // (e.g. a sync pull or Reset). Recompute curated-ness from the new value.
  useEffect(() => {
    const curated = slot.options.some(o => o.value === value)
    setCustomMode(!curated)
    if (!curated) {
      setCustom(value)
      setDraft(value)
    }
  }, [value, slot.options])

  const CUSTOM_SENTINEL = '__custom__'
  const selectValue = customMode ? CUSTOM_SENTINEL : value

  return (
    <Field label={slot.label} description={slot.description}>
      <div className="space-y-2">
        <SettingsSelect<string>
          value={selectValue}
          data-testid={`font-select-${slot.id}`}
          onChange={(v) => {
            if (v === CUSTOM_SENTINEL) {
              setCustomMode(true)
              // Don't write yet — wait for the user to type a family.
            } else {
              setCustomMode(false)
              onChange(v)
            }
          }}
          options={[
            ...slot.options,
            { value: CUSTOM_SENTINEL, label: 'Custom…' },
          ]}
        />
        {customMode && (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const v = draft.trim()
              setCustom(v)
              onChange(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            spellCheck={false}
            placeholder="e.g. JetBrains Mono"
            data-testid={`font-custom-${slot.id}`}
            className="block w-full bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
          />
        )}
      </div>
    </Field>
  )
}

// <input type=color> needs a 7-char #rrggbb. Anything else (hsl(),
// named, 8-char alpha hex) falls back to the token's defaultColor
// so the picker stays sensible.
function normalizeForPicker(value: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  return /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : '#000000'
}
