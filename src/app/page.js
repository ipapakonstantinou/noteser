// src/app/page.js
"use client";
import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import Editor from "../components/Editor";
import SaveIndicator from "../components/SaveIndicator";
import Resizable from "react-resizable-layout";

export default function Home() {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  const [recentlySaved, setRecentlySaved] = useState(false);

  // Load data from localStorage
  useEffect(() => {
    const savedNotes = JSON.parse(localStorage.getItem("notes")) || [];
    const savedFolders = JSON.parse(localStorage.getItem("folders")) || [];
    setNotes(savedNotes);
    setFolders(savedFolders);
  }, []);

  // Save notes to localStorage
  useEffect(() => {
    if (notes.length > 0) {
      localStorage.setItem("notes", JSON.stringify(notes));
      setRecentlySaved(true);
      setTimeout(() => setRecentlySaved(false), 2000);
    }
  }, [notes]);

  // Save folders to localStorage
  useEffect(() => {
    if (folders.length > 0) {
      localStorage.setItem("folders", JSON.stringify(folders));
    }
  }, [folders]);

  // Note operations
  const addNewNote = () => {
    const newNote = {
      id: Date.now(),
      title: "Untitled Note",
      content: "",
      folderId: activeFolder?.id || null,
    };
    setNotes([...notes, newNote]);
    setSelectedNote(newNote);
  };

  const handleEditNote = (updatedNote) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === updatedNote.id ? updatedNote : n))
    );
    setSelectedNote(updatedNote);
  };

  // Rename operations
  const renameNote = (noteId, newTitle) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, title: newTitle } : n))
    );
    if (selectedNote && selectedNote.id === noteId) {
      setSelectedNote((prev) => ({ ...prev, title: newTitle }));
    }
  };

  const renameFolder = (folderId, newName) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, name: newName } : f))
    );
  };

  // Folder operations
  const addNewFolder = () => {
    const newFolder = {
      id: Date.now(),
      name: "New Folder",
      notes: [],
    };
    setFolders([...folders, newFolder]);
    setActiveFolder(newFolder);
  };

  return (
    <Resizable axis="x" initial={300} min={200} max={500}>
      {({ position, separatorProps }) => (
        <div className="flex h-screen bg-obsidianBlack text-obsidianText">
          {/* Sidebar */}
          <div style={{ width: position }} className="obsidian-sidebar">
            <Sidebar
              notes={notes}
              folders={folders}
              onAddNewNote={addNewNote}
              onAddNewFolder={addNewFolder}
              onSelectNote={setSelectedNote}
              onRenameNote={renameNote}
              onRenameFolder={renameFolder}
              activeFolder={activeFolder}
              setActiveFolder={setActiveFolder}
            />
          </div>

          {/* Resizable Separator */}
          <div
            {...separatorProps}
            className="w-1 bg-obsidianBorder hover:bg-obsidianAccentPurple cursor-col-resize"
          />

          {/* Editor */}
          <div className="flex-1">
            <Editor note={selectedNote} onEditNote={handleEditNote} />
          </div>

          {/* Save Indicator */}
          <SaveIndicator isSaved={recentlySaved} />
        </div>
      )}
    </Resizable>
  );
}
