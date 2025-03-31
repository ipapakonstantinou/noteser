// src/app/page.js
'use client'
import { useState } from 'react'
import Sidebar from '../components/sidebar/Sidebar'
import Editor from '../components/editor/Editor'
import useNotesStorage from '../hooks/useNotesStorage'

export default function Home() {
  const {
    notes,
    setNotes,
    folders,
    setFolders,
    sidebarCollapsed,
    setSidebarCollapsed
  } = useNotesStorage()

  const [selectedNote, setSelectedNote] = useState(null)
  const [activeFolder, setActiveFolder] = useState(null)

  const addNewNote = () => {
    const newNote = {
      id: Date.now(),
      title: 'Untitled Note',
      content: '',
      folderId: activeFolder?.id || null
    }
    setNotes([...notes, newNote])
    setSelectedNote(newNote)
  }

  const addNewFolder = () => {
    const newFolder = {
      id: Date.now(),
      name: 'New Folder',
      notes: []
    }
    setFolders([...folders, newFolder])
    setActiveFolder(newFolder)
  }

  const handleEditNote = updatedNote => {
    setNotes(prev => prev.map(n => (n.id === updatedNote.id ? updatedNote : n)))
    setSelectedNote(updatedNote)
  }

  const renameNote = (noteId, newTitle) => {
    setNotes(prev =>
      prev.map(n => (n.id === noteId ? { ...n, title: newTitle } : n))
    )
    if (selectedNote?.id === noteId) {
      setSelectedNote(prev => ({ ...prev, title: newTitle }))
    }
  }

  const renameFolder = (folderId, newName) => {
    setFolders(prev =>
      prev.map(f => (f.id === folderId ? { ...f, name: newName } : f))
    )
  }

  const deleteNote = id => {
    setNotes(prev => prev.filter(note => note.id !== id))
  }

  const deleteFolder = id => {
    setFolders(prev => prev.filter(folder => folder.id !== id))
  }

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev)
  }

  return (
    <div className="flex h-screen w-screen bg-obsidianBlack text-obsidianText overflow-hidden">
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
          onDeleteNote={deleteNote}
          onDeleteFolder={deleteFolder}
        />
      </div>

      <div
        className="h-full overflow-hidden"
        style={{
          width: `calc(100vw - ${sidebarCollapsed ? '50px' : '16rem'})`
        }}
      >
        <Editor note={selectedNote} onEditNote={handleEditNote} />
      </div>
    </div>
  )
}
