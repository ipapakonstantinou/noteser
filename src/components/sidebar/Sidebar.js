// src/components/Sidebar.js
import { useState } from 'react'
import SideHeader from './SideHeader'
import SideContextMenu from './SideContextMenu'
import FolderTree from './FolderTree'

const Sidebar = ({
  folders,
  notes,
  onAddNewNote,
  onAddNewFolder,
  onOpenFolder,
  onSelectNote,
  onRenameNote,
  onRenameFolder,
  onDeleteNote,
  onDeleteFolder,
  activeFolder,
  setActiveFolder,
  selectedNote,
  isCollapsed,
  toggleSidebar
}) => {
  const [expandedFolders, setExpandedFolders] = useState({})
  const [contextMenu, setContextMenu] = useState(null)

  const toggleFolder = folderId => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }))
  }

  const handleRightClick = (e, type, id) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type, id })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  return (
    <div
      className={`obsidian-sidebar h-full overflow-y-auto transition-all duration-300 ${
        isCollapsed ? 'w-[50px]' : 'w-64'
      }`}
      onClick={closeContextMenu}
    >
      {/* Header */}
      <SideHeader
        isCollapsed={isCollapsed}
        toggleSidebar={toggleSidebar}
        onAddNewNote={onAddNewNote}
        onAddNewFolder={onAddNewFolder}
        onOpenFolder={onOpenFolder}
      />

      {/* Folder + Note List */}
      <FolderTree
        folders={folders}
        notes={notes}
        expandedFolders={expandedFolders}
        toggleFolder={toggleFolder}
        activeFolder={activeFolder}
        setActiveFolder={setActiveFolder}
        selectedNote={selectedNote}
        onSelectNote={onSelectNote}
        onRenameNote={onRenameNote}
        onRenameFolder={onRenameFolder}
        handleRightClick={handleRightClick}
        isCollapsed={isCollapsed}
      />

      {/* Right-click menu */}
      {contextMenu && (
        <SideContextMenu
          contextMenu={contextMenu}
          closeContextMenu={closeContextMenu}
          onDeleteNote={onDeleteNote}
          onDeleteFolder={onDeleteFolder}
        />
      )}
    </div>
  )
}

export default Sidebar
