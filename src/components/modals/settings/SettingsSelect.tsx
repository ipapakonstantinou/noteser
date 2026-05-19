import React from 'react'

interface SettingsSelectProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}

export const SettingsSelect = <T extends string>({
  value,
  onChange,
  options,
}: SettingsSelectProps<T>) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as T)}
    className="bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText focus:outline-none focus:border-obsidianAccentPurple"
  >
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
)
