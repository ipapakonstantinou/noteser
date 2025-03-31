import EditableText from "./EditableText";
import { ChevronDownIcon, ChevronRightIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

const SideFolderSection = ({
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
      {folders.map((folder) => (
        <div key={folder.id} className="mb-1">
          {/* Folder */}
          <div
            className={`obsidian-folder-item ${
              activeFolder?.id === folder.id ? "bg-obsidianHighlight" : ""
            }`}
            onClick={() => setActiveFolder(folder)}
            onContextMenu={(e) => handleRightClick(e, "folder", folder.id)} // Right-click handler for folders
          >
            {!isCollapsed && (
              <>
                <button
                  className="mr-1 focus:outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(folder.id);
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
                  onSave={(newName) => onRenameFolder(folder.id, newName)}
                />
              </>
            )}
          </div>

          {/* Notes within folder */}
          {!isCollapsed &&
            expandedFolders[folder.id] &&
            notes.filter((note) => note.folderId === folder.id).map((note) => (
              <div
                key={note.id}
                className={`ml-5 obsidian-file-item ${
                  selectedNote?.id === note.id ? "bg-obsidianHighlight" : ""
                }`}
                onClick={() => onSelectNote(note)}
                onContextMenu={(e) => handleRightClick(e, "note", note.id)} // Right-click handler for notes
              >
                <DocumentTextIcon className="w-4 h-4 mr-2" />
                <EditableText
                  value={note.title}
                  onSave={(newTitle) => onRenameNote(note.id, newTitle)}
                />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
};

export default SideFolderSection;
