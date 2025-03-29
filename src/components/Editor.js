"use client";

import React from 'react';
import ReactMarkdown from 'react-markdown';

const Editor = ({ note, isEditing, onEditNote, onToggleMode }) => {
  return (
    <div style={{ flex: 1, padding: '10px' }}>
      {note ? (
        <>
          <h3>{note.title}</h3>

          {/* Toggle Button */}
          <button
            onClick={onToggleMode}
            style={{
              marginBottom: '10px',
              padding: '10px',
              backgroundColor: '#007bff',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {isEditing ? 'Preview Markdown' : 'Edit Note'}
          </button>

          {/* Edit Mode */}
          {isEditing ? (
            <textarea
              value={note.content}
              onChange={(e) => onEditNote(e.target.value)}
              style={{
                width: '100%',
                height: '90%',
                fontSize: '16px',
                padding: '10px',
              }}
            />
          ) : (
            /* Preview Mode */
            <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}>
              <ReactMarkdown>{note.content}</ReactMarkdown>
            </div>
          )}
        </>
      ) : (
        <p>Select a note to view or edit.</p>
      )}
    </div>
  );
};

export default Editor;
