import React, { useState, useEffect } from 'react';

const NotesApp = () => {
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState([]);

  // Load saved notes when the component mounts
  useEffect(() => {
    const savedNotes = JSON.parse(localStorage.getItem('notes')) || [];
    setNotes(savedNotes);
  }, []);

  // Save a new note to localStorage
  const saveNote = () => {
    const updatedNotes = [...notes, note];
    localStorage.setItem('notes', JSON.stringify(updatedNotes));
    setNotes(updatedNotes);
    setNote(''); // Clear the input field after saving
  };

  return (
    <div style={{ padding: '20px' }}>
      <textarea 
        value={note} 
        onChange={(e) => setNote(e.target.value)} 
        placeholder="Write your note here..."
        style={{ width: '100%', height: '100px', marginBottom: '10px' }}
      />
      <button onClick={saveNote} style={{ marginBottom: '20px' }}>Save Note</button>
      <ul>
        {notes.map((n, index) => (
          <li key={index}>{n}</li>
        ))}
      </ul>
    </div>
  );
};

export default NotesApp;
