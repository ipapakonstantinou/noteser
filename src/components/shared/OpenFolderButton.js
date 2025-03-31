// src/components/OpenFolderButton.js
import { useState } from 'react'

const OpenFolderButton = ({ onFolderOpened }) => {
  const [folderFiles, setFolderFiles] = useState([])

  const openLocalFolder = async () => {
    try {
      const dirHandle = await window.showDirectoryPicker()
      const files = []
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile()
          files.push({
            name: file.name,
            content: await file.text(),
            handle: entry
          })
        }
      }
      setFolderFiles(files)
      onFolderOpened(files) // Pass files to parent component
    } catch (error) {
      console.error('Error opening folder:', error)
    }
  }

  return (
    <button
      onClick={openLocalFolder}
      className="obsidian-button"
      title="Open Local Folder"
    >
      Open Folder
    </button>
  )
}

export default OpenFolderButton
