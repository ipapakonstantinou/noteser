"use client";

import React from 'react';

const Sidebar = ({ notes, onSelectNote, onAddNewNote, onDeleteNote, onRenameNote }) => {
  return (
    <div style={{ width: '300px', backgroundColor: '#f4f4f4', padding: '10px' }}>
      <h3>Noteser</h3>
      
      {/* Add New Note Button */}
      <button
        onClick={onAddNewNote}
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
        Add New Note
      </button>

      <ul style={{ listStyleType: 'none', padding: 0 }}>
        {notes.map((note) => (
          <li
            key={note.id}
            style={{
              padding: '10px',
              backgroundColor: '#ddd',
              marginBottom: '5px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Editable Title Input */}
            <input
              type="text"
              value={note.title}
              onChange={(e) => onRenameNote(note.id, e.target.value)}
              style={{
                marginBottom: '5px',
                padding: '5px',
                fontSize: '16px',
                borderRadius: '4px',
                border: '1px solid #ccc',
              }}
            />

            {/* Select Note Button */}
            <button
              onClick={() => onSelectNote(note)}
              style={{
                padding: '5px',
                backgroundColor: '#eee',
                cursor: 'pointer',
                borderRadius: '4px',
                border: '1px solid #ccc',
              }}
            >
              Select
            </button>

            {/* Delete Button */}
            <button
              onClick={() => onDeleteNote(note.id)}
              style={{
                marginTop: '5px',
                padding: '5px',
                backgroundColor: '#dc3545',
                color: '#fff',
                cursor: 'pointer',
                borderRadius: '4px',
                border: 'none',
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Sidebar;
