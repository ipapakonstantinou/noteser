'use client'

import { useState, useMemo } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { useHydration } from '@/hooks'
import { dailyNotesFolder } from '@/utils/systemFolder'
import { formatDate } from '@/utils/dateFormat'
import { dayHeadersForWeekStart, leadingBlankCount } from '@/utils/calendarGrid'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const CalendarView = () => {
  const hydrated = useHydration()
  const today = new Date()
  const [viewDate, setViewDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  )

  const { notes, addNote } = useNoteStore()
  const openNote = useWorkspaceStore(s => s.openNote)
  const ensureFolderPath = useFolderStore(s => s.ensureFolderPath)
  const dateFormat = useSettingsStore(s => s.dailyNoteDateFormat)
  const dailyTemplateId = useSettingsStore(s => s.dailyNoteTemplateId)
  const weekStartDay = useSettingsStore(s => s.calendarWeekStartDay)

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
              className={`relative flex flex-col items-center justify-center rounded py-1 text-xs transition-colors ${
                isToday
                  ? 'bg-obsidianAccentPurple text-white font-semibold'
                  : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText'
              }`}
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
    </div>
  )
}

export default CalendarView
