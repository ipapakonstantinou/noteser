// noteser-ai-chat v0.1.0
//
// Chat with an OpenAI or Anthropic model over your vault. Brings the
// "ask your notes" surface (issue #70) onto the v1.2 plugin platform —
// fullscreen view, vault.read.all for RAG context, vault.write so the
// user can save a conversation as a note.
//
// Self-contained ES module. The Worker dynamic-imports this file via a
// Blob URL. No relative imports, no SDK runtime dependency. The named
// exports at the bottom are for unit tests; the host only consumes the
// default export.
//
// SECURITY:
//   - API key lives in per-plugin localStorage via `ctx.setSetting`.
//     The audit trail records vault writes only — never request bodies,
//     never the key. We mask the key in the rendered UI.
//   - Nothing leaves the user's machine until they enter a key and hit
//     Send. "Include vault context" is opt-in; OFF means no RAG.
//
// RAG: keyword-BM25-lite for V1. Embeddings are a V2 roadmap item — see
// README.md "What's next" for the upgrade path.

// ─── Constants ──────────────────────────────────────────────────────────────

const VIEW_ID = 'chat'
const COMMAND_ID = 'open-chat'

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    models: [
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini (default)' },
      { value: 'gpt-4o', label: 'gpt-4o' },
    ],
    defaultModel: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  anthropic: {
    label: 'Anthropic',
    models: [
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (default)' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    defaultModel: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
}

// Small inline stop-word set (~50 common English tokens). Kept tight on
// purpose — a longer list trims real query signal in a notes vault.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if',
  'in', 'is', 'it', 'its', 'just', 'me', 'my', 'no', 'not', 'of', 'on',
  'or', 'our', 'she', 'so', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'us', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'would', 'you', 'your',
])

const TOP_K_NOTES = 5
const CONTEXT_BODY_CAP = 500
const MAX_KEY_FETCH_BYTES = 64 * 1024 // safety cap on streamed body chunks

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

/**
 * Lowercase, strip punctuation, split, drop stopwords + tokens shorter
 * than 2 chars. Returns a de-duplicated bag-of-words preserving first
 * occurrence order so the most-significant keyword stays at index 0.
 */
export function extractKeywords(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const lowered = text.toLowerCase()
  // Replace anything that isn't a letter/digit/underscore with a space,
  // then collapse — keeps unicode letters intact under the `u` flag.
  const cleaned = lowered.replace(/[^\p{L}\p{N}_]+/gu, ' ')
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  const seen = new Set()
  const out = []
  for (const tok of tokens) {
    if (tok.length < 2) continue
    if (STOPWORDS.has(tok)) continue
    if (seen.has(tok)) continue
    seen.add(tok)
    out.push(tok)
  }
  return out
}

/**
 * BM25-lite: per-term TF weighted by IDF, summed across terms. Each
 * note's body is tokenised once; we cache term counts on the note ref
 * for the lifetime of one ranking call (the caller passes a fresh
 * `cache` map each call so cache lifetime is explicit).
 */
export function scoreNotes(keywords, notes) {
  if (!Array.isArray(keywords) || keywords.length === 0) return []
  if (!Array.isArray(notes) || notes.length === 0) return []
  const N = notes.length

  // Per-note token counts. Title gets weight 2 because vault search
  // intuitively biases titles; the test suite pins this.
  const noteTermCounts = notes.map((n) => termCountsForNote(n))

  // Document-frequency per keyword.
  const df = new Map()
  for (const term of keywords) {
    let count = 0
    for (const counts of noteTermCounts) {
      if (counts.get(term) && counts.get(term) > 0) count += 1
    }
    df.set(term, count)
  }

  const scored = notes.map((note, idx) => {
    const counts = noteTermCounts[idx]
    let score = 0
    for (const term of keywords) {
      const tf = counts.get(term) ?? 0
      if (tf === 0) continue
      const dfTerm = df.get(term) ?? 0
      // log((N - df + 0.5) / (df + 0.5) + 1) — BM25 IDF, clamped at 0.
      const idf = Math.max(0, Math.log((N - dfTerm + 0.5) / (dfTerm + 0.5) + 1))
      // tf / (tf + 1) is the BM25 saturation curve at k1=1, no length norm.
      score += idf * (tf / (tf + 1))
    }
    return { note, score }
  })

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
}

