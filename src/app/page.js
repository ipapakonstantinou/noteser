// src/app/page.js
"use client";
import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import Editor from "../components/Editor";

export default function Home() {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load data from localStorage
  useEffect(() => {
    const savedNotes = JSON.parse(localStorage.getItem("notes")) || [];
    const savedFolders = JSON.parse(localStorage.getItem("folders")) || [];
    const sidebarState = localStorage.getItem("sidebarCollapsed") === "true";

    setNotes(savedNotes);
    setFolders(savedFolders);
    setSidebarCollapsed(sidebarState);
  }, []);

  // Save sidebar state
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Save notes to localStorage
  useEffect(() => {
    if (notes.length > 0) {
      localStorage.setItem("notes", JSON.stringify(notes));
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

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="flex h-screen w-screen bg-obsidianBlack text-obsidianText overflow-hidden">
      {/* Sidebar with fixed width */}
      <div 
        className={`transition-all duration-300 flex-none ${
          sidebarCollapsed ? 'w-[50px]' : 'w-64'
        }`}
      >
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
          selectedNote={selectedNote}
          isCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
        />
      </div>
      
      {/* Editor container - use absolute width calculation */}
      <div 
        className="h-full overflow-hidden"
        style={{ 
          width: `calc(100vw - ${sidebarCollapsed ? '50px' : '16rem'})` 
        }}
      >
        <Editor note={selectedNote} onEditNote={handleEditNote} />
      </div>
    </div>
  );
}
