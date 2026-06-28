'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore, useWorkspaceStore, useSettingsStore, useUIStore } from '@/stores'
import { useHydration } from '@/hooks'
import { dailyNotesFolder } from '@/utils/systemFolder'
import { formatDate } from '@/utils/dateFormat'
import {
  dayHeadersForWeekStart,
  leadingBlankCount,
  isoWeekNumber,
  mondayOfIsoWeek,
} from '@/utils/calendarGrid'
import { openWeekNote, findWeeklyNoteId } from '@/utils/periodicNotes'
import { resolveTemplateContent } from '@/utils/templateResolve'
import { CalendarDayContextMenu } from './CalendarDayContextMenu'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Context-menu state for the right-click flow. `mode` distinguishes a
// click on a day cell (default) from a click on the new W-column
// week-number cell (2026-06-04 — the menu now works for weekly notes
// too). For 'day' mode `day` is the 1-indexed day-of-month; for
// 'week' mode `weekStart` is the Monday of the row's ISO week.
// `title` is the formatted target-note title (used as the wikilink +
// the lookup key), `noteId` is the existing daily/weekly note id (or
// null when no note exists yet).
interface CellMenuState {
  mode: 'day' | 'week'
  day: number | null      // day-of-month for 'day' mode
  weekStart: Date | null  // Monday of the row for 'week' mode
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

  const notes = useNoteStore(s => s.notes)
  const addNote = useNoteStore(s => s.addNote)
  const openNote = useWorkspaceStore(s => s.openNote)
  const splitTabRight = useWorkspaceStore(s => s.splitTabRight)
  const openModal = useUIStore(s => s.openModal)
  const ensureFolderPath = useFolderStore(s => s.ensureFolderPath)
  const dateFormat = useSettingsStore(s => s.dailyNoteDateFormat)
  const weekStartDay = useSettingsStore(s => s.calendarWeekStartDay)

  const [menu, setMenu] = useState<CellMenuState | null>(null)

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

  const openDay = (day: number, dayYear: number = year, dayMonth: number = month) => {
    const dayDate = new Date(dayYear, dayMonth, day)
    const title = formatDate(dayDate, dateFormat || 'YYYY-MM-DD')
    const folderId = ensureFolderPath(dailyNotesFolder.get().split('/'))
    const existing = activeNotes.find(n => n.folderId === folderId && n.title === title)
    if (existing) {
      openNote(existing.id)
      return
    }
    const created = addNote({
      title,
      folderId,
      content: resolveTemplateContent('daily') ?? '',
    })
    openNote(created.id)
  }

  const goToToday = () => {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))
    openDay(today.getDate(), today.getFullYear(), today.getMonth())
  }

  const onDayContextMenu = (e: React.MouseEvent, day: number) => {
    e.preventDefault()
    const { id, title } = findDailyNoteId(day)
    setMenu({ mode: 'day', day, weekStart: null, title, noteId: id, x: e.clientX, y: e.clientY })
  }

  // Click handler for a W-column cell. Resolves the Monday of the
  // row's ISO week from the leftmost real day in that row, then opens
  // / creates the weekly note via openWeekNote. The row's leftmost
  // cell may be a leading blank when the row spans a month boundary —
  // in that case we anchor on the FIRST non-blank day of the row.
  const openWeek = (weekStart: Date) => {
    openWeekNote(weekStart)
  }

  const onWeekContextMenu = (e: React.MouseEvent, weekStart: Date) => {
    e.preventDefault()
    const { id, title } = findWeeklyNoteId(weekStart)
    setMenu({ mode: 'week', day: null, weekStart, title, noteId: id, x: e.clientX, y: e.clientY })
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
    if (menu.mode === 'week' && menu.weekStart) {
      openWeek(menu.weekStart)
    } else if (menu.mode === 'day' && menu.day != null) {
      openDay(menu.day)
    }
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

      {/* Headers row: W column on the far left, then the 7 day-of-week
          headers. `[auto_repeat(7,_1fr)]` keeps the W column tight to
          its content while the 7 day columns share the remaining
          width equally — same per-row layout as the day grid below. */}
      {/* Headers row. The W column gets an explicit 18px width AND an
          extra 4px right margin (via gap-x-1) so the day columns get
          breathing room from the week numbers. User feedback 2026-06-04
          flagged the previous flush layout as "squeezed". */}
      <div className="grid grid-cols-[18px_repeat(7,_1fr)] gap-x-1 mb-1">
        <div
          className="text-center text-[9px] text-obsidianSecondaryText/60 py-1"
          aria-label="ISO week number"
        >
          W
        </div>
        {dayHeaders.map(d => (
          <div
            key={d}
            className="text-center text-[10px] text-obsidianSecondaryText py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — chunked into rows so the W column can prepend a
          per-row cell. Each row is 1 W cell + 7 day cells; rows that
          start with a leading blank still anchor on the row's first
          REAL day (the Monday derived from that day is always the
          row's ISO-week Monday). */}
      <div className="grid grid-cols-[18px_repeat(7,_1fr)] gap-x-1 gap-y-0.5">
        {Array.from({ length: Math.ceil(cells.length / 7) }, (_, rowIdx) => {
          const rowStart = rowIdx * 7
          const rowCells = cells.slice(rowStart, rowStart + 7)
          // Find the row's anchor date: the first non-null day. Every
          // calendar row has at least one — the leading-blank rows
          // start the month at day 1, and trailing rows by definition
          // contain the last days of the month.
          const firstDayInRow = rowCells.find((d): d is number => d !== null)
          const anchorDate = firstDayInRow != null
            ? new Date(year, month, firstDayInRow)
            : null
          const weekMonday = anchorDate ? mondayOfIsoWeek(anchorDate) : null
          const weekNumber = anchorDate ? isoWeekNumber(anchorDate) : null

          return (
            <React.Fragment key={`row-${rowIdx}`}>
              {/* W column cell — small text button, muted compared to
                  day cells. Click opens / creates the weekly note;
                  right-click opens the same context menu the day cell
                  uses, but in 'week' mode. */}
              {weekNumber != null && weekMonday ? (
                <button
                  onClick={() => openWeek(weekMonday)}
                  onContextMenu={(e) => onWeekContextMenu(e, weekMonday)}
                  className="flex items-center justify-center rounded py-1 text-[9px] text-obsidianSecondaryText/70 hover:bg-obsidianHighlight hover:text-obsidianText transition-colors"
                  data-testid={`calendar-week-${weekMonday.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`}
                  title={`Week ${weekNumber} — open or create weekly note`}
                  aria-label={`Open weekly note for week ${weekNumber}`}
                >
                  {weekNumber}
                </button>
              ) : (
                <div />
              )}
              {rowCells.map((day, i) => {
                if (!day) return <div key={`e-${rowIdx}-${i}`} />

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
            </React.Fragment>
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
          mode={menu.mode}
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
