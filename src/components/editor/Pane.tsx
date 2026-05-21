'use client'

import { useState } from 'react'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useUIStore, useWorkspaceStore } from '@/stores'
import { useTabDragActive, TAB_DRAG_MIME, useViewport } from '@/hooks'
import { EditorHeader } from './EditorHeader'
import { EditorFooter } from './EditorFooter'
import { EditorContent } from './EditorContent'
import { TabBar } from './TabBar'
import { MergeEditorView } from './MergeEditorView'
import { WelcomePane } from './WelcomePane'
import { EmptyState } from '@/components/ui'
import type { PaneState } from '@/stores/workspaceStore'

// A single editor pane. Renders its own TabBar + whatever the active tab
// shows. A drop zone on the right edge allows the user to drag a tab from
// elsewhere to create a split.
interface Props {
  pane: PaneState
  // True when this is the only pane and we should expose the right-edge
  // drop zone for creating a split. The second pane never offers it (we
  // only support 2 panes for now).
  allowSplitDropZone: boolean
}

export const Pane = ({ pane, allowSplitDropZone }: Props) => {
  const { notes, updateNote } = useNoteStore()
  const { isPreviewMode } = useUIStore()
  const focusPane = useWorkspaceStore(s => s.focusPane)
  const promoteTab = useWorkspaceStore(s => s.promoteTab)
  const splitTabRight = useWorkspaceStore(s => s.splitTabRight)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)

  const [splitDropActive, setSplitDropActive] = useState(false)
  const tabDragActive = useTabDragActive()
  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId) ?? null
  const isActive = pane.id === activePaneId

  // Mobile viewports skip the split-pane affordance entirely — there
  // isn't room for two columns of editor. The drop-zone handlers don't
  // even mount in that case (see render below).
  const { isMobile } = useViewport()

  const handleRightEdgeDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setSplitDropActive(true)
  }
  const handleRightEdgeDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const tabId = e.dataTransfer.getData(TAB_DRAG_MIME)
    if (tabId) splitTabRight(tabId)
    setSplitDropActive(false)
  }

  let body: React.ReactNode
  if (!activeTab) {
    body = (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<DocumentTextIcon className="w-16 h-16" />}
          title="No note selected"
          description="Select a note from the sidebar or create a new one to get started"
        />
      </div>
    )
  } else if (activeTab.kind === 'merge-conflict') {
    body = <MergeEditorView tabId={activeTab.id} conflict={activeTab.conflict} />
  } else if (activeTab.kind === 'welcome') {
    body = <WelcomePane tabId={activeTab.id} />
  } else {
    const note = notes.find(n => n.id === activeTab.noteId) ?? null
    if (!note) {
      body = (
        <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText text-sm">
          This note no longer exists.
        </div>
      )
    } else {
      const handleTitleChange = (title: string) => {
        updateNote(note.id, { title })
        if (activeTab.kind === 'note' && activeTab.isPreview) promoteTab(activeTab.id)
      }
      const handleContentChange = (content: string) => {
        updateNote(note.id, { content })
        if (activeTab.kind === 'note' && activeTab.isPreview) promoteTab(activeTab.id)
      }
      body = (
        <>
          <EditorHeader note={note} onTitleChange={handleTitleChange} />
          <EditorContent
            note={note}
            isPreviewMode={isPreviewMode}
            onContentChange={handleContentChange}
          />
          <EditorFooter note={note} />
        </>
      )
    }
  }

  return (
    <div
      className={`relative flex flex-col h-full min-w-0 flex-1 overflow-hidden ${
        isActive ? 'bg-obsidianBlack' : 'bg-obsidianBlack/95'
      }`}
      onMouseDown={() => { if (!isActive) focusPane(pane.id) }}
    >
      <TabBar pane={pane} />
      <div className="flex-1 flex flex-col min-h-0">{body}</div>

      {/* Right-edge split drop target — only rendered (and only intercepts
          events) while a tab is actively being dragged. Otherwise clicks in
          the right portion of the editor would get eaten. */}
      {allowSplitDropZone && tabDragActive && !isMobile && (
        <div
          onDragOver={handleRightEdgeDragOver}
          onDragLeave={() => setSplitDropActive(false)}
          onDrop={handleRightEdgeDrop}
          className={`absolute top-0 right-0 h-full w-1/3 z-10 transition-colors ${
            splitDropActive
              ? 'bg-obsidianAccentPurple/20 border-l-2 border-obsidianAccentPurple'
              : 'bg-obsidianAccentPurple/5 border-l border-obsidianAccentPurple/40 border-dashed'
          }`}
        >
          {!splitDropActive && (
            <div className="absolute top-1/2 -translate-y-1/2 right-3 text-xs text-obsidianAccentPurple/80 font-medium pointer-events-none">
              Drop to split →
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Pane
