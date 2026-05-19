import React from 'react'

interface SettingsCheckboxProps {
  checked: boolean
  onChange: (v: boolean) => void
}

export const SettingsCheckbox = ({ checked, onChange }: SettingsCheckboxProps) => (
  <input
    type="checkbox"
    checked={checked}
    onChange={(e) => onChange(e.target.checked)}
    className="h-4 w-4 accent-obsidianAccentPurple cursor-pointer"
  />
)
