import React from 'react'

interface SettingsFooterProps {
  onReset: () => void
  onApply: () => void
  resetConfirm?: string
}

export const SettingsFooter = ({
  onReset,
  onApply,
  resetConfirm = 'Reset all settings to defaults?',
}: SettingsFooterProps) => (
  <div className="pt-4 border-t border-obsidianBorder flex justify-between items-center gap-2">
    <button
      onClick={() => {
        if (confirm(resetConfirm)) onReset()
      }}
      className="text-sm px-3 py-1.5 rounded border border-obsidianBorder text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianDarkGray"
    >
      Reset to defaults
    </button>
    <button
      onClick={onApply}
      className="text-sm px-3 py-1.5 rounded bg-obsidianAccentPurple text-white hover:opacity-90"
    >
      Apply
    </button>
  </div>
)
