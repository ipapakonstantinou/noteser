'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

// The app had no error boundary anywhere, so ANY throw inside the markdown
// renderer unmounted the whole React tree — and because the offending note is
// still there after a reload, the app stayed broken. One malformed
// `[x](wikilink://%)` was enough (see decodeWikilinkHref).
//
// Deliberately narrow: it wraps the reading-mode renderer, shows the note's
// content as plain text so the user can still read and fix it, and resets when
// `resetKey` changes (the note id) so switching notes clears the error rather
// than latching it. Not an app-wide boundary — a crash elsewhere should still
// be loud in development.
interface Props {
  children: ReactNode
  /** Changing this clears a caught error (pass the note id). */
  resetKey?: string
  /** Rendered under the message — the raw note body, so the note is readable
   *  even while it cannot be rendered. */
  fallbackContent?: string
}

interface State {
  message: string | null
  seenKey?: string
}

export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    if (state.seenKey !== props.resetKey) {
      return { message: null, seenKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[render] note failed to render:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children
    return (
      <div data-testid="render-error-fallback" className="not-prose">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-obsidianText">
          <div className="font-medium">This note could not be rendered.</div>
          <div className="mt-1 text-xs text-obsidianSecondaryText">
            Switch to editing mode to fix it. The raw text is below.
          </div>
          <div className="mt-1 text-xs text-obsidianSecondaryText/80">{this.state.message}</div>
        </div>
        {this.props.fallbackContent !== undefined && (
          <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-obsidianText">
            {this.props.fallbackContent}
          </pre>
        )}
      </div>
    )
  }
}

export default RenderErrorBoundary
