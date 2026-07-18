import React from 'react'

interface SettingsFooterProps {
  onReset: () => void
  onApply: () => void
  onSaveAndClose: () => void
  resetConfirm?: string
}

export const SettingsFooter = ({
  onReset,
  onApply,
  onSaveAndClose,
  resetConfirm = 'Reset all settings to defaults?',
}: SettingsFooterProps) => (
  <div className="pt-4 border-t border-obsidianBorder flex justify-between items-center gap-2">
    <button
      onClick={() => {
        if (confirm(resetConfirm)) onReset()
      }}
      className="text-sm px-3 py-1.5 rounded-sm border border-obsidianBorder text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianDarkGray"
    >
      Reset to defaults
    </button>
    <div className="flex items-center gap-2">
      <button
        onClick={onApply}
        className="text-sm px-3 py-1.5 rounded-sm border border-obsidianBorder text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianDarkGray"
      >
        Apply
      </button>
      <button
        onClick={onSaveAndClose}
        className="text-sm px-3 py-1.5 rounded-sm bg-obsidianAccentPurple text-white hover:opacity-90"
        data-testid="settings-save-and-close"
      >
        Save and close
      </button>
    </div>
  </div>
)
