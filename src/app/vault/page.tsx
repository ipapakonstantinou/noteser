import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

// /vault — opinionated guide to using noteser.
//
// Reads src/app/vault/content.md at build time and renders it via the
// same react-markdown stack the /help and /changelog routes use. The
// markdown is the source of truth so Jon can edit prose without
// touching the React tree.

export const metadata = {
  title: 'How I use Noteser — Noteser',
  description:
    'An opinionated guide to using Noteser: eight personal rules, folders, links, daily / weekly / monthly rhythm, templates, and publishing the vault.',
}

// Fully static — content is fixed for a given deploy.
export const dynamic = 'force-static'

const CONTENT_PATH = path.join(process.cwd(), 'src/app/vault/content.md')
const CONTENT_BODY = fs.readFileSync(CONTENT_PATH, 'utf8')

export default function VaultPage() {
  return (
    <div className="min-h-dvh bg-obsidianBlack text-obsidianText">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-obsidianSecondaryText hover:text-obsidianText transition-colors mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to noteser
        </Link>
        <article className="prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{CONTENT_BODY}</ReactMarkdown>
        </article>
      </div>
    </div>
  )
}
