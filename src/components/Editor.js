"use client";

import React from 'react';

const Editor = ({ note, onEditNote }) => {
  return (
    <div style={{ flex: 1, padding: '10px' }}>
      {note ? (
        <>
          <h3>{note.title}</h3>
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
        </>
      ) : (
        <p>Select a note to view or edit.</p>
      )}
    </div>
  );
};

export default Editor;
