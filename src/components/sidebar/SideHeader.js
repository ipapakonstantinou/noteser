import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  PlusIcon,
  FolderPlusIcon,
  FolderOpenIcon
} from '@heroicons/react/24/outline'

const SideHeader = ({
  isCollapsed,
  toggleSidebar,
  onAddNewNote,
  onAddNewFolder,
  onOpenFolder
}) => {
  return (
    <>
      {/* App Title */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-obsidianBorder">
        <h2
          className={`text-lg font-medium ${isCollapsed ? 'hidden' : 'block'}`}
        >
          Noteser
        </h2>
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-obsidianBorder">
        <button
          className="obsidian-button"
          onClick={toggleSidebar}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
            <button
              className="obsidian-button"
              onClick={onOpenFolder}
              title="Open folder"
            >
              <FolderOpenIcon className="obsidian-icon" />
            </button>
          </>
        )}
      </div>
    </>
  )
}

export default SideHeader
