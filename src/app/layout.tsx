import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Noteser - Collaborative Note Taking',
  description: 'A modern, collaborative note-taking app with real-time sync, markdown support, and offline capabilities.',
  keywords: ['notes', 'markdown', 'collaborative', 'productivity', 'writing'],
  authors: [{ name: 'Noteser' }],
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png'
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1b1b1b'
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-obsidianBlack text-obsidianText antialiased">
        {children}
      </body>
    </html>
  )
}
