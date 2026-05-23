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

export default function PrismHighlighter({ language, children, className }: Props) {
  return (
    <SyntaxHighlighter
      style={oneDark}
      language={language}
      PreTag="div"
      className={className}
    >
      {children}
    </SyntaxHighlighter>
  )
}
