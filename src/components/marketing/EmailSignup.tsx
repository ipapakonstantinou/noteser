'use client'

import { useState, type FormEvent } from 'react'
import { EnvelopeIcon } from '@heroicons/react/24/outline'

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; alreadySubscribed: boolean }
  | { kind: 'error'; message: string }

interface Props {
  // Buttondown tag so Jon can later see attribution per surface
  // (e.g. site-landing vs settings-about).
  source?: string
  // Compact one-line layout for the Settings panel; the default
  // multi-line block is used on the WelcomePane.
  compact?: boolean
}

export const EmailSignup = ({ source = 'site-landing', compact = false }: Props) => {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (status.kind === 'submitting') return
    setStatus({ kind: 'submitting' })
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      })
      const data: { ok?: boolean; alreadySubscribed?: boolean; message?: string } = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setStatus({ kind: 'success', alreadySubscribed: !!data.alreadySubscribed })
        setEmail('')
        return
      }
      setStatus({ kind: 'error', message: data.message || 'Could not subscribe right now.' })
    } catch {
      setStatus({ kind: 'error', message: 'Network error. Please try again.' })
    }
  }

  if (status.kind === 'success') {
    return (
      <div
        role="status"
        className={
          compact
            ? 'text-xs text-obsidianText/90'
            : 'p-3 rounded-lg border border-obsidianAccentPurple/40 bg-obsidianAccentPurple/10 text-sm text-obsidianText'
        }
      >
        {status.alreadySubscribed
          ? "You are already on the list. Thanks for double-checking."
          : 'Subscribed. Watch your inbox for launch notes.'}
      </div>
    )
  }

  const formInner = (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={status.kind === 'submitting'}
          aria-label="Email address"
          // Inline style overrides iOS Safari's forced white background on
          // text inputs, which would otherwise leave the light obsidianText
          // colour unreadable on top of it.
          style={{ backgroundColor: 'var(--obsidian-black, #1b1b1b)', color: 'var(--obsidian-text, #dadada)' }}
          className="flex-1 appearance-none px-3 py-2 rounded-md border border-obsidianBorder text-sm placeholder:text-obsidianSecondaryText focus:outline-none focus:border-noteserAccent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={status.kind === 'submitting'}
          style={{ backgroundColor: 'var(--obsidian-accent-purple, hsl(217, 88%, 50%))' }}
          className="w-full sm:w-auto px-5 py-2 rounded-md text-white text-sm font-semibold hover:brightness-110 transition disabled:opacity-60 disabled:cursor-progress"
        >
          {status.kind === 'submitting' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      {status.kind === 'error' && (
        <div role="alert" className="text-xs text-red-300 mt-2">
          {status.message}
        </div>
      )}
    </>
  )

  if (compact) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-2">
        {formInner}
      </form>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 p-4 rounded-lg border border-noteserAccent/40 bg-noteserAccent/[0.06]"
    >
      <div>
        <h3 className="text-base font-semibold text-obsidianText flex items-center gap-2">
          <EnvelopeIcon className="w-5 h-5 text-noteserAccent" />
          Get launch updates
        </h3>
        <p className="text-xs text-obsidianSecondaryText mt-1">
          A short email when sync, mobile, and the next features land. No spam, no daily digest.
        </p>
      </div>
      {formInner}
    </form>
  )
}
