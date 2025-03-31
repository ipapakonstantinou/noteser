const SideContextMenu = ({
  contextMenu,
  closeContextMenu,
  onDeleteNote,
  onDeleteFolder
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: contextMenu.y,
        left: contextMenu.x,
        backgroundColor: '#333',
        color: '#fff',
        padding: '0.5rem',
        borderRadius: '0.25rem',
        boxShadow: '0px 4px 6px rgba(0,0,0,0.1)',
        zIndex: 1000
      }}
    >
      {contextMenu.type === 'note' && (
        <>
          <button
            className="block w-full text-left hover:bg-gray-700 px-2 py-1"
            onClick={() => {
              onDeleteNote(contextMenu.id)
              closeContextMenu()
            }}
          >
            Delete Note
          </button>
        </>
      )}
      {contextMenu.type === 'folder' && (
        <>
          <button
            className="block w-full text-left hover:bg-gray-700 px-2 py-1"
            onClick={() => {
              onDeleteFolder(contextMenu.id)
              closeContextMenu()
            }}
          >
            Delete Folder
          </button>
        </>
      )}
    </div>
  )
}

export default SideContextMenu
