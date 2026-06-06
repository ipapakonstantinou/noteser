'use client'

import { useState } from 'react'
import { DocumentTextIcon, CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useUIStore, useWorkspaceStore } from '@/stores'
import { Button } from '@/components/ui'
import { useTabDragActive, TAB_DRAG_MIME, useViewport } from '@/hooks'
import { EditorHeader } from './EditorHeader'
import { EditorFooter } from './EditorFooter'
import { EditorContent } from './EditorContent'
import { TabBar } from './TabBar'
import { MergeEditorView } from './MergeEditorView'
import { MergeBatchView } from './MergeBatchView'
import { CompareView } from './CompareView'
import { WelcomePane } from './WelcomePane'
import { EmptyState } from '@/components/ui'
import type { PaneState } from '@/stores/workspaceStore'

// A single editor pane. Renders its own TabBar + whatever the active tab
// shows. A drop zone on the right edge allows the user to drag a tab from
// elsewhere to create a split.
interface Props {
  pane: PaneState
}

export const Pane = ({ pane }: Props) => {
  const { notes, updateNote } = useNoteStore()
  const { isPreviewMode } = useUIStore()
  const focusPane = useWorkspaceStore(s => s.focusPane)
  const promoteTab = useWorkspaceStore(s => s.promoteTab)
  const splitTabRight = useWorkspaceStore(s => s.splitTabRight)
  const splitTabDown = useWorkspaceStore(s => s.splitTabDown)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const paneCount = useWorkspaceStore(s => s.panes.length)
  const canSplitMore = paneCount < 3

  const [splitDropActive, setSplitDropActive] = useState<null | 'right' | 'bottom'>(null)
  const tabDragActive = useTabDragActive()
  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId) ?? null
  const isActive = pane.id === activePaneId

  // Mobile viewports skip the split-pane affordance entirely — there
  // isn't room for two columns of editor. The drop-zone handlers don't
  // even mount in that case (see render below).
  const { isMobile } = useViewport()

  const makeEdgeDragOver = (zone: 'right' | 'bottom') => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setSplitDropActive(zone)
  }
  const handleEdgeDrop = (zone: 'right' | 'bottom') => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const tabId = e.dataTransfer.getData(TAB_DRAG_MIME)
    if (tabId) {
      if (zone === 'right') splitTabRight(tabId)
      else splitTabDown(tabId)
    }
    setSplitDropActive(null)
  }

  let body: React.ReactNode
  if (!activeTab) {
    const handleOpenDaily = () => {
      // Dynamic import — matches the keyboard-shortcut handler so the
      // dailyNotes util isn't pulled into the editor entry chunk.
      import('@/utils/dailyNotes').then(({ openTodayNote }) => openTodayNote())
    }
    const handleNewNote = () => {
      const note = useNoteStore.getState().addNote({ title: 'Untitled', content: '' })
      useWorkspaceStore.getState().openNote(note.id, { preview: false })
    }
    body = (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<DocumentTextIcon className="w-16 h-16" />}
          title="No note selected"
          description="Pick a note from the sidebar, jump to today's daily note, or start a fresh one."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                onClick={handleOpenDaily}
                data-testid="empty-state-daily-note"
                className="gap-1.5"
              >
                <CalendarDaysIcon className="w-4 h-4" />
                Open today&apos;s daily note
              </Button>
              <Button
                variant="ghost"
                onClick={handleNewNote}
                data-testid="empty-state-new-note"
                className="gap-1.5"
              >
                <PlusIcon className="w-4 h-4" />
                New note
              </Button>
            </div>
          }
        />
      </div>
    )
  } else if (activeTab.kind === 'merge-conflict') {
    body = <MergeEditorView tabId={activeTab.id} conflict={activeTab.conflict} />
  } else if (activeTab.kind === 'merge-batch') {
    body = <MergeBatchView tabId={activeTab.id} conflicts={activeTab.conflicts} />
  } else if (activeTab.kind === 'compare') {
    body = (
      <CompareView
        tabId={activeTab.id}
        leftNoteId={activeTab.leftNoteId}
        rightNoteId={activeTab.rightNoteId}
      />
    )
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
          <EditorHeader note={note} paneId={pane.id} onTitleChange={handleTitleChange} />
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
      <div
        className="flex-1 flex flex-col min-h-0"
        role="tabpanel"
        id={`editor-tabpanel-${pane.id}`}
        aria-labelledby={activeTab ? `editor-tab-${activeTab.id}` : undefined}
      >{body}</div>

      {/* Right- and bottom-edge split drop targets — only rendered (and
          only intercepting events) while a tab is actively being
          dragged. Otherwise clicks in those regions would get eaten. */}
      {canSplitMore && tabDragActive && !isMobile && (
        <>
          <div
            onDragOver={makeEdgeDragOver('right')}
            onDragLeave={() => setSplitDropActive(null)}
            onDrop={handleEdgeDrop('right')}
            data-testid="pane-drop-right"
            className={`absolute top-0 right-0 h-2/3 w-1/3 z-10 transition-colors ${
              splitDropActive === 'right'
                ? 'bg-obsidianAccentPurple/20 border-l-2 border-obsidianAccentPurple'
                : 'bg-obsidianAccentPurple/5 border-l border-obsidianAccentPurple/40 border-dashed'
            }`}
          >
            {splitDropActive !== 'right' && (
              <div className="absolute top-1/2 -translate-y-1/2 right-3 text-xs text-obsidianAccentPurple/80 font-medium pointer-events-none">
                Drop to split right →
              </div>
            )}
          </div>
          <div
            onDragOver={makeEdgeDragOver('bottom')}
            onDragLeave={() => setSplitDropActive(null)}
            onDrop={handleEdgeDrop('bottom')}
            data-testid="pane-drop-bottom"
            className={`absolute bottom-0 left-0 right-0 h-1/3 z-10 transition-colors ${
              splitDropActive === 'bottom'
                ? 'bg-obsidianAccentPurple/20 border-t-2 border-obsidianAccentPurple'
                : 'bg-obsidianAccentPurple/5 border-t border-obsidianAccentPurple/40 border-dashed'
            }`}
          >
            {splitDropActive !== 'bottom' && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-3 text-xs text-obsidianAccentPurple/80 font-medium pointer-events-none">
                Drop to split down ↓
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default Pane
