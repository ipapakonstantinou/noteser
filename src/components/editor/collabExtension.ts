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
import { blobToBase64, base64ToBytes } from '@/utils/github'
import { getAttachmentBlob, putAttachmentAtPath } from '@/utils/attachments'

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

// One relayed attachment. Content is base64 (see MAX_COLLAB_ATTACHMENT_BYTES
// below for why this stays unchunked).
export interface AttachmentEntry {
  data: string
  mime: string
  name: string
}

// Cap on the ORIGINAL blob size for live attachment relay. Two independent
// platform ceilings are in play, and this cap is sized against the tighter
// one: the collab worker's Durable Object is SQLite-backed (see
// collab-server/wrangler.toml) with a 2 MB combined key+value limit per
// storage.put — and it persists the ENTIRE Y.Doc (this note's text history
// AND every attachment entry) as a single value. The 32 MiB Workers
// WebSocket message ceiling is not the binding constraint. 1 MiB raw
// (~1.33 MiB base64) leaves headroom under the 2 MB storage ceiling for the
// note's own text plus more than one attachment, while still covering the
// realistic paste-a-screenshot case. Oversized attachments just skip the
// live relay — the existing GitHub sync path still carries them, so nothing
// is lost, only delayed until the next sync.
export const MAX_COLLAB_ATTACHMENT_BYTES = 1024 * 1024

