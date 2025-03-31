import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PencilIcon, EyeIcon } from "@heroicons/react/24/outline";

const Editor = ({ note, onEditNote }) => {
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Ensure note is defined and has title/content
  const title = note?.title || ""; // Fallback to empty string if undefined
  const content = note?.content || ""; // Fallback to empty string if undefined

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText h-full w-full">
        Select a note to start editing
      </div>
    );
  }

  const handleContentChange = (e) => {
    // Safely update content
    const updatedContent = e?.target?.value || ""; // Ensure e.target exists
    onEditNote({ ...note, content: updatedContent });
  };

  const handleTitleChange = (e) => {
    // Safely update title
    const updatedTitle = e?.target?.value || ""; // Ensure e.target exists
    onEditNote({ ...note, title: updatedTitle });
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Note Header with Inline Editable Title */}
      <div className="p-4 border-b border-obsidianBorder">
        {!isPreviewMode ? (
          <textarea
            value={`${title}`} // Fallback for title
            onChange={(e) => handleTitleChange(e)}
            className="w-full bg-obsidianBlack text-obsidianText text-xl font-bold resize-none focus:outline-none"
            placeholder="# Enter note title..."
          />
        ) : (
          <h1 className="text-xl font-bold">{title}</h1>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {isPreviewMode ? (
          <div className="prose prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content} {/* Fallback for content */}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={content} // Fallback for content
            onChange={(e) => handleContentChange(e)}
            className="w-full h-full p-4 bg-obsidianBlack resize-none focus:outline-none"
            placeholder="Start writing..."
          />
        )}
      </div>

      {/* Preview/Edit Toggle Button */}
      <button
        onClick={() => setIsPreviewMode(!isPreviewMode)}
        className="absolute bottom-4 right-4 obsidian-button"
        title={isPreviewMode ? "Switch to Edit mode" : "Switch to Preview mode"}
      >
        {isPreviewMode ? <PencilIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
      </button>
    </div>
  );
};

export default Editor;