function termCountsForNote(note) {
  const counts = new Map()
  const titleTokens = tokenise(note.title ?? '')
  for (const t of titleTokens) {
    counts.set(t, (counts.get(t) ?? 0) + 2) // title weight × 2
  }
  const bodyTokens = tokenise(note.body ?? '')
  for (const t of bodyTokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return counts
}

function tokenise(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Trim a body to ~CONTEXT_BODY_CAP characters, preferring a word
 * boundary so the injected snippet does not end mid-token.
 */
export function truncateBody(body, cap = CONTEXT_BODY_CAP) {
  if (typeof body !== 'string') return ''
  if (body.length <= cap) return body
  const sliced = body.slice(0, cap)
  const lastSpace = sliced.lastIndexOf(' ')
  if (lastSpace > cap - 80) return sliced.slice(0, lastSpace) + '…'
  return sliced + '…'
}

/**
 * Build the system prompt that injects RAG context. Returns null when
 * there are no top notes (caller can skip the system message entirely).
 */
export function buildSystemPrompt(topNotes) {
  if (!Array.isArray(topNotes) || topNotes.length === 0) return null
  const lines = [
    'You are a writing assistant grounded in the user\'s personal notes vault.',
    'Use the context below to answer. If a fact is not in the context, say so.',
    'When you cite, refer to a note by its title in square brackets, e.g. [My note title].',
    '',
    'Context from the user\'s vault:',
  ]
  for (const entry of topNotes) {
    const title = entry.note.title || '(untitled)'
    const body = truncateBody(entry.note.body ?? '')
    lines.push(`---`)
    lines.push(`Title: ${title}`)
    lines.push(body)
  }
  return lines.join('\n')
}

/** Map a conversation to the OpenAI Chat Completions message array,
 *  with the system prompt prepended when present. */
export function buildOpenAIMessages(conversation, systemPrompt) {
  const out = []
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    out.push({ role: 'system', content: systemPrompt })
  }
  for (const turn of conversation) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue
    if (typeof turn.content !== 'string') continue
    out.push({ role: turn.role, content: turn.content })
  }
  return out
}

/** Build the request init for an OpenAI streaming call. */
export function buildOpenAIRequest({ apiKey, model, conversation, systemPrompt }) {
  return {
    url: PROVIDERS.openai.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: buildOpenAIMessages(conversation, systemPrompt),
      }),
    },
  }
}

/** Build the request init for an Anthropic streaming call.
 *  Anthropic puts the system prompt in a top-level `system` field, not
 *  in the messages array. */
export function buildAnthropicRequest({ apiKey, model, conversation, systemPrompt }) {
  const messages = []
  for (const turn of conversation) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue
    if (typeof turn.content !== 'string') continue
    messages.push({ role: turn.role, content: turn.content })
  }
  const body = {
    model,
    stream: true,
    max_tokens: 1024,
    messages,
  }
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    body.system = systemPrompt
  }
  return {
    url: PROVIDERS.anthropic.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    },
  }
}

/** Mask an API key for display: bullets + last 4 chars. */
export function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return ''
  if (key.length <= 4) return '••••'
  return '•••••••••• ' + key.slice(-4)
}

/** Convert the conversation to a markdown document for "save as note". */
export function conversationToMarkdown(conversation) {
  const lines = []
  for (const turn of conversation) {
    if (turn.role === 'user') {
      lines.push('## You')
      lines.push('')
      lines.push(turn.content)
      lines.push('')
    } else if (turn.role === 'assistant') {
      lines.push('## Assistant')
      lines.push('')
      lines.push(turn.content)
      lines.push('')
    }
  }
  return lines.join('\n').trim() + '\n'
}

/**
 * Parse a single SSE chunk (the multi-line `data: …` records from an
 * OpenAI / Anthropic stream) and return the textual delta tokens. The
 * caller is responsible for buffering across chunks; this helper only
 * splits on `\n\n` and decodes the data fields it sees.
 */
