'use client'

import { useState, useRef, useEffect } from 'react'

interface EditableTextProps {
  value: string
  onSave: (newValue: string) => void
  className?: string
  placeholder?: string
}

export const EditableText = ({
  value,
  onSave,
  className = '',
  placeholder = ''
}: EditableTextProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setText(value)
  }, [value])

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsEditing(true)
  }

  // Allow external trigger for editing (e.g., from context menu or F2)
  const startEditing = () => {
    setIsEditing(true)
  }

  const handleBlur = () => {
    setIsEditing(false)
    const trimmed = text.trim()
    if (trimmed !== value && trimmed !== '') {
      onSave(trimmed)
    } else {
      setText(value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBlur()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setText(value)
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={e => e.stopPropagation()}
        className="bg-obsidianDarkGray border border-obsidianBorder rounded px-1 py-0 text-sm text-obsidianText focus:outline-none focus:ring-1 focus:ring-obsidianAccentPurple w-full"
        placeholder={placeholder}
      />
    )
  }

  return (
    <span
      className={`truncate cursor-pointer hover:text-obsidianAccentPurple transition-colors ${className}`}
      onDoubleClick={handleDoubleClick}
      title="Double-click to rename"
    >
      {value || placeholder}
    </span>
  )
}

export default EditableText
