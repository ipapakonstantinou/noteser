import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Noteser - Collaborative Note Taking',
  description: 'A modern, collaborative note-taking app with real-time sync, markdown support, and offline capabilities.',
  keywords: ['notes', 'markdown', 'collaborative', 'productivity', 'writing'],
  authors: [{ name: 'Noteser' }],
  manifest: '/manifest.json',
  // No manual `icons` block — Next.js 15 auto-discovers
  // src/app/icon.svg + src/app/apple-icon.svg and emits the right
  // <link> tags automatically.
  // https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
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
