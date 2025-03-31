// src/components/Editor.js
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PencilIcon, EyeIcon } from "@heroicons/react/24/outline";
import EditableTitle from "./EditableTitle";

const Editor = ({ note, onEditNote }) => {
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText">
        Select a note to start editing
      </div>
    );
  }

  
  const handleContentChange = (e) => {
    // Access value from the event object correctly
    onEditNote({...note, content: e.target.value});
  };
  
  // Inside Editor component
  const handleTitleRename = (newTitle) => {
    onEditNote({...note, title: newTitle});
  };
  
  return (
    <div className="flex flex-col h-full">
      {/* Note Header with Editable Title */}
      <div className="flex justify-between items-center p-4 border-b border-obsidianBorder">
        <EditableTitle 
          value={note.title} 
          onRename={handleTitleRename} 
        />
        <button 
          onClick={() => setIsPreviewMode(!isPreviewMode)}
          className="obsidian-button"
        >
          {isPreviewMode ? 
            <PencilIcon className="w-5 h-5" /> : 
            <EyeIcon className="w-5 h-5" />
          }
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {isPreviewMode ? (
          <div className="prose prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {note.content}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={note.content}
            onChange={handleContentChange}
            className="w-full h-full p-4 bg-obsidianBlack resize-none focus:outline-none"
            placeholder="Start writing..."
          />
        )}
      </div>
    </div>
  );
};

export default Editor;
