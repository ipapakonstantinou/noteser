// src/components/Sidebar.js
import { useState } from "react";
import { 
  PlusIcon, 
  FolderPlusIcon, 
  ChevronDownIcon, 
  ChevronRightIcon,
  DocumentTextIcon
} from "@heroicons/react/24/outline";
import EditableText from "./EditableText";

const Sidebar = ({
  folders,
  notes,
  onAddNewNote,
  onAddNewFolder,
  onSelectNote,
  onRenameNote,
  onRenameFolder,
  activeFolder,
  setActiveFolder,
  selectedNote
}) => {
  const [expandedFolders, setExpandedFolders] = useState({});

  const toggleFolder = (folderId, e) => {
    e.stopPropagation();
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const handleFolderClick = (folder) => {
    setActiveFolder(folder);
  };

  return (
    <div className="obsidian-sidebar w-full p-2 h-full overflow-y-auto">
      {/* App Title */}
      <div className="flex items-center justify-between mb-2 px-2">
        <h2 className="text-lg font-medium">Noteser</h2>
      </div>

      {/* Action Icons */}
      <div className="flex items-center justify-end mb-3 px-2">
        <button 
          className="obsidian-button" 
          onClick={onAddNewNote}
          title="New note"
        >
          <PlusIcon className="obsidian-icon" />
        </button>
        <button 
          className="obsidian-button ml-1" 
          onClick={onAddNewFolder}
          title="New folder"
        >
          <FolderPlusIcon className="obsidian-icon" />
        </button>
      </div>

      {/* Folders Section */}
      <div>
        {folders.map((folder) => (
          <div key={folder.id} className="mb-1">
            <div
              className={`obsidian-folder-item ${
                activeFolder?.id === folder.id ? "bg-obsidianHighlight" : ""
              }`}
              onClick={() => handleFolderClick(folder)}
            >
              <button 
                className="mr-1 focus:outline-none"
                onClick={(e) => toggleFolder(folder.id, e)}
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
            </div>

            {/* Notes within folder */}
            {expandedFolders[folder.id] &&
              notes.filter((note) => note.folderId === folder.id).map((note) => (
                <div 
                  key={note.id} 
                  className={`obsidian-file-item ml-5 ${
                    selectedNote?.id === note.id ? "bg-obsidianHighlight" : ""
                  }`}
                  onClick={() => onSelectNote(note)}
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

        {/* Uncategorized Notes */}
        <div className="mt-4">
          <div className="flex items-center justify-between px-2 py-1 text-xs text-obsidianSecondaryText">
            <span>UNCATEGORIZED</span>
          </div>
          {notes
            .filter(note => !note.folderId)
            .map(note => (
              <div 
                key={note.id}
                className={`obsidian-file-item ${
                  selectedNote?.id === note.id ? "bg-obsidianHighlight" : ""
                }`}
                onClick={() => onSelectNote(note)}
              >
                <DocumentTextIcon className="w-4 h-4 mr-2" />
                <EditableText
                  value={note.title}
                  onSave={(newTitle) => onRenameNote(note.id, newTitle)}
                />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
