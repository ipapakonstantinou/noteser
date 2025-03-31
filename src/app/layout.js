'use client'

import './globals.css'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="flex h-screen bg-gray-900 text-white">{children}</body>
    </html>
  )
}
