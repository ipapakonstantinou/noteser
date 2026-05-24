import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { PwaProvider } from '@/components/pwa/PwaProvider'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Noteser - Collaborative Note Taking',
  description: 'A modern, collaborative note-taking app with real-time sync, markdown support, and offline capabilities.',
  keywords: ['notes', 'markdown', 'collaborative', 'productivity', 'writing'],
  authors: [{ name: 'Noteser' }],
  applicationName: 'Noteser',
  manifest: '/manifest.json',
  // No manual `icons` block — Next.js 15 auto-discovers
  // src/app/icon.svg + src/app/apple-icon.png and emits the right
  // <link rel="icon"> / <link rel="apple-touch-icon"> tags automatically.
  // https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
  // iOS "Add to Home Screen": these emit the apple-mobile-web-app-* meta
  // tags Safari reads to launch the PWA standalone (no Safari chrome). The
  // black-translucent status bar lets our dark UI extend under the notch
  // (paired with viewportFit: 'cover' below).
  appleWebApp: {
    capable: true,
    title: 'Noteser',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Draw under the iPhone notch / home indicator so the dark shell is
  // edge-to-edge in standalone mode.
  viewportFit: 'cover',
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
        <PwaProvider />
      </body>
    </html>
  )
}
