// src/app/layout.js
import '../styles/globals.css'
import Link from 'next/link'

export const metadata = {
  title: 'Noteser',
  description: 'A simple note-taking app'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white">
        <nav className="flex gap-4 p-2 border-b border-obsidianBorder">
          <Link href="/">Notes</Link>
          <Link href="/calendar">Calendar</Link>
          <Link href="/graph">Graph</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
