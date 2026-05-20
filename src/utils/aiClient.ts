/**
 * aiClient.ts
 *
 * Tiny browser-side wrapper around the Anthropic and OpenAI HTTP APIs.
 * Reads the user's BYO key + provider + model from `useSettingsStore` at
 * call time (not at module-load), so changes made in the Settings modal
 * take effect on the next call without any reload.
 *
 * Downstream features (note actions, embeddings, …) call `runPrompt()`
 * here instead of talking to provider SDKs directly. Keeping the surface
 * narrow lets us swap providers, add streaming, or proxy through a server
 * later without touching every call site.
 *
 * SECURITY NOTE: the API key is read from localStorage and sent directly
 * from the user's browser to the provider's API. See `settingsStore.ts`
 * for the full trust-model write-up. We attach
 * `anthropic-dangerous-direct-browser-access: true` to Anthropic calls so
 * their server allows the request (the header is opt-in acknowledgement
 * that the page is exposing the key from the browser).
 */

import { useSettingsStore } from '@/stores/settingsStore'

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RunPromptArgs {
  system?: string
  messages: AIMessage[]
}

/**
 * Typed error so callers can `catch` and show a friendly toast / inline
 * banner without resorting to instanceof Error + string matching.
 */
export class AIClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIClientError'
  }
}

// Exported for tests so they can target the same endpoints without
// hardcoding the URL in two places.
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
export const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

// Default OpenAI embedding model — small + cheap (1536 dim,
// ~$0.02/1M input tokens). User can override via aiEmbeddingsModel
// in settings if they want a different snapshot.
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

// Pull a best-effort error string out of an API JSON body. Both providers
// nest the user-facing message slightly differently; falling back to the
// raw text means we never lose information.
function extractApiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    // Anthropic: { error: { type, message } }
    if (b.error && typeof b.error === 'object') {
      const err = b.error as Record<string, unknown>
      if (typeof err.message === 'string') return err.message
    }
    // OpenAI: { error: { message, type, ... } } — same shape, handled above.
    // Some providers/proxies put the message at the top level:
    if (typeof b.message === 'string') return b.message
  }
  return fallback
}

/**
 * Send a single round-trip chat request to the configured provider and
 * return the assistant's text. Throws `AIClientError` on misconfiguration
 * or non-2xx responses.
 *
 * `system` is optional. `messages` should be a non-empty conversation
 * history; the last entry is typically the user prompt.
 */
export async function runPrompt({ system, messages }: RunPromptArgs): Promise<string> {
  const { aiProvider, aiApiKey, aiModel } = useSettingsStore.getState()

  if (aiProvider === 'off') {
    throw new AIClientError(
      'AI is turned off. Pick a provider in Settings → AI to enable AI features.'
    )
  }
  if (!aiApiKey) {
    throw new AIClientError(
      'No API key configured. Paste your provider key in Settings → AI to enable AI features.'
    )
  }

  if (aiProvider === 'anthropic') {
    return runAnthropic({ system, messages, apiKey: aiApiKey, model: aiModel })
  }
  if (aiProvider === 'openai') {
    return runOpenAI({ system, messages, apiKey: aiApiKey, model: aiModel })
  }

  // Exhaustiveness guard. If TS catches a missing branch above this is dead
  // code; at runtime it surfaces stray values clearly.
  throw new AIClientError(`Unknown AI provider: ${String(aiProvider)}`)
}

// ── Anthropic ────────────────────────────────────────────────────────────────

interface ProviderArgs {
  system?: string
  messages: AIMessage[]
  apiKey: string
  model: string
}

