import React from 'react'

// Allow string OR number values — `<select>` exposes value as a string,
// so we need to map back to the original type. The trick: when T is
// number, parse the value; for string T we pass it through.
interface SettingsSelectProps<T extends string | number> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  'data-testid'?: string
}

export const SettingsSelect = <T extends string | number>({
  value,
  onChange,
  options,
  'data-testid': dataTestid,
}: SettingsSelectProps<T>) => (
  <select
    value={String(value)}
    onChange={(e) => {
      const raw = e.target.value
      // Match the picked option to recover the original T-typed value.
      const matched = options.find((opt) => String(opt.value) === raw)
      if (matched) onChange(matched.value)
    }}
    data-testid={dataTestid}
    className="bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText focus:outline-none focus:border-obsidianAccentPurple"
  >
    {options.map((opt) => (
      <option key={String(opt.value)} value={String(opt.value)}>
        {opt.label}
      </option>
    ))}
  </select>
)
