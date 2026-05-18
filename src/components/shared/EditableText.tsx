'use client'

import { useEffect, useRef, useState } from 'react'
import { sanitizeTitleInput } from '@/utils/export'

interface EditableTextProps {
  value: string
  onSave: (newValue: string) => void
  className?: string
  placeholder?: string
  // Force the field into edit mode. Caller flips this true to start editing
  // (e.g. when the user picks "Rename" from the context menu) and false (or
  // we self-clear on commit/blur) when finished.
  isEditing?: boolean
  onEditingChange?: (isEditing: boolean) => void
}

export const EditableText = ({
  value,
  onSave,
  className = '',
  placeholder = '',
  isEditing: controlledEditing,
  onEditingChange,
}: EditableTextProps) => {
  const [internalEditing, setInternalEditing] = useState(false)
  const isEditing = controlledEditing ?? internalEditing
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const setEditing = (v: boolean) => {
    if (controlledEditing === undefined) setInternalEditing(v)
    onEditingChange?.(v)
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setText(value)
  }, [value])

  const commit = () => {
    setEditing(false)
    const trimmed = text.trim()
    if (trimmed !== value && trimmed !== '') onSave(trimmed)
    else setText(value)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setEditing(false)
      setText(value)
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(sanitizeTitleInput(e.target.value))}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
        className="bg-obsidianDarkGray border border-obsidianBorder rounded px-1 py-0 text-sm text-obsidianText focus:outline-none focus:ring-1 focus:ring-obsidianAccentPurple w-full"
        placeholder={placeholder}
      />
    )
  }

  // Display only. No double-click handler — rename goes through the
  // right-click context menu, which triggers edit mode via the controlled
  // `isEditing` prop.
  return (
    <span className={`truncate ${className}`}>
      {value || placeholder}
    </span>
  )
}

export default EditableText