export interface CollabBinding {
  // The CodeMirror extension to splice into the editor's extension list.
  extension: Extension
  doc: Y.Doc
  provider: ProviderLike
  ytext: Y.Text
  // Shared attachment channel, keyed by attachment path. Exposed mainly for
  // tests; callers should go through shareAttachment rather than writing to
  // it directly.
  attachments: Y.Map<AttachmentEntry>
  // Base64-encode `blob` and publish it under `path` on the shared
  // attachments map, so other collaborators on this room receive it. A no-op
  // (after teardown) or a skip-with-warning (over size cap) never throws —
  // callers fire this after their own local save already succeeded, so a
  // relay failure must not surface as a paste/attach error.
  shareAttachment: (path: string, blob: Blob, originalName?: string) => Promise<void>
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

// Shared meta map key prefix recording which clients seeded a fresh room.
// One entry per seeder: `seeder:<clientID> → 1`. Used to elect a single
// deterministic "collapser" when a concurrent seed race happens.
const SEEDER_PREFIX = 'seeder:'

/**
 * Build the live-collaboration binding for one note. Callers (the editor)
 * only invoke this when collab is enabled AND a note is open, passing the
 * note's stable collabId as `room`.
 *
 * Seeding (and the concurrent-seed race): we attach the local content to the
 * Y.Text only AFTER the provider reports 'sync' AND the shared text is still
 * empty. The `ytext.length === 0` check alone is NOT race-safe: when two
 * empty clients (e.g. a PC and a phone) join the same fresh room at nearly
 * the same time, both fire 'sync' while still empty and BOTH insert
 * `initialContent`. The Y.Text is a sequence CRDT, so the two inserts both
 * survive the merge → the body appears N times and (once saved back) the
 * duplication compounds day over day. A plain `meta.seeded` flag does NOT fix
 * this either: the Y.Map flag resolves last-write-wins to one value, but the
 * two text inserts still both survive.
 *
 * The fix is a self-healing single-seeder election that needs no server or
 * protocol change:
 *   1. Every client that seeds records `seeder:<its clientID>` in a shared
 *      `meta` Y.Map (in the same transaction as the insert).
 *   2. The elected "collapser" is the LOWEST clientID among recorded seeders.
 *      Reacting to text/meta changes, the collapser deletes the duplicate
 *      copies, keeping exactly one — but ONLY when the text is an exact
 *      k-fold (k≥2) repeat of `initialContent`. If a real edit landed during
 *      the race window the text is no longer an exact repeat, so we leave it
 *      untouched: never destroy a genuine edit (data safety over tidiness).
 * This converges to a single body regardless of message timing.
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
  const meta = doc.getMap<number>('meta')
  const attachments = doc.getMap<AttachmentEntry>('attachments')
  const provider = providerFactory(url, room, doc)
  const myKey = SEEDER_PREFIX + doc.clientID

  // Awareness — label this client's cursor for remote peers. Derive a
  // stable color from the GitHub login when available; otherwise a random
  // seed so anonymous cursors are still distinguishable.
  const name = user?.login ?? 'anonymous'
  const colorSeed = user?.login ?? Math.random().toString(36).slice(2)
  provider.awareness.setLocalStateField('user', {
    name,
    color: colorForUser(colorSeed),
  })

  let destroyed = false

  // Collapse a concurrent double-seed back to a single body. Only the elected
  // collapser (lowest seeder clientID) acts, and only when the text is an
  // EXACT k-fold (k≥2) repeat of initialContent — see the doc comment above.
  // Idempotent and re-entrant: re-runs on every text/meta change until the
  // text is a single copy (or has been genuinely edited), so a late-arriving
  // concurrent seed is trimmed too.
  const reconcileSeed = () => {
    if (destroyed || initialContent.length === 0) return
    const seederIds: number[] = []
    for (const k of meta.keys()) {
      if (!k.startsWith(SEEDER_PREFIX)) continue
      const id = Number(k.slice(SEEDER_PREFIX.length))
      if (Number.isFinite(id)) seederIds.push(id)
    }
    if (seederIds.length < 2) return // no concurrent seed → nothing to collapse
    if (doc.clientID !== Math.min(...seederIds)) return // not the elected collapser

    const text = ytext.toString()
    const unit = initialContent.length
    if (text.length <= unit || text.length % unit !== 0) return
    const k = text.length / unit
    if (text !== initialContent.repeat(k)) return // a real edit happened → leave it

    doc.transact(() => {
      // Keep the first copy; drop the remaining (k-1) identical copies.
      ytext.delete(unit, text.length - unit)
      // Prune the losers' markers so meta converges to just the collapser's.
      for (const id of seederIds) {
        if (id !== doc.clientID) meta.delete(SEEDER_PREFIX + id)
      }
    })
  }

  // Seed-on-empty: wait for the first sync, then seed only if the room is
  // still empty. Records this client as a seeder (same transaction) so a
  // concurrent double-seed can be detected and collapsed.
  const onSync = (isSynced: boolean) => {
    if (!isSynced) return
    if (ytext.length === 0 && initialContent.length > 0) {
      doc.transact(() => {
        meta.set(myKey, 1)
        ytext.insert(0, initialContent)
      })
    }
    reconcileSeed()
  }
  provider.on('sync', onSync)

  // React to remote seeds / text arriving so the elected collapser trims any
  // duplicate a concurrent seeder produced, converging to one copy.
  const onChange = () => reconcileSeed()
  ytext.observe(onChange)
  meta.observe(onChange)

  // Publish a pasted/dropped attachment to every collaborator on this note.
  // Caller has already written the blob into its own IndexedDB (saveAttachment
  // succeeded) before calling this, which is exactly why the loop-prevention
  // below is safe: a `local` transaction is guaranteed to be this device's
  // own write, already persisted, so the receiving observer can ignore it
  // outright instead of re-deriving "did I already write this".
  const shareAttachment = async (
    path: string,
    blob: Blob,
    originalName?: string,
  ): Promise<void> => {
    if (destroyed) return
    if (blob.size > MAX_COLLAB_ATTACHMENT_BYTES) {
      console.warn(
        `[collab] attachment too large to live-relay (${blob.size} bytes) — ` +
          `will still reach other devices via GitHub sync: ${path}`,
      )
      return
    }
    const data = await blobToBase64(blob)
    if (destroyed) return
    doc.transact(() => {
      attachments.set(path, {
        data,
        mime: blob.type || 'application/octet-stream',
        name: originalName ?? path.split('/').pop() ?? path,
      })
    })
  }

  // Receive an attachment a remote collaborator shared: decode it and land it
  // in this device's own IndexedDB via the SAME putAttachmentAtPath the
  // GitHub-sync pull path uses, so it survives after the collab session ends.
  const receiveAttachment = async (path: string, entry: AttachmentEntry): Promise<void> => {
    if (destroyed) return
    // Idempotency guard doubles as the OTHER half of loop-prevention: even if
    // a transaction's `local` flag were ever wrong, an attachment already on
    // disk is never re-written, so at worst this is a no-op re-check.
    const existing = await getAttachmentBlob(path)
    if (existing) return
    const bytes = base64ToBytes(entry.data)
    const blob = new Blob([bytes.slice()], { type: entry.mime })
    await putAttachmentAtPath(path, blob, entry.name)
  }

  const onAttachmentsChange = (event: Y.YMapEvent<AttachmentEntry>) => {
    // A `local` transaction is this device's own shareAttachment() write —
    // the blob is already in this device's IndexedDB (that's WHY it got
    // shared), so re-processing it here would be redundant at best.
    if (event.transaction.local) return
    for (const path of event.keysChanged) {
      const entry = attachments.get(path)
      if (!entry) continue // deletions aren't modeled for this feature
      void receiveAttachment(path, entry)
    }
  }
  attachments.observe(onAttachmentsChange)

  const extension = yCollab(ytext, provider.awareness as never)

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    provider.off?.('sync', onSync)
    try {
      ytext.unobserve(onChange)
      meta.unobserve(onChange)
      attachments.unobserve(onAttachmentsChange)
    } catch {
      /* ignore — observers may already be gone with the doc */
    }
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

  return { extension, doc, provider, ytext, attachments, shareAttachment, destroy }
}
