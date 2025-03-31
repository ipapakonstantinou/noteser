// --- hooks/useNotesStorage.js ---
import { useState, useEffect } from 'react'

const useNotesStorage = () => {
  const [notes, setNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const savedNotes = JSON.parse(localStorage.getItem('notes')) || []
    const savedFolders = JSON.parse(localStorage.getItem('folders')) || []
    const sidebarState = localStorage.getItem('sidebarCollapsed') === 'true'

    setNotes(savedNotes)
    setFolders(savedFolders)
    setSidebarCollapsed(sidebarState)
  }, [])

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    if (notes.length > 0) {
      localStorage.setItem('notes', JSON.stringify(notes))
    }
  }, [notes])

  useEffect(() => {
    if (folders.length > 0) {
      localStorage.setItem('folders', JSON.stringify(folders))
    }
  }, [folders])

  return {
    notes,
    setNotes,
    folders,
    setFolders,
    sidebarCollapsed,
    setSidebarCollapsed
  }
}

export default useNotesStorage
