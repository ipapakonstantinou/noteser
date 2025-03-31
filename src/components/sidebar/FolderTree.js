// --- components/sidebar/FolderTree.js ---
import FolderList from './FolderList'
import NoteList from '../note/NoteList'

const FolderTree = ({
  folders,
  notes,
  expandedFolders,
  toggleFolder,
  activeFolder,
  setActiveFolder,
  selectedNote,
  onSelectNote,
  onRenameNote,
  onRenameFolder,
  handleRightClick,
  isCollapsed
}) => {
  return (
    <div className="mt-2">
      <FolderList
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

      <NoteList
        notes={notes.filter(note => !note.folderId)}
        selectedNote={selectedNote}
        onSelectNote={onSelectNote}
        onRenameNote={onRenameNote}
        handleRightClick={handleRightClick}
        isCollapsed={isCollapsed}
      />
    </div>
  )
}

export default FolderTree