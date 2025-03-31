// src/components/EditableText.js
import { useState, useRef, useEffect } from "react";

const EditableText = ({ value, onSave, className = "" }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    setText(value);
  }, [value]);

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (text.trim() !== value) {
      onSave(text);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
      onSave(text);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setText(value);
    }
  };

  return isEditing ? (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      className="bg-obsidianDarkGray border border-obsidianBorder rounded px-1 py-0 text-sm focus:outline-none w-full"
      autoFocus
    />
  ) : (
    <span 
      className={`${className} truncate cursor-pointer`}
      onDoubleClick={handleDoubleClick}
    >
      {value}
    </span>
  );
};

export default EditableText;
