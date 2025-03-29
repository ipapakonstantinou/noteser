"use client";

import Sidebar from '../components/Sidebar';
import Editor from '../components/Editor';
import React, { useState, useEffect } from 'react';

export default function Home() {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [isEditing, setIsEditing] = useState(true); // Toggle between edit and preview mode

  // Load notes from localStorage when the component mounts
  useEffect(() => {
    const savedNotes = JSON.parse(localStorage.getItem('notes')) || [];
    setNotes(savedNotes);
  }, []);

  // Save notes to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('notes', JSON.stringify(notes));
  }, [notes]);

  // Handle selecting a note from the sidebar
  const handleSelectNote = (note) => {
    setSelectedNote(note);
    setIsEditing(true); // Default to editing mode when selecting a note
  };

  // Handle editing the selected note's content
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

  // Handle renaming a note's title
  const handleRenameNote = (id, newTitle) => {
    const updatedNotes = notes.map((note) =>
      note.id === id ? { ...note, title: newTitle } : note
    );
    setNotes(updatedNotes);

    // If the renamed note is currently selected, update its title as well
    if (selectedNote?.id === id) {
      setSelectedNote({ ...selectedNote, title: newTitle });
    }
  };

  // Add a new note
  const addNewNote = () => {
    const newNote = {
      id: Date.now(), // Unique ID based on timestamp
      title: 'Untitled Note',
      content: '',
    };
    setNotes([...notes, newNote]);
    setSelectedNote(newNote); // Automatically select the new note for editing
    setIsEditing(true); // Default to editing mode for new notes
  };

  // Delete a note
  const deleteNote = (id) => {
    const updatedNotes = notes.filter((note) => note.id !== id);
    setNotes(updatedNotes);

    // If the deleted note is currently selected, clear the editor
    if (selectedNote?.id === id) {
      setSelectedNote(null);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <Sidebar
        notes={notes}
        onSelectNote={handleSelectNote}
        onAddNewNote={addNewNote}
        onDeleteNote={deleteNote}
        onRenameNote={handleRenameNote} // Pass rename handler to Sidebar
      />

      {/* Editor */}
      <Editor
        note={selectedNote}
        isEditing={isEditing}
        onEditNote={handleEditNote}
        onRenameNote={(newTitle) =>
          handleRenameNote(selectedNote?.id, newTitle)
        } // Pass rename handler to Editor
        onToggleMode={() => setIsEditing(!isEditing)} // Toggle between edit and preview mode
      />
    </div>
  );
}