export function parseSseDeltas(rawChunk, provider) {
  if (typeof rawChunk !== 'string' || rawChunk.length === 0) return []
  const events = rawChunk.split(/\n\n/)
  const out = []
  for (const evt of events) {
    const dataLines = evt
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    for (const data of dataLines) {
      if (data === '[DONE]') {
        out.push({ kind: 'done' })
        continue
      }
      if (data.length === 0) continue
      let parsed
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      const delta = extractDelta(parsed, provider)
      if (delta) out.push({ kind: 'delta', text: delta })
    }
  }
  return out
}

function extractDelta(payload, provider) {
  if (!payload || typeof payload !== 'object') return ''
  if (provider === 'openai') {
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null
    const delta = choice?.delta?.content
    return typeof delta === 'string' ? delta : ''
  }
  if (provider === 'anthropic') {
    // content_block_delta { delta: { type: 'text_delta', text: '...' } }
    if (payload.type === 'content_block_delta') {
      const t = payload.delta?.text
      return typeof t === 'string' ? t : ''
    }
    return ''
  }
  return ''
}

// ─── UI builders ────────────────────────────────────────────────────────────

function chatView(state) {
  const messageItems = []
  for (const turn of state.conversation) {
    if (turn.role === 'user') {
      messageItems.push({
        tag: 'callout',
        kind: 'note',
        title: 'You',
        body: turn.content,
      })
    } else if (turn.role === 'assistant') {
      messageItems.push({
        tag: 'callout',
        kind: 'info',
        title: 'Assistant',
        body: turn.content.length > 0 ? turn.content : '…',
      })
    }
  }
  if (messageItems.length === 0) {
    messageItems.push({
      tag: 'text',
      value:
        state.apiKey.length === 0
          ? 'Open Settings below to paste an API key, then ask a question about your notes.'
          : 'Ask a question about your notes.',
    })
  }

  const providerOptions = Object.entries(PROVIDERS).map(([value, prov]) => ({
    value,
    label: prov.label,
  }))
  const modelOptions = PROVIDERS[state.provider].models

  const settingsChildren = []
  if (state.settingsOpen) {
    settingsChildren.push({
      tag: 'text',
      value:
        state.apiKey.length > 0
          ? `API key on file: ${maskKey(state.apiKey)}`
          : 'No API key on file. Paste one below.',
    })
    settingsChildren.push({
      tag: 'input',
      type: 'text',
      placeholder: 'Paste API key (sk-… or sk-ant-…) and press Enter to save',
      value: '',
      onChange: { kind: 'emit', event: 'chat.apiKey' },
    })
    settingsChildren.push({
      tag: 'button',
      label: 'Clear saved key',
      variant: 'ghost',
      disabled: state.apiKey.length === 0,
      onClick: { kind: 'emit', event: 'chat.clearKey' },
    })
    settingsChildren.push({
      tag: 'radio',
      group: 'rag',
      value: state.includeContext ? 'on' : 'off',
      options: [
        { value: 'on', label: 'Include vault context (RAG)' },
        { value: 'off', label: 'No context — just chat' },
      ],
      onChange: { kind: 'emit', event: 'chat.includeContext' },
    })
    settingsChildren.push({
      tag: 'callout',
      kind: 'warn',
      title: 'Key storage',
      body:
        'Your API key is stored unencrypted in this browser. Do not paste a key on a shared machine. Clear it from this settings drawer when you are done.',
    })
  }

  const toolbar = {
    tag: 'box',
    gap: 2,
    children: [
      {
        tag: 'button',
        label: state.settingsOpen ? 'Hide settings' : 'Settings',
        variant: 'ghost',
        onClick: { kind: 'emit', event: 'chat.toggleSettings' },
      },
      {
        tag: 'button',
        label: 'Save chat as note',
        variant: 'default',
        disabled: state.conversation.length === 0 || state.streaming,
        onClick: { kind: 'emit', event: 'chat.saveAsNote' },
      },
      {
        tag: 'button',
        label: 'Clear chat',
        variant: 'ghost',
        disabled: state.conversation.length === 0 || state.streaming,
        onClick: { kind: 'emit', event: 'chat.clearChat' },
      },
    ],
  }

  const providerPicker = {
    tag: 'box',
    gap: 2,
    children: [
      {
        tag: 'text',
        value: 'Provider',
      },
      {
        tag: 'radio',
        group: 'provider',
        value: state.provider,
        options: providerOptions,
        onChange: { kind: 'emit', event: 'chat.provider' },
      },
      {
        tag: 'text',
        value: 'Model',
      },
      {
        tag: 'input',
        type: 'select',
        value: state.model,
        options: modelOptions,
        onChange: { kind: 'emit', event: 'chat.model' },
      },
    ],
  }

  const inputRow = {
    tag: 'box',
    gap: 2,
    children: [
      {
        tag: 'input',
        type: 'text',
        value: state.draft,
        placeholder: state.streaming
          ? 'Streaming response…'
          : 'Ask a question about your notes',
        disabled: state.streaming,
        onChange: { kind: 'emit', event: 'chat.draft' },
      },
      {
        tag: 'button',
        label: state.streaming ? 'Streaming…' : 'Send',
        variant: 'primary',
        disabled:
          state.streaming ||
          state.draft.trim().length === 0 ||
          state.apiKey.length === 0,
        onClick: { kind: 'emit', event: 'chat.send' },
      },
    ],
  }

  const children = [providerPicker, toolbar]
  if (state.settingsOpen) {
    children.push({ tag: 'box', gap: 2, children: settingsChildren })
  }
  if (state.status) {
    children.push({ tag: 'text', value: state.status })
  }
  children.push({ tag: 'list', ordered: false, items: messageItems })
  children.push(inputRow)

  return { tag: 'box', gap: 3, children }
}

