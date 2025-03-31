// --- components/sidebar/FolderList.js ---
import EditableText from '../shared/EditableText'
import NoteList from '../note/NoteList'
import {
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline'

const FolderList = ({
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
}) => (
  <>
    {folders.map(folder => (
      <div key={folder.id} className="mb-1">
        <div
          className={`obsidian-folder-item ${
            activeFolder?.id === folder.id ? 'bg-obsidianHighlight' : ''
          }`}
          onClick={() => setActiveFolder(folder)}
          onContextMenu={e => handleRightClick(e, 'folder', folder.id)}
        >
          {!isCollapsed && (
            <>
              <button
                className="mr-1 focus:outline-none"
                onClick={e => {
                  e.stopPropagation()
                  toggleFolder(folder.id)
                }}
              >
                {expandedFolders[folder.id] ? (
                  <ChevronDownIcon className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                )}
              </button>
              <EditableText
                value={folder.name}
                onSave={newName => onRenameFolder(folder.id, newName)}
              />
            </>
          )}
        </div>
        {!isCollapsed && expandedFolders[folder.id] && (
          <NoteList
            notes={notes.filter(note => note.folderId === folder.id)}
            selectedNote={selectedNote}
            onSelectNote={onSelectNote}
            onRenameNote={onRenameNote}
            handleRightClick={handleRightClick}
            isCollapsed={isCollapsed}
            className="ml-5"
          />
        )}
      </div>
    ))}
  </>
)

export default FolderList