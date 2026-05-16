'use client'

import { useState, useMemo } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore } from '@/stores'
import { useHydration } from '@/hooks'

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getDailyTemplate(date: Date): string {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  const month = date.toLocaleDateString('en-US', { month: 'long' })
  const day = date.getDate()
  const year = date.getFullYear()
  return `# ${weekday}, ${month} ${day}, ${year}

## Focus


## Notes


## Tasks
- [ ]
`
}

export const CalendarView = () => {
  const hydrated = useHydration()
  const today = new Date()
  const [viewDate, setViewDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  )

  const { notes, addNote, selectNote } = useNoteStore()
  const { folders, addFolder } = useFolderStore()

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const activeNotes = useMemo(
    () => (hydrated ? notes.filter(n => !n.isDeleted) : []),
    [hydrated, notes]
  )

  // Days in this month that have a daily note
  const notedDays = useMemo(() => {
    const set = new Set<number>()
    activeNotes.forEach(n => {
      const m = n.title.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (m && Number(m[1]) === year && Number(m[2]) - 1 === month) {
        set.add(Number(m[3]))
      }
    })
    return set
  }, [activeNotes, year, month])

  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth()

  const cells: (number | null)[] = [
    ...Array<null>(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const openDay = (day: number) => {
    const title = toDateKey(year, month, day)
    const existing = activeNotes.find(n => n.title === title)
    if (existing) {
      selectNote(existing.id)
      return
    }
    const folder =
      folders.find(f => !f.isDeleted && f.name === 'Daily Notes') ??
      addFolder({ name: 'Daily Notes' })
    addNote({ title, folderId: folder.id, content: getDailyTemplate(new Date(year, month, day)) })
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
        {DAY_HEADERS.map(d => (
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
