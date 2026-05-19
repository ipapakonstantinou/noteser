'use client'

/**
 * ShortcutsSection.tsx
 *
 * Settings UI for rebinding any of the data-driven keyboard shortcuts in
 * `src/utils/shortcuts.ts`. Each row shows the shortcut's label, its current
 * combo (default OR override), a "Reset" button when an override is set,
 * and a click-to-rebind affordance.
 *
 * The rebind flow: clicking a combo enters "capture" mode for that row. The
 * very next keydown is intercepted at the row level and turned into a combo
 * via `formatEventAsCombo`. Escape cancels. Modifier-only presses are
 * ignored (we wait for the user to pair them with a real key).
 */

import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores'
import {
  SHORTCUTS,
  activeComboFor,
  comboToDisplay,
  formatEventAsCombo,
} from '@/utils/shortcuts'

export const ShortcutsSection = () => {
  const shortcutOverrides = useSettingsStore(s => s.shortcutOverrides)
  const setShortcutOverride = useSettingsStore(s => s.setShortcutOverride)
  const clearShortcutOverride = useSettingsStore(s => s.clearShortcutOverride)
  const resetShortcutOverrides = useSettingsStore(s => s.resetShortcutOverrides)

  // Which shortcut row (if any) is in capture mode.
  const [capturingId, setCapturingId] = useState<string | null>(null)

  return (
    <div className="space-y-2">
      {SHORTCUTS.map((def) => {
        const isCapturing = capturingId === def.id
        const active = activeComboFor(def, shortcutOverrides)
        const isOverridden = Object.prototype.hasOwnProperty.call(shortcutOverrides, def.id)

        return (
          <ShortcutRow
            key={def.id}
            label={def.label}
            description={def.description}
            activeCombo={active}
            isCapturing={isCapturing}
            isOverridden={isOverridden}
            onStartCapture={() => setCapturingId(def.id)}
            onCancelCapture={() => setCapturingId(null)}
            onCapture={(combo) => {
              setShortcutOverride(def.id, combo)
              setCapturingId(null)
            }}
            onReset={() => clearShortcutOverride(def.id)}
          />
        )
      })}
      <div className="pt-3">
        <button
          type="button"
          onClick={() => {
            if (confirm('Reset all keyboard shortcuts to their defaults?')) {
              resetShortcutOverrides()
              setCapturingId(null)
            }
          }}
          className="text-xs px-2 py-1 rounded border border-obsidianBorder text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianDarkGray"
        >
          Reset all shortcuts
        </button>
      </div>
    </div>
  )
}

interface ShortcutRowProps {
  label: string
  description?: string
  activeCombo: string
  isCapturing: boolean
  isOverridden: boolean
  onStartCapture: () => void
  onCancelCapture: () => void
  onCapture: (combo: string) => void
  onReset: () => void
}

function ShortcutRow({
  label,
  description,
  activeCombo,
  isCapturing,
  isOverridden,
  onStartCapture,
  onCancelCapture,
  onCapture,
  onReset,
}: ShortcutRowProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // While capturing, focus the button so the row-level keydown handler is
  // the natural target (and Escape works). Also blur after we leave capture.
  useEffect(() => {
    if (isCapturing) {
      buttonRef.current?.focus()
    }
  }, [isCapturing])

  // Capture the next acceptable keystroke. We attach the listener at window
  // level (capture phase) so we beat the global useKeyboardShortcuts hook;
  // otherwise pressing the existing binding would fire the action.
  useEffect(() => {
    if (!isCapturing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancelCapture()
        return
      }
      const combo = formatEventAsCombo(event)
      if (!combo) return // modifier-only, keep waiting
      event.preventDefault()
      event.stopPropagation()
      onCapture(combo)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isCapturing, onCancelCapture, onCapture])

  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="text-obsidianText text-sm">{label}</div>
        {description && (
          <div className="text-obsidianSecondaryText text-xs mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {isOverridden && !isCapturing && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-obsidianSecondaryText hover:text-obsidianText underline"
            title="Reset to default"
          >
            Reset
          </button>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (isCapturing) onCancelCapture()
            else onStartCapture()
          }}
          className={
            'text-xs font-mono px-2 py-1 rounded border min-w-[7rem] text-center ' +
            (isCapturing
              ? 'border-obsidianAccentPurple text-obsidianAccentPurple bg-obsidianDarkGray'
              : 'border-obsidianBorder text-obsidianText hover:bg-obsidianDarkGray')
          }
        >
          {isCapturing ? 'Press a key combo…' : comboToDisplay(activeCombo)}
        </button>
      </div>
    </div>
  )
}

export default ShortcutsSection
