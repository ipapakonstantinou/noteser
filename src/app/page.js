"use client";

import Sidebar from '../components/Sidebar';
import Editor from '../components/Editor';
import React, { useState } from 'react';

export default function Home() {
  const [notes, setNotes] = useState([
    { id: 1, title: 'Welcome to Noteser', content: 'Start writing your first note!' },
    { id: 2, title: 'Second Note', content: 'This is your second note.' },
  ]);
  const [selectedNote, setSelectedNote] = useState(null);

  // Handle selecting a note from the sidebar
  const handleSelectNote = (note) => {
    setSelectedNote(note);
  };

  // Handle editing the selected note
  const handleEditNote = (newContent) => {
    const updatedNote = { ...selectedNote, content: newContent };
    setSelectedNote(updatedNote);

    // Update the notes array with the edited note
    setNotes((prevNotes) =>
      prevNotes.map((note) =>
        note.id === updatedNote.id ? updatedNote : note
      )
    );
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <Sidebar notes={notes} onSelectNote={handleSelectNote} />

      {/* Editor */}
      <Editor note={selectedNote} onEditNote={handleEditNote} />
    </div>
  );
}
