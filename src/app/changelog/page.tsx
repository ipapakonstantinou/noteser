import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

// /changelog — user-facing release notes.
//
// Reads CHANGELOG.md at the repo root at build time and renders it as
// a static page. Serving from a real file (not a hardcoded string) means
// PRs that touch features can update the same CHANGELOG.md without
// editing this component.
//
// Indexed by Google so searches like "noteser release notes" land here.

export const metadata = {
  title: 'Changelog — Noteser',
  description:
    'What is new in Noteser. Release notes from 2026 onward, including launch, sync hardening, and security follow-ups.',
}

// Mark this route as fully static so it lands at build time rather than
// being rendered per request. The CHANGELOG.md content is fixed for a
// given deploy.
export const dynamic = 'force-static'

// Read the file once at module load (build time). Doing it inside the
// component body would still be cached by Next, but module-scope is the
// clearer intent.
const CHANGELOG_PATH = path.join(process.cwd(), 'CHANGELOG.md')
const CHANGELOG_BODY = fs.readFileSync(CHANGELOG_PATH, 'utf8')

export default function ChangelogPage() {
  const body = CHANGELOG_BODY
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
      </div>
    </div>
  )
}
