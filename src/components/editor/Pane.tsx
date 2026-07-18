'use client'

import { useState } from 'react'
import { DocumentTextIcon, CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useUIStore, useWorkspaceStore } from '@/stores'
import { Button } from '@/components/ui'
import { useTabDragActive, TAB_DRAG_MIME, useViewport } from '@/hooks'
import { EditorHeader } from './EditorHeader'
import { EditorContent } from './EditorContent'
import { TabBar } from './TabBar'
import { MergeEditorView } from './MergeEditorView'
import { MergeBatchView } from './MergeBatchView'
import { CompareView } from './CompareView'
import { WelcomePane } from './WelcomePane'
import { EmptyState } from '@/components/ui'
import { MAX_PANES, type PaneState, type PaneDropRegion } from '@/stores/workspaceStore'

// A single editor pane. Renders its own TabBar + whatever the active tab
// shows. A drop zone on the right edge allows the user to drag a tab from
// elsewhere to create a split.
interface Props {
  pane: PaneState
}

export const Pane = ({ pane }: Props) => {
  const notes = useNoteStore(s => s.notes)
  const updateNote = useNoteStore(s => s.updateNote)
  const isPreviewMode = useUIStore(s => s.isPreviewMode)
  const focusPane = useWorkspaceStore(s => s.focusPane)
  const promoteTab = useWorkspaceStore(s => s.promoteTab)
  const dropTabOnPane = useWorkspaceStore(s => s.dropTabOnPane)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const paneCount = useWorkspaceStore(s => s.panes.length)
  const canSplitMore = paneCount < MAX_PANES

  const [dropRegion, setDropRegion] = useState<PaneDropRegion | null>(null)
  const tabDragActive = useTabDragActive()
  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId) ?? null
  const isActive = pane.id === activePaneId

  // Mobile viewports skip the split-pane affordance entirely — there
  // isn't room for two columns of editor. The drop-zone handlers don't
  // even mount in that case (see render below).
  const { isMobile } = useViewport()

  // VS Code-style drop regions: the outer fifths of the pane body split
  // toward that edge; everything else is "move into this pane". When the
  // workspace is at its pane cap the whole body degrades to center (the
  // store would degrade an edge drop anyway — don't promise a split the
  // app can't deliver).
  const regionFromPointer = (e: React.DragEvent<HTMLDivElement>): PaneDropRegion => {
    if (!canSplitMore) return 'center'
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return 'center'
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0.2) return 'left'
    if (x > 0.8) return 'right'
    if (y < 0.2) return 'top'
    if (y > 0.8) return 'bottom'
    return 'center'
  }
  const handleOverlayDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropRegion(regionFromPointer(e))
  }
  const handleOverlayDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const tabId = e.dataTransfer.getData(TAB_DRAG_MIME)
    if (tabId) dropTabOnPane(tabId, pane.id, regionFromPointer(e))
    setDropRegion(null)
  }
  // Highlight covers the HALF of the pane the dropped tab would occupy
  // (mirrors VS Code's split preview), or the whole body for a move.
  // Fill/border live in `.pane-drop-highlight` (globals.css) — Tailwind
  // can't alpha-modify the var()-based accent, so the old
  // bg-obsidianAccentPurple/20 classes compiled to nothing and the
  // highlight was invisible. The transition morphs the region as the
  // pointer crosses zones.
  const highlightClassFor = (region: PaneDropRegion): string => {
    const base = 'absolute pane-drop-highlight rounded-xs pointer-events-none transition-all duration-150 ease-out'
    switch (region) {
      case 'left': return `${base} inset-y-0 left-0 w-1/2`
      case 'right': return `${base} inset-y-0 right-0 w-1/2`
      case 'top': return `${base} inset-x-0 top-0 h-1/2`
      case 'bottom': return `${base} inset-x-0 bottom-0 h-1/2`
      case 'center': return `${base} inset-0`
    }
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
        className="relative flex-1 flex flex-col min-h-0"
        role="tabpanel"
        id={`editor-tabpanel-${pane.id}`}
        aria-labelledby={activeTab ? `editor-tab-${activeTab.id}` : undefined}
      >
        {body}

        {/* Tab-drop overlay — only mounted while a tab is actively being
            dragged, so clicks are never intercepted. Covers the whole
            body (no dead no-drop zones): outer fifths split toward that
            edge, the middle moves the tab into this pane. The TabBar
            stays uncovered so its own reorder drop targets keep working. */}
        {tabDragActive && !isMobile && (
          <div
            onDragOver={handleOverlayDragOver}
            onDragLeave={() => setDropRegion(null)}
            onDrop={handleOverlayDrop}
            data-testid="pane-drop-overlay"
            className="absolute inset-0 z-10"
          >
            {dropRegion && (
              <div
                className={highlightClassFor(dropRegion)}
                data-testid={`pane-drop-${dropRegion}`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Pane
