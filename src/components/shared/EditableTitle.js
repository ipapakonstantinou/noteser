// Add this component: src/components/EditableTitle.js
import { useState, useRef, useEffect } from 'react'

const EditableTitle = ({ value, onRename }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(value)
  const inputRef = useRef(null)

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleDoubleClick = () => {
    setIsEditing(true)
  }

  const handleChange = e => {
    setTitle(e.target.value)
  }

  const handleBlur = () => {
    setIsEditing(false)
    if (title.trim() !== value) {
      onRename(title)
    }
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter') {
      setIsEditing(false)
      onRename(title)
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setTitle(value) // Reset to original
    }
  }

  return isEditing ? (
    <input
      ref={inputRef}
      type="text"
      value={title}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-xl font-medium focus:outline-none focus:border-obsidianAccentPurple"
      autoFocus
    />
  ) : (
    <h1
      className="text-xl font-medium cursor-pointer hover:text-obsidianAccentPurple"
      onDoubleClick={handleDoubleClick}
    >
      {value}
    </h1>
  )
}

export default EditableTitle