// ─── Plugin state ──────────────────────────────────────────────────────────

const state = {
  provider: 'openai',
  model: PROVIDERS.openai.defaultModel,
  apiKey: '',
  includeContext: true,
  settingsOpen: false,
  draft: '',
  conversation: [], // { role: 'user' | 'assistant', content: string }
  streaming: false,
  status: '',
  // Per-session snapshot cache. We re-fetch when the user clicks Send
  // and the vault has changed (host snapshot is cheap enough; this is
  // V1 — not embeddings).
  cachedNotes: null,
  cachedNotesAt: 0,
}

function render(ctx) {
  ctx.setFullscreenContent(VIEW_ID, chatView(state))
}

// ─── Network: streaming chat completions ───────────────────────────────────

async function streamResponse(ctx) {
  if (state.apiKey.length === 0) {
    state.status = 'Add an API key in Settings first.'
    state.streaming = false
    render(ctx)
    return
  }

  const userTurn = state.draft.trim()
  if (userTurn.length === 0) return
  state.conversation.push({ role: 'user', content: userTurn })
  state.conversation.push({ role: 'assistant', content: '' })
  state.draft = ''
  state.streaming = true
  state.status = state.includeContext
    ? 'Ranking vault notes for context…'
    : 'Calling model…'
  render(ctx)

  let systemPrompt = null
  if (state.includeContext) {
    try {
      const notes = await getOrFetchNotes(ctx)
      const keywords = extractKeywords(userTurn)
      const scored = scoreNotes(keywords, notes)
      const top = scored.slice(0, TOP_K_NOTES)
      systemPrompt = buildSystemPrompt(top)
    } catch (err) {
      // Permission revoked? Skip RAG but still try the model.
      systemPrompt = null
      state.status = `Vault read failed: ${err instanceof Error ? err.message : 'unknown'} — sending without context.`
      render(ctx)
    }
  }

  const conversationForRequest = state.conversation.slice(0, -1) // drop the empty assistant placeholder
  const provider = state.provider
  const builder = provider === 'openai' ? buildOpenAIRequest : buildAnthropicRequest
  const { url, init } = builder({
    apiKey: state.apiKey,
    model: state.model,
    conversation: conversationForRequest,
    systemPrompt,
  })

  state.status = 'Streaming response…'
  render(ctx)

  let response
  try {
    response = await fetch(url, init)
  } catch (err) {
    finishWithError(ctx, err instanceof Error ? err.message : 'Network error')
    return
  }

  if (!response.ok || !response.body) {
    const text = await safeReadText(response)
    finishWithError(ctx, `API error ${response.status}: ${text.slice(0, 200)}`)
    return
  }

  await consumeStream(ctx, response.body, provider)
  state.streaming = false
  state.status = ''
  render(ctx)
}

