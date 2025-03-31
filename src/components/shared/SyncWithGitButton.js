// src/components/SyncWithGitButton.js
const SyncWithGitButton = ({ folderPath }) => {
  const syncWithGitHub = async () => {
    try {
      // Initialize Git repository
      await runCommand(`cd ${folderPath} && git init`)

      // Add all files to the repository
      await runCommand(`cd ${folderPath} && git add .`)

      // Commit changes
      await runCommand(`cd ${folderPath} && git commit -m "Sync changes"`)

      // Push changes to remote repository
      await runCommand(`cd ${folderPath} && git push -u origin main`)

      alert('Files synced successfully!')
    } catch (error) {
      console.error('Error syncing with GitHub:', error)
    }
  }

  const runCommand = async command => {
    // Simulate running shell commands (requires backend integration for actual execution)
    console.log('Running command:', command)
  }

  return (
    <button
      onClick={syncWithGitHub}
      className="obsidian-button"
      title="Sync Files with GitHub"
    >
      Sync with GitHub
    </button>
  )
}

export default SyncWithGitButton
