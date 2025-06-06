'use client'
import { useRouter } from 'next/navigation'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'

export default function CalendarPage() {
  const router = useRouter()

  const onChange = date => {
    const iso = date.toISOString().slice(0, 10)
    router.push(`/?date=${iso}`)
  }

  return (
    <div className="p-4 flex justify-center">
      <Calendar onChange={onChange} className="bg-obsidianGray text-white p-2" />
    </div>
  )
}