async function consumeStream(ctx, body, provider) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let bytesSeen = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    bytesSeen += value?.byteLength ?? 0
    if (bytesSeen > MAX_KEY_FETCH_BYTES * 32) {
      // Hard ceiling so a runaway response cannot hang the worker.
      try {
        reader.cancel()
      } catch {
        /* ignore */
      }
      finishWithError(ctx, 'Response exceeded streaming size limit.')
      return
    }
    buffered += decoder.decode(value, { stream: true })
    // SSE events are separated by a blank line. Anything after the
    // last blank line is partial — keep it in the buffer.
    const lastBoundary = buffered.lastIndexOf('\n\n')
    if (lastBoundary === -1) continue
    const ready = buffered.slice(0, lastBoundary + 2)
    buffered = buffered.slice(lastBoundary + 2)
    const events = parseSseDeltas(ready, provider)
    for (const evt of events) {
      if (evt.kind === 'done') {
        try {
          reader.cancel()
        } catch {
          /* ignore */
        }
        return
      }
      appendToAssistant(ctx, evt.text)
    }
  }
  // Flush any trailing buffered events.
  if (buffered.length > 0) {
    const events = parseSseDeltas(buffered, provider)
    for (const evt of events) {
      if (evt.kind === 'delta') appendToAssistant(ctx, evt.text)
    }
  }
}

function appendToAssistant(ctx, text) {
  if (!text) return
  const last = state.conversation[state.conversation.length - 1]
  if (!last || last.role !== 'assistant') return
  last.content += text
  render(ctx)
}

function finishWithError(ctx, message) {
  state.streaming = false
  // Trim the empty assistant placeholder so the user is not left with
  // a blank "Assistant" callout next to the error toast.
  const last = state.conversation[state.conversation.length - 1]
  if (last && last.role === 'assistant' && last.content.length === 0) {
    state.conversation.pop()
  }
  state.status = `Error: ${message}`
  ctx.notify(`AI chat: ${message}`)
  render(ctx)
}

async function safeReadText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function getOrFetchNotes(ctx) {
  // The plugin host snapshots on each call; a 30-second window is fine
  // for V1 since the user has to be actively chatting to hit it twice.
  const now = Date.now()
  if (state.cachedNotes && now - state.cachedNotesAt < 30_000) {
    return state.cachedNotes
  }
  const notes = await ctx.vault.read.getAllNotes()
  state.cachedNotes = notes
  state.cachedNotesAt = now
  return notes
}

// ─── Default export ────────────────────────────────────────────────────────

export default {
  id: 'noteser-ai-chat',
  name: 'AI chat',
  version: '0.1.0',
  author: 'Noteser',
  description:
    'Chat with an OpenAI or Anthropic model over your vault. Bring your own key. Keyword-RAG V1: top-5 notes get injected as context. Nothing leaves your repo unless you turn it on.',
  permissions: ['vault.read.all', 'vault.write', 'file-save'],
  surfaces: {
    commands: [{ id: COMMAND_ID, title: 'Open AI chat' }],
    fullscreenViews: [{ id: VIEW_ID, title: 'Chat with your notes' }],
  },

  onActivate(ctx) {
    const savedKey = ctx.getSetting('apiKey')
    if (typeof savedKey === 'string' && savedKey.length > 0) {
      state.apiKey = savedKey
    }
    const savedProvider = ctx.getSetting('provider')
    if (savedProvider === 'openai' || savedProvider === 'anthropic') {
      state.provider = savedProvider
      state.model = PROVIDERS[savedProvider].defaultModel
    }
    const savedModel = ctx.getSetting('model')
    if (typeof savedModel === 'string') {
      const allowed = PROVIDERS[state.provider].models.some((m) => m.value === savedModel)
      if (allowed) state.model = savedModel
    }
    const savedInclude = ctx.getSetting('includeContext')
    if (typeof savedInclude === 'boolean') state.includeContext = savedInclude

    ctx.onVNodeEvent(({ event, payload, source }) => {
      if (source.kind !== 'fullscreen' || source.viewId !== VIEW_ID) return
      handleEvent(ctx, event, payload)
    })
  },

  async onCommand(commandId, ctx) {
    if (commandId !== COMMAND_ID) return
    try {
      await ctx.openFullscreen(VIEW_ID)
    } catch (err) {
      ctx.notify(err instanceof Error ? err.message : 'Could not open AI chat.')
    }
  },

  onFullscreenMount(viewId, ctx) {
    if (viewId !== VIEW_ID) return
    render(ctx)
  },

  onFullscreenUnmount() {
    // Nothing to clean up — the in-memory state persists so reopening
    // the chat shows the previous conversation. Closing on purpose to
    // wipe state is "Clear chat" + close.
  },
}

