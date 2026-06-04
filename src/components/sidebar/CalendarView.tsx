'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore, useWorkspaceStore, useSettingsStore, useUIStore } from '@/stores'
import { useHydration } from '@/hooks'
import { dailyNotesFolder } from '@/utils/systemFolder'
import { formatDate } from '@/utils/dateFormat'
import { dayHeadersForWeekStart, leadingBlankCount } from '@/utils/calendarGrid'
import { CalendarDayContextMenu } from './CalendarDayContextMenu'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Context-menu state for the right-click flow. `day` is the 1-indexed
// day of the month being acted on, `title` is the formatted daily-note
// title (used as the wikilink target + the lookup key), `noteId` is
// the existing daily-note id (or null when the day has no note yet).
interface DayMenuState {
  day: number
  title: string
  noteId: string | null
  x: number
  y: number
}

export const CalendarView = () => {
  const hydrated = useHydration()
  const today = new Date()
  const [viewDate, setViewDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  )

  const { notes, addNote } = useNoteStore()
  const openNote = useWorkspaceStore(s => s.openNote)
  const splitTabRight = useWorkspaceStore(s => s.splitTabRight)
  const openModal = useUIStore(s => s.openModal)
  const ensureFolderPath = useFolderStore(s => s.ensureFolderPath)
  const dateFormat = useSettingsStore(s => s.dailyNoteDateFormat)
  const dailyTemplateId = useSettingsStore(s => s.dailyNoteTemplateId)
  const weekStartDay = useSettingsStore(s => s.calendarWeekStartDay)

  const [menu, setMenu] = useState<DayMenuState | null>(null)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const activeNotes = useMemo(
    () => (hydrated ? notes.filter(n => !n.isDeleted) : []),
    [hydrated, notes]
  )

  // Days in this month that have a daily note — match by formatted date
  // title against the configured format. We compute the title once per
  // day and look it up in the active notes set.
  const notedDays = useMemo(() => {
    const set = new Set<number>()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const titlesByDay = new Map<string, number>()
    for (let d = 1; d <= daysInMonth; d++) {
      titlesByDay.set(formatDate(new Date(year, month, d), dateFormat || 'YYYY-MM-DD'), d)
    }
    for (const n of activeNotes) {
      const day = titlesByDay.get(n.title)
      if (day !== undefined) set.add(day)
    }
    return set
  }, [activeNotes, year, month, dateFormat])

  // Leading blanks before day 1, measured from the configured week-start
  // day so column 0 of the grid lines up with the rotated headers.
  const leadingBlanks = leadingBlankCount(
    new Date(year, month, 1).getDay(),
    weekStartDay,
  )
  const dayHeaders = dayHeadersForWeekStart(weekStartDay)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth()

  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  // Resolve the daily-note id for a given day, or null if it doesn't
  // exist yet. Exported as a memoised lookup so the right-click handler
  // doesn't re-scan the notes array on every render. Mirrors the lookup
  // in openDay: same folder, same formatted title.
  const findDailyNoteId = useCallback(
    (day: number): { id: string | null; title: string } => {
      const dayDate = new Date(year, month, day)
      const title = formatDate(dayDate, dateFormat || 'YYYY-MM-DD')
      const folderId = ensureFolderPath(dailyNotesFolder.get().split('/'))
      const existing = activeNotes.find(
        n => n.folderId === folderId && n.title === title,
      )
      return { id: existing?.id ?? null, title }
    },
    [activeNotes, year, month, dateFormat, ensureFolderPath],
  )

  const openDay = (day: number) => {
    const dayDate = new Date(year, month, day)
    const title = formatDate(dayDate, dateFormat || 'YYYY-MM-DD')
    const folderId = ensureFolderPath(dailyNotesFolder.get().split('/'))
    const existing = activeNotes.find(n => n.folderId === folderId && n.title === title)
    if (existing) {
      openNote(existing.id)
      return
    }
    const template = dailyTemplateId
      ? notes.find(n => !n.isDeleted && n.id === dailyTemplateId)
      : undefined
    const created = addNote({
      title,
      folderId,
      content: template?.content ?? '',
    })
    openNote(created.id)
  }

  const goToToday = () => {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))
    openDay(today.getDate())
  }

  const onDayContextMenu = (e: React.MouseEvent, day: number) => {
    e.preventDefault()
    const { id, title } = findDailyNoteId(day)
    setMenu({ day, title, noteId: id, x: e.clientX, y: e.clientY })
  }

  const closeMenu = () => setMenu(null)

  // ── Menu action handlers — each closes the menu first so dismissal
  // can't race with the action's own state writes (e.g. openModal
  // mounting the delete confirm). The handlers branch on `menu` early
  // because TS doesn't track the close-then-act ordering through the
  // setter.

  const handleOpenDailyNote = () => {
    if (!menu?.noteId) return
    openNote(menu.noteId)
    closeMenu()
  }

  const handleOpenInNewPane = () => {
    if (!menu?.noteId) return
    // splitTabRight expects a TAB id, not a note id. Opening the note
    // first lands it as a tab in the active pane (creating one if it
    // wasn't already open); we then look up the freshly-opened tab and
    // hand its id to splitTabRight. The non-preview flag pins the tab
    // so the split doesn't immediately swallow it on the next click.
    openNote(menu.noteId, { preview: false })
    const ws = useWorkspaceStore.getState()
    const activePane = ws.panes.find(p => p.id === ws.activePaneId) ?? ws.panes[0]
    const tab = activePane?.tabs.find(
      t => t.kind === 'note' && t.noteId === menu.noteId,
    )
    if (tab) splitTabRight(tab.id)
    closeMenu()
  }

  const handleCopyWikilink = () => {
    if (!menu) return
    const link = `[[${menu.title}]]`
    try {
      navigator.clipboard?.writeText(link)
    } catch {
      // Clipboard API may be unavailable in non-secure contexts or
      // older browsers. Fall back silently — the menu still closes and
      // the user can re-try. No toast: keeps the surface quiet.
    }
    closeMenu()
  }

  const handleToggleBookmark = () => {
    if (!menu?.noteId) return
    // Bookmarks reuse `note.isPinned` (see SidebarBookmarksPanel). Toggle
    // through the store so a subsequent right-click reflects the new
    // state without us having to re-derive isBookmarked locally.
    useNoteStore.getState().togglePinNote(menu.noteId)
    closeMenu()
  }

  const handleDeleteDailyNote = () => {
    if (!menu?.noteId) return
    const { confirmBeforeTrash, trashMode } = useSettingsStore.getState()
    // Bypass the modal ONLY in soft-delete mode. hardDelete is
    // irreversible — always confirm so a stray right-click doesn't
    // permanently lose a daily note.
    if (!confirmBeforeTrash && trashMode !== 'hardDelete') {
      useNoteStore.getState().deleteNote(menu.noteId)
      closeMenu()
      return
    }
    openModal({
      type: 'delete',
      data: { type: 'note', id: menu.noteId },
    })
    closeMenu()
  }

  const handleCreateDailyNote = () => {
    if (!menu) return
    openDay(menu.day)
    closeMenu()
  }

  // Whether the menu's target day is already bookmarked. Read at render
  // time so the label flips immediately after a toggle.
  const menuTargetBookmarked = !!menu?.noteId && !!notes.find(
    n => n.id === menu.noteId && n.isPinned,
  )

  return (
    <div className="px-1 select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="obsidian-button p-1"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium text-obsidianText">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="obsidian-button p-1"
        >
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {dayHeaders.map(d => (
          <div
            key={d}
            className="text-center text-[10px] text-obsidianSecondaryText py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />

          const isToday = isCurrentMonth && day === today.getDate()
          const hasNote = notedDays.has(day)

          return (
            <button
              key={day}
              onClick={() => openDay(day)}
              onContextMenu={(e) => onDayContextMenu(e, day)}
              className={`relative flex flex-col items-center justify-center rounded py-1 text-xs transition-colors ${
                isToday
                  ? 'bg-obsidianAccentPurple text-white font-semibold'
                  : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText'
              }`}
              data-testid={`calendar-day-${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
            >
              {day}
              {hasNote && !isToday && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-obsidianAccentPurple" />
              )}
            </button>
          )
        })}
      </div>

      {/* Jump-to-today link when browsing another month */}
      {!isCurrentMonth && (
        <button
          onClick={goToToday}
          className="mt-3 w-full text-xs text-obsidianAccentPurple hover:underline transition-colors text-center"
        >
          Today
        </button>
      )}

      {menu && (
        <CalendarDayContextMenu
          x={menu.x}
          y={menu.y}
          hasDailyNote={menu.noteId !== null}
          isBookmarked={menuTargetBookmarked}
          onOpenDailyNote={handleOpenDailyNote}
          onOpenInNewPane={handleOpenInNewPane}
          onCopyWikilink={handleCopyWikilink}
          onToggleBookmark={handleToggleBookmark}
          onDeleteDailyNote={handleDeleteDailyNote}
          onCreateDailyNote={handleCreateDailyNote}
          onDismiss={closeMenu}
        />
      )}
    </div>
  )
}

export default CalendarView
