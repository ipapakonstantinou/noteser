'use client'

import { DocumentTextIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useUIStore, useWorkspaceStore } from '@/stores'
import { EditorHeader } from './EditorHeader'
import { EditorContent } from './EditorContent'
import { TabBar } from './TabBar'
import { MergeEditorView } from './MergeEditorView'
import { EmptyState } from '@/components/ui'

export const Editor = () => {
  const { notes, updateNote } = useNoteStore()
  const { isPreviewMode } = useUIStore()
  const tabs = useWorkspaceStore(s => s.tabs)
  const activeTabId = useWorkspaceStore(s => s.activeTabId)
  const activeTab = tabs.find(t => t.id === activeTabId) ?? null

  if (!activeTab) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden bg-obsidianBlack">
        <TabBar />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<DocumentTextIcon className="w-16 h-16" />}
            title="No note selected"
            description="Select a note from the sidebar or create a new one to get started"
          />
        </div>
      </div>
    )
  }

  if (activeTab.kind === 'merge-conflict') {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden bg-obsidianBlack">
        <TabBar />
        <MergeEditorView tabId={activeTab.id} conflicts={activeTab.conflicts} />
      </div>
    )
  }

  const note = notes.find(n => n.id === activeTab.noteId) ?? null
  if (!note) {
    // Note was deleted while the tab was open — render nothing useful but
    // keep the tab bar so the user can close the dead tab.
    return (
      <div className="flex flex-col h-full w-full overflow-hidden bg-obsidianBlack">
        <TabBar />
        <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText text-sm">
          This note no longer exists.
        </div>
      </div>
    )
  }

  const handleTitleChange = (title: string) => updateNote(note.id, { title })
  const handleContentChange = (content: string) => updateNote(note.id, { content })

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-obsidianBlack">
      <TabBar />
      <EditorHeader note={note} onTitleChange={handleTitleChange} />
      <EditorContent
        note={note}
        isPreviewMode={isPreviewMode}
        onContentChange={handleContentChange}
      />
    </div>
  )
}

export default Editor