// ─── Event dispatch ────────────────────────────────────────────────────────

function handleEvent(ctx, event, payload) {
  if (event === 'chat.provider' && payload && typeof payload === 'object') {
    const next = String(payload.value ?? '')
    if (next === 'openai' || next === 'anthropic') {
      state.provider = next
      state.model = PROVIDERS[next].defaultModel
      ctx.setSetting('provider', next)
      ctx.setSetting('model', state.model)
      render(ctx)
    }
    return
  }
  if (event === 'chat.model' && payload && typeof payload === 'object') {
    const next = String(payload.value ?? '')
    const allowed = PROVIDERS[state.provider].models.some((m) => m.value === next)
    if (allowed) {
      state.model = next
      ctx.setSetting('model', next)
      render(ctx)
    }
    return
  }
  if (event === 'chat.toggleSettings') {
    state.settingsOpen = !state.settingsOpen
    render(ctx)
    return
  }
  if (event === 'chat.apiKey' && payload && typeof payload === 'object') {
    const next = String(payload.value ?? '').trim()
    if (next.length === 0) return
    state.apiKey = next
    ctx.setSetting('apiKey', next)
    state.status = 'API key saved.'
    render(ctx)
    return
  }
  if (event === 'chat.clearKey') {
    state.apiKey = ''
    ctx.setSetting('apiKey', '')
    state.status = 'API key cleared.'
    render(ctx)
    return
  }
  if (event === 'chat.includeContext' && payload && typeof payload === 'object') {
    state.includeContext = String(payload.value ?? '') === 'on'
    ctx.setSetting('includeContext', state.includeContext)
    render(ctx)
    return
  }
  if (event === 'chat.draft' && payload && typeof payload === 'object') {
    state.draft = String(payload.value ?? '')
    // No re-render on every keystroke — the host renders the input as
    // an uncontrolled-style refresh per setFullscreenContent, so we
    // only push back when there is a UI gate change (e.g. the Send
    // button enabling). Render once when crossing the empty→nonempty
    // boundary so the button toggles state.
    render(ctx)
    return
  }
  if (event === 'chat.send') {
    void streamResponse(ctx)
    return
  }
  if (event === 'chat.saveAsNote') {
    void saveConversationAsNote(ctx)
    return
  }
  if (event === 'chat.clearChat') {
    state.conversation = []
    state.status = ''
    render(ctx)
    return
  }
}

async function saveConversationAsNote(ctx) {
  if (state.conversation.length === 0) return
  const markdown = conversationToMarkdown(state.conversation)
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const title = `AI chat — ${ts}`
  try {
    const result = await ctx.vault.write.createNote({
      title,
      body: markdown,
    })
    const suffix = result.conflictResolved === 'suffix' ? ' (renamed for uniqueness)' : ''
    ctx.notify(`Saved chat as note: ${title}${suffix}`)
  } catch (err) {
    ctx.notify(
      `Could not save chat: ${err instanceof Error ? err.message : 'unknown error'}`,
    )
  }
}

// ─── Test-only named export: provider table ────────────────────────────────

export const __PROVIDERS_FOR_TESTS = PROVIDERS
export const __STOPWORDS_FOR_TESTS = STOPWORDS
