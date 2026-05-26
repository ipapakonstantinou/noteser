'use client'

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'

// Extracted so the host can `dynamic()` import this file and keep the
// ~300kB Prism + oneDark payload out of the main editor chunk. Only
// loads when the user renders a fenced code block in preview mode.

interface Props {
  language: string
  children: string
  className?: string
}

// oneDark hard-codes a monospace fontFamily on both the <pre> and the
// inner <code>. Override both with the user's code-font slot (fnt1) so a
// chosen Monospace / code font reaches syntax-highlighted fenced blocks
// too. Falls back to oneDark's own stack when --font-mono is unset.
const FONT_MONO = 'var(--font-mono, ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace)'

export default function PrismHighlighter({ language, children, className }: Props) {
  return (
    <SyntaxHighlighter
      style={oneDark}
      language={language}
      PreTag="div"
      className={className}
      customStyle={{ fontFamily: FONT_MONO }}
      codeTagProps={{ style: { fontFamily: FONT_MONO } }}
    >
      {children}
    </SyntaxHighlighter>
  )
}
