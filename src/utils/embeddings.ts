// Embeddings + Related notes (a1f7).
//
// Per-note OpenAI embeddings stored in IDB. Index API is sync-friendly:
// callers fire indexNote() and we coalesce concurrent calls per noteId
// so a rapid save burst doesn't bombard the API. Related-notes look-up
// is pure cosine over the cached vectors — no API call.

import { get, set, del, keys } from 'idb-keyval'
import { embedText } from './aiClient'
import type { Note } from '@/types'

const EMBED_KEY_PREFIX = 'noteser-embed-'

export interface NoteEmbedding {
  noteId: string
  vector: number[]
  // Hash of the embedded text. Lets us skip re-embedding when a save
  // only changed whitespace / chrome the model wouldn't care about.
  contentHash: string
  embeddedAt: number
}

// Stable, fast, non-cryptographic. FNV-1a 32-bit — same family we use
// for the vault-settings hash. Plenty of bits for "did this string
// change since the last embed" comparison.
export function hashContent(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// What we actually send to the embedding API. Title + body — title
// alone is usually too short to carry signal; body alone misses the
// "what is this note about" framing. Trimmed + bounded so a giant
// note doesn't blow our request size.
const MAX_EMBED_CHARS = 8000
export function buildEmbedInput(note: Pick<Note, 'title' | 'content'>): string {
  const title = (note.title ?? '').trim()
  const body = (note.content ?? '').trim()
  const raw = title ? `${title}\n\n${body}` : body
  if (raw.length <= MAX_EMBED_CHARS) return raw
  // Keep the title + first chunk of body. Embedding the tail
  // separately is a future optimisation if users notice long-note
  // similarity quality.
  return raw.slice(0, MAX_EMBED_CHARS)
}

// ── IDB layer ──────────────────────────────────────────────────────────────

function keyFor(noteId: string): string {
  return `${EMBED_KEY_PREFIX}${noteId}`
}

export async function getEmbedding(noteId: string): Promise<NoteEmbedding | null> {
  const v = await get<NoteEmbedding>(keyFor(noteId))
  return v ?? null
}

export async function saveEmbedding(record: NoteEmbedding): Promise<void> {
  await set(keyFor(record.noteId), record)
}

export async function deleteEmbedding(noteId: string): Promise<void> {
  await del(keyFor(noteId))
}

export async function listAllEmbeddings(): Promise<NoteEmbedding[]> {
  const allKeys = await keys()
  const out: NoteEmbedding[] = []
  for (const k of allKeys) {
    if (typeof k !== 'string' || !k.startsWith(EMBED_KEY_PREFIX)) continue
    const v = await get<NoteEmbedding>(k)
    if (v) out.push(v)
  }
  return out
}

// Drop every cached embedding — used by "reset embeddings" and the
// wipeNoteserState helper. Safe to call on partial state.
export async function clearAllEmbeddings(): Promise<void> {
  const allKeys = await keys()
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith(EMBED_KEY_PREFIX)) {
      await del(k)
    }
  }
}

// ── Index a single note ────────────────────────────────────────────────────

const inflight = new Map<string, Promise<NoteEmbedding | null>>()

// Compute (or refresh) the embedding for `note`. Returns the resulting
// record (or null if nothing was needed — same hash already cached, or
// note has no content). Coalesces concurrent calls for the same note.
export async function indexNote(note: Pick<Note, 'id' | 'title' | 'content'>): Promise<NoteEmbedding | null> {
  if (inflight.has(note.id)) return inflight.get(note.id)!

  const promise = (async () => {
    const input = buildEmbedInput(note)
    if (!input) {
      // Empty note → drop any stale embedding so it doesn't pollute
      // the related-notes panel with a zero-vector match.
      await deleteEmbedding(note.id)
      return null
    }
    const contentHash = hashContent(input)
    const existing = await getEmbedding(note.id)
    if (existing && existing.contentHash === contentHash) return existing

    const vector = await embedText({ text: input })
    if (vector.length === 0) {
      await deleteEmbedding(note.id)
      return null
    }
    const record: NoteEmbedding = {
      noteId: note.id,
      vector,
      contentHash,
      embeddedAt: Date.now(),
    }
    await saveEmbedding(record)
    return record
  })()

  inflight.set(note.id, promise)
  try {
    return await promise
  } finally {
    inflight.delete(note.id)
  }
}

// ── Bulk index ─────────────────────────────────────────────────────────────

export interface IndexProgress {
  done: number
  total: number
  currentTitle: string
}

// Index every active note. Calls `onProgress` after each note so the
// UI can render a counter. Skips notes whose hash matches the cached
// vector, so re-running this is cheap.
export async function indexAllNotes(
  notes: Note[],
  onProgress?: (p: IndexProgress) => void,
): Promise<{ indexed: number; skipped: number; errors: number }> {
  const active = notes.filter(n => !n.isDeleted)
  let indexed = 0
  let skipped = 0
  let errors = 0
  for (let i = 0; i < active.length; i++) {
    const note = active[i]
    try {
      onProgress?.({ done: i, total: active.length, currentTitle: note.title || 'Untitled' })
      const input = buildEmbedInput(note)
      if (!input) { skipped++; continue }
      const contentHash = hashContent(input)
      const existing = await getEmbedding(note.id)
      if (existing && existing.contentHash === contentHash) {
        skipped++
      } else {
        const res = await indexNote(note)
        if (res) indexed++
        else skipped++
      }
    } catch {
      errors++
      // Keep going on per-note failures (likely rate limit or
      // transient 5xx). Aggregate count surfaces to the caller.
    }
  }
  onProgress?.({ done: active.length, total: active.length, currentTitle: '' })
  return { indexed, skipped, errors }
}

// ── Similarity + related notes ─────────────────────────────────────────────

// Cosine similarity of two equal-length vectors. Returns 0 when either
// is zero-norm (avoid NaN) so a missing/empty embedding ranks last.
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface RelatedNote {
  noteId: string
  score: number
}

// Top-K most similar embeddings to `targetVector`, excluding the
// target itself. Pure — pass in the candidates so callers can filter
// (e.g. skip trashed notes) before ranking.
export function topRelated(
  targetVector: number[],
  candidates: NoteEmbedding[],
  excludeNoteId: string,
  limit: number,
): RelatedNote[] {
  const scored: RelatedNote[] = []
  for (const c of candidates) {
    if (c.noteId === excludeNoteId) continue
    const score = cosineSimilarity(targetVector, c.vector)
    if (score > 0) scored.push({ noteId: c.noteId, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
