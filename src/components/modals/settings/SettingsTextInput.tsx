'use client'

import React, { useEffect, useState } from 'react'

interface SettingsTextInputProps {
  value: string
  onCommit: (normalised: string) => void
  normalize?: (raw: string) => string
  placeholder?: string
  mono?: boolean
  // Underlying <input type=...>. Defaults to "text"; pass "password" for
  // secret values (e.g. API keys) so the browser masks the characters.
  type?: 'text' | 'password'
}

export const SettingsTextInput = ({
  value,
  onCommit,
  normalize,
  placeholder,
  mono = false,
  type = 'text',
}: SettingsTextInputProps) => {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    const normalised = normalize ? normalize(draft) : draft
    onCommit(normalised)
    setDraft(normalised)
  }

  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      spellCheck={false}
      placeholder={placeholder}
      className={
        'bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText focus:outline-none focus:border-obsidianAccentPurple' +
        (mono ? ' font-mono' : '')
      }
    />
  )
}
