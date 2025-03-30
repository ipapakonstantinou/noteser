"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const Editor = ({ note, isEditing, onEditNote, onToggleMode }) => {
  return (
    <div className="flex-1 p-6 bg-gray-900 text-white">
      {note ? (
        <>
          {/* Title Input */}
          <div className="flex items-center justify-between mb-6">
            <input
              type="text"
              value={note.title}
              onChange={(e) =>
                onEditNote({ ...note, title: e.target.value })
              }
              className="bg-transparent text-xl font-bold border-b border-gray-600 outline-none w-full"
              placeholder="Enter note title..."
            />
            <button
              onClick={onToggleMode}
              className="ml-4 bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
            >
              {isEditing ? "Preview Markdown" : "Edit Note"}
            </button>
          </div>

          {/* Content Section */}
          {isEditing ? (
            <textarea
              value={note.content}
              onChange={(e) =>
                onEditNote({ ...note, content: e.target.value })
              }
              className="w-full h-[calc(100vh-200px)] bg-gray-800 text-white border border-gray-600 rounded p-4 resize-none"
              placeholder="Write your note here..."
            />
          ) : (
            <div className="prose prose-invert max-w-none bg-gray-800 p-6 rounded border border-gray-600">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {note.content}
              </ReactMarkdown>
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-400">Select a note to start editing.</p>
      )}
    </div>
  );
};

export default Editor;
