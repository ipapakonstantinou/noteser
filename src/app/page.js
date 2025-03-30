"use client";

import React, { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import Editor from "../components/Editor";

export default function Home() {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [isEditing, setIsEditing] = useState(true);

  // Load notes from localStorage when the component mounts
  useEffect(() => {
    const savedNotes = JSON.parse(localStorage.getItem("notes")) || [];
    setNotes(savedNotes);
  }, []);

  // Save notes to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("notes", JSON.stringify(notes));
  }, [notes]);

  const addNewNote = () => {
    const newNote = {
      id: Date.now(),
      title: "Untitled Note",
      content: "",
    };
    setNotes([...notes, newNote]);
    setSelectedNote(newNote);
    setIsEditing(true);
  };

  const handleSelectNote = (note) => {
    setSelectedNote(note);
    setIsEditing(true);
  };

  const handleEditNote = (updatedNote) => {
    setNotes((prevNotes) =>
      prevNotes.map((note) =>
        note.id === updatedNote.id ? updatedNote : note
      )
    );
    setSelectedNote(updatedNote);
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <Sidebar notes={notes} onAddNewNote={addNewNote} onSelectNote={handleSelectNote} />

      {/* Editor */}
      <Editor
        note={selectedNote}
        isEditing={isEditing}
        onEditNote={handleEditNote}
        onToggleMode={() => setIsEditing(!isEditing)}
      />
    </div>
  );
}