async function runAnthropic({ system, messages, apiKey, model }: ProviderArgs): Promise<string> {
  // Anthropic's `system` is a top-level field, not a message with role:'system'.
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    messages,
  }
  if (system) body.system = system

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for browser-side calls; without it Anthropic blocks the
      // request with a CORS error referencing this header.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })

  const json = await safeJson(res)
  if (!res.ok) {
    throw new AIClientError(
      `Anthropic API error (${res.status}): ${extractApiErrorMessage(json, res.statusText)}`
    )
  }
  // Response shape: { content: [{ type: 'text', text: '...' }, ...], ... }
  const content = (json as { content?: Array<{ type?: string; text?: string }> })?.content
  const firstText = Array.isArray(content)
    ? content.find((c) => c && typeof c.text === 'string')?.text
    : undefined
  if (typeof firstText !== 'string') {
    throw new AIClientError('Anthropic API returned no text content.')
  }
  return firstText
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function runOpenAI({ system, messages, apiKey, model }: ProviderArgs): Promise<string> {
  // OpenAI's chat-completions API takes the system prompt as the first
  // message with role:'system'. We prepend it when present.
  const fullMessages: Array<{ role: string; content: string }> = []
  if (system) fullMessages.push({ role: 'system', content: system })
  for (const m of messages) fullMessages.push({ role: m.role, content: m.content })

  const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: fullMessages }),
  })

  const json = await safeJson(res)
  if (!res.ok) {
    throw new AIClientError(
      `OpenAI API error (${res.status}): ${extractApiErrorMessage(json, res.statusText)}`
    )
  }
  const choices = (json as { choices?: Array<{ message?: { content?: string } }> })?.choices
  const text = Array.isArray(choices) ? choices[0]?.message?.content : undefined
  if (typeof text !== 'string') {
    throw new AIClientError('OpenAI API returned no message content.')
  }
  return text
}

// Some error responses (especially 5xx from a proxy) are not JSON. Falling
// back to `{}` lets the caller still surface the status code without a
// secondary parse-error masking the original failure.
async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

// ── Embeddings (a1f7) ──────────────────────────────────────────────────────
// Single-string embedding via OpenAI. Anthropic doesn't ship a public
// embedding endpoint, so we require an OpenAI key regardless of which
// chat provider the user picked. The caller is expected to gate UI
// entry points on `aiEmbeddingsEnabled` and an available OpenAI key.

export interface EmbedTextArgs {
  text: string
  // Optional override for the embedding model name. Defaults to
  // text-embedding-3-small (1536 dim, cheap).
  model?: string
  // Optional override for the API key. When omitted, falls back to
  // aiApiKey from settings IF aiProvider === 'openai'. Letting the
  // caller pass it lets us add a separate embeddings-specific key in
  // settings later without touching this signature.
  apiKey?: string
}

export async function embedText({ text, model, apiKey }: EmbedTextArgs): Promise<number[]> {
  // Resolve the key. v1 only supports OpenAI for embeddings; we surface
  // a typed error so the UI can route to the right "configure" hint.
  let key = apiKey
  if (!key) {
    const { aiProvider, aiApiKey } = useSettingsStore.getState()
    if (aiProvider !== 'openai') {
      throw new AIClientError(
        'Embeddings require an OpenAI API key. Switch the AI provider to OpenAI in Settings → AI.'
      )
    }
    key = aiApiKey
  }
  if (!key) {
    throw new AIClientError(
      'No OpenAI API key configured. Paste your key in Settings → AI to enable embeddings.'
    )
  }
  if (!text || !text.trim()) {
    // OpenAI rejects empty inputs; return a zero vector for parity
    // with how a missing note shows in cosine ranking (similarity 0).
    return []
  }

  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_EMBEDDING_MODEL,
      // The API can take an array of inputs and return parallel
      // embeddings, but we stick to single-input here. Batching is a
      // future optimisation if we hit rate limits during bulk index.
      input: text,
    }),
  })
  const json = await safeJson(res)
  if (!res.ok) {
    throw new AIClientError(
      `OpenAI embeddings error (${res.status}): ${extractApiErrorMessage(json, res.statusText)}`
    )
  }
  const data = (json as { data?: Array<{ embedding?: number[] }> })?.data
  const embedding = Array.isArray(data) ? data[0]?.embedding : undefined
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new AIClientError('OpenAI embeddings response had no vector.')
  }
  return embedding
}
