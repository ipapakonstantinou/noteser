'use client'

// Phase B of live collaboration: a shared CRDT document (Y.Doc) per note,
// bound to the CodeMirror editor via yCollab so edits and remote cursors
// flow between clients connected to the same y-websocket room.
//
// CRITICAL: everything here is GATED on NEXT_PUBLIC_YJS_WS_URL being a
// valid ws:// / wss:// URL. `getConfiguredCollabUrl()` returns null
// otherwise, and the CodeMirror editor never calls `createCollabBinding`
// when it's null — so with the env var unset the editor behaves exactly
// as it did before this phase: no Y.Doc, no WebSocket, no awareness.
//
// The binding is deliberately framework-agnostic (no React) so it can be
// unit-tested with a mocked provider/awareness and torn down explicitly
// on note change / unmount.

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import type { Extension } from '@codemirror/state'
import type { GitHubUser } from '@/types'

// Shape of the awareness object we need — a minimal structural type so the
// binding can be unit-tested with a mock without dragging in the full
// y-protocols Awareness class. The real provider.awareness satisfies it.
export interface AwarenessLike {
  setLocalStateField: (field: string, value: unknown) => void
}

// Subset of WebsocketProvider the binding actually uses. Lets tests pass a
// lightweight fake (with a synchronous `on('sync', …)` trigger) instead of
// opening a socket.
export interface ProviderLike {
  awareness: AwarenessLike
  on: (event: 'sync', cb: (isSynced: boolean) => void) => void
  off?: (event: 'sync', cb: (isSynced: boolean) => void) => void
  destroy: () => void
}

// Factory the binding uses to build a provider. Injectable so tests can
// supply a fake; production uses `defaultProviderFactory` (real
// WebsocketProvider).
export type ProviderFactory = (
  url: string,
  room: string,
  doc: Y.Doc,
) => ProviderLike

export interface CollabBinding {
  // The CodeMirror extension to splice into the editor's extension list.
  extension: Extension
  doc: Y.Doc
  provider: ProviderLike
  ytext: Y.Text
  // Idempotent teardown — destroys the provider (closes the socket) and the
  // Y.Doc. Safe to call multiple times.
  destroy: () => void
}

export interface CreateCollabBindingOptions {
  url: string
  // The room name. MUST be the note's stable collabId so the shared
  // document survives renames / path changes.
  room: string
  // The note's current local content. Seeded into the Y.Text ONLY when the
  // doc arrives empty after the first sync (see below) so two clients
  // joining a fresh room don't double-seed.
  initialContent: string
  // Local user identity for awareness (remote-cursor labels). Optional —
  // when null we still set a color so cursors are visible, just unlabeled.
  user: GitHubUser | null
  // Injected for tests. Defaults to the real WebsocketProvider.
  providerFactory?: ProviderFactory
}

// Deterministic, pleasant cursor color derived from a string (login or a
// random fallback). Hashes to a hue so the same user keeps the same color
// across sessions and across clients (everyone derives it from the login).
export function colorForUser(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0 // force 32-bit
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 70%, 55%)`
}

// Real provider factory — opens the websocket. WebsocketProvider(url,
// room, doc) is exactly the Phase-B contract from the task.
export const defaultProviderFactory: ProviderFactory = (url, room, doc) =>
  new WebsocketProvider(url, room, doc) as unknown as ProviderLike

/**
 * Build the live-collaboration binding for one note. Callers (the editor)
 * only invoke this when collab is enabled AND a note is open, passing the
 * note's stable collabId as `room`.
 *
 * Seeding: we attach the local content to the Y.Text only AFTER the
 * provider reports 'sync' AND the shared text is still empty. This avoids a
 * double-seed race — the first client to join a fresh room seeds it; later
 * clients receive the already-seeded content over the wire and skip
 * seeding. (Checking `ytext.length === 0` post-sync is the documented Yjs
 * idiom for "is this a brand-new document".)
 */
export function createCollabBinding(
  options: CreateCollabBindingOptions,
): CollabBinding {
  const {
    url,
    room,
    initialContent,
    user,
    providerFactory = defaultProviderFactory,
  } = options

  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  const provider = providerFactory(url, room, doc)

  // Awareness — label this client's cursor for remote peers. Derive a
  // stable color from the GitHub login when available; otherwise a random
  // seed so anonymous cursors are still distinguishable.
  const name = user?.login ?? 'anonymous'
  const colorSeed = user?.login ?? Math.random().toString(36).slice(2)
  provider.awareness.setLocalStateField('user', {
    name,
    color: colorForUser(colorSeed),
  })

  // Seed-on-empty: wait for the first sync, then seed only if nobody else
  // already populated the room.
  const onSync = (isSynced: boolean) => {
    if (!isSynced) return
    if (ytext.length === 0 && initialContent.length > 0) {
      // Wrap in a transaction so it's a single CRDT update.
      doc.transact(() => {
        ytext.insert(0, initialContent)
      })
    }
  }
  provider.on('sync', onSync)

  const extension = yCollab(ytext, provider.awareness as never)

  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    provider.off?.('sync', onSync)
    try {
      provider.destroy()
    } catch {
      /* ignore — best-effort socket teardown */
    }
    try {
      doc.destroy()
    } catch {
      /* ignore */
    }
  }

  return { extension, doc, provider, ytext, destroy }
}
