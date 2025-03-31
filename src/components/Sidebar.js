// src/components/Sidebar.js
import { useState } from "react";
import { 
  PlusIcon, 
  FolderPlusIcon, 
  ChevronDownIcon, 
  ChevronRightIcon,
  DocumentTextIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon
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
  selectedNote,
  isCollapsed,
  toggleSidebar
}) => {
  const [expandedFolders, setExpandedFolders] = useState({});

  const toggleFolder = (folderId) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  return (
    <div
      className={`obsidian-sidebar h-full overflow-y-auto transition-all duration-300 ${
        isCollapsed ? "w-[50px]" : "w-64"
      }`}
    >
      {/* App Title */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-obsidianBorder">
        <h2 className={`text-lg font-medium ${isCollapsed ? "hidden" : "block"}`}>
          Noteser
        </h2>
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-obsidianBorder">
        <button
          className="obsidian-button"
          onClick={toggleSidebar}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronDoubleRightIcon className="w-4 h-4" />
          ) : (
            <ChevronDoubleLeftIcon className="w-4 h-4" />
          )}
        </button>
        {!isCollapsed && (
          <>
            <button 
              className="obsidian-button" 
              onClick={onAddNewNote}
              title="New note"
            >
              <PlusIcon className="obsidian-icon" />
            </button>
            <button 
              className="obsidian-button" 
              onClick={onAddNewFolder}
              title="New folder"
            >
              <FolderPlusIcon className="obsidian-icon" />
            </button>
          </>
        )}
      </div>

      {/* Folders Section */}
      <div className="mt-2">
        {folders.map((folder) => (
          <div key={folder.id} className="mb-1">
            <div
              className={`obsidian-folder-item ${
                activeFolder?.id === folder.id ? "bg-obsidianHighlight" : ""
              }`}
              onClick={() => setActiveFolder(folder)}
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

      {/* Notes outside folders */}
      {!isCollapsed &&
        notes.filter((note) => !note.folderId).map((note) => (
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
  );
};

export default Sidebar;
