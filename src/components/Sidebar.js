"use client";

import React from 'react';

const Sidebar = ({ notes, onSelectNote }) => {
  return (
    <div style={{ width: '300px', backgroundColor: '#f4f4f4', padding: '10px' }}>
      <h3>Noteser</h3>
      <ul style={{ listStyleType: 'none', padding: 0 }}>
        {notes.map((note, index) => (
          <li
            key={index}
            onClick={() => onSelectNote(note)}
            style={{
              padding: '10px',
              cursor: 'pointer',
              backgroundColor:
                note.selected ? '#ddd' : 'transparent',
              marginBottom: '5px',
            }}
          >
            {note.title}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Sidebar;