import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
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

export default async function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  // Read the per-request nonce (minted in src/middleware.ts, forwarded via
  // the `x-nonce` request header; Next 15's headers() is async). We don't
  // need to stamp it onto each <script> ourselves: Next auto-applies the
  // nonce to its own framework/bundle scripts (and any next/script <Script>)
  // by parsing the request's Content-Security-Policy header. The reason we
  // still read it here is that touching headers() opts the whole route tree
  // into DYNAMIC rendering, which nonce-based CSP REQUIRES — a statically
  // prerendered page would carry no nonce on its scripts and 'strict-dynamic'
  // would then block them at runtime. Exposed via data-nonce purely so the
  // value is consumed (and visible) on the server-rendered shell.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" className="dark">
      <body
        className="bg-obsidianBlack text-obsidianText antialiased"
        data-nonce={nonce}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  )
}
