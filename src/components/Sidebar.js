import { useState } from "react";
import SideHeader from "./SideHeader";
import SideFolderSection from "./SideFolderSection";
import SideContextMenu from "./SideContextMenu";

const Sidebar = ({
  folders,
  notes,
  onAddNewNote,
  onAddNewFolder,
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
  const [expandedFolders, setExpandedFolders] = useState({});
  const [contextMenu, setContextMenu] = useState(null);

  const toggleFolder = (folderId) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const handleRightClick = (e, type, id) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  return (
    <div
      className={`obsidian-sidebar h-full overflow-y-auto transition-all duration-300 ${
        isCollapsed ? "w-[50px]" : "w-64"
      }`}
      onClick={closeContextMenu} // Close context menu when clicking outside
    >
      {/* Sidebar Header */}
      <SideHeader
        isCollapsed={isCollapsed}
        toggleSidebar={toggleSidebar}
        onAddNewNote={onAddNewNote}
        onAddNewFolder={onAddNewFolder}
      />

      {/* Folders Section */}
      <SideFolderSection
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

      {/* Context Menu */}
      {contextMenu && (
        <SideContextMenu
          contextMenu={contextMenu}
          closeContextMenu={closeContextMenu}
          onDeleteNote={onDeleteNote}
          onDeleteFolder={onDeleteFolder}
        />
      )}
    </div>
  );
};

export default Sidebar;
