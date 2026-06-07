/**
 * @jest-environment node
 *
 * noteser-ai-chat plugin (issue #70).
 *
 * Covers the pure functions the V1 plugin exports as named exports
 * alongside its default plugin definition:
 *
 *   - `extractKeywords` — bag-of-words extraction + stopword filter.
 *   - `scoreNotes` — BM25-lite ranking against a small fixture vault.
 *   - `truncateBody` — context-snippet trimming with word-boundary cap.
 *   - `buildSystemPrompt` — RAG system message assembly.
 *   - `buildOpenAIRequest` + `buildAnthropicRequest` — API request shape
 *     including the right URL, headers (Authorization vs x-api-key +
 *     anthropic-version), and JSON body.
 *   - `parseSseDeltas` — SSE chunk parsing for both providers' shapes.
 *   - `maskKey` — display masking; assert it never reveals more than the
 *     last 4 chars.
 *   - `conversationToMarkdown` — "Save chat as note" content shape.
 *
 * We DO NOT make real network calls. The provider request builders are
 * pure (URL + init), and the streaming tests feed a hand-crafted SSE
 * string through `parseSseDeltas` to assert decoding without touching
 * `fetch`.
 *
 * The plugin's main.js is loaded via dynamic `import` against the file
 * URL so the test is independent of any module resolution config the
 * Next.js Jest preset adds — the file is plain ESM with no relative
 * imports, so this works in node + jsdom alike.
 */

// Import the plugin's main.js via a relative path. Next.js's Jest preset
// (next/jest) runs SWC over the file, so ESM `export default` + named
// exports become CJS-compatible — same way Next handles JS in
// `public/` and `src/` alike. The typed surface is the AiChatModule
// interface below; the runtime require returns plain JS.

import * as aiChatModule from '../../../public/plugins/noteser-ai-chat/main.js'

interface AiChatModule {
  default: {
    id: string
    name: string
    permissions: string[]
    surfaces: {
      commands?: ReadonlyArray<{ id: string; title: string }>
      fullscreenViews?: ReadonlyArray<{ id: string; title: string }>
    }
  }
  extractKeywords: (text: string) => string[]
  scoreNotes: (
    keywords: string[],
    notes: ReadonlyArray<{ title?: string; body?: string }>,
  ) => Array<{ note: { title?: string; body?: string }; score: number }>
  truncateBody: (body: string, cap?: number) => string
  buildSystemPrompt: (
    topNotes: ReadonlyArray<{ note: { title?: string; body?: string } }>,
  ) => string | null
  buildOpenAIMessages: (
    conversation: ReadonlyArray<{ role: string; content: string }>,
    systemPrompt: string | null,
  ) => Array<{ role: string; content: string }>
  buildOpenAIRequest: (args: {
    apiKey: string
    model: string
    conversation: ReadonlyArray<{ role: string; content: string }>
    systemPrompt: string | null
  }) => { url: string; init: RequestInit }
  buildAnthropicRequest: (args: {
    apiKey: string
    model: string
    conversation: ReadonlyArray<{ role: string; content: string }>
    systemPrompt: string | null
  }) => { url: string; init: RequestInit }
  parseSseDeltas: (
    raw: string,
    provider: 'openai' | 'anthropic',
  ) => Array<{ kind: 'delta'; text: string } | { kind: 'done' }>
  maskKey: (key: string) => string
  conversationToMarkdown: (
    conversation: ReadonlyArray<{ role: string; content: string }>,
  ) => string
  __STOPWORDS_FOR_TESTS: Set<string>
}

const mod = aiChatModule as unknown as AiChatModule

describe('noteser-ai-chat manifest', () => {
  test('declares the v1.2 surfaces issue #70 needs', () => {
    expect(mod.default.id).toBe('noteser-ai-chat')
    expect(mod.default.permissions).toEqual(
      expect.arrayContaining(['vault.read.all', 'vault.write', 'file-save']),
    )
    expect(mod.default.surfaces.commands).toEqual(
      expect.arrayContaining([{ id: 'open-chat', title: expect.any(String) }]),
    )
    expect(mod.default.surfaces.fullscreenViews).toEqual(
      expect.arrayContaining([
        { id: 'chat', title: expect.stringMatching(/chat/i) },
      ]),
    )
  })
})

describe('extractKeywords', () => {
  test('lowercases, drops stopwords, dedupes', () => {
    expect(mod.extractKeywords('The quick brown fox')).toEqual([
      'quick',
      'brown',
      'fox',
    ])
  })

  test('drops punctuation but keeps unicode letters', () => {
    // Apostrophe splits "Réunion's" into two tokens; the bare 's' is one
    // char and gets dropped by the length>=2 filter.
    expect(mod.extractKeywords("Réunion's agenda, please!")).toEqual([
      'réunion',
      'agenda',
      'please',
    ])
  })

  test('returns [] for empty or non-string input', () => {
    expect(mod.extractKeywords('')).toEqual([])
    expect(mod.extractKeywords(null as unknown as string)).toEqual([])
    expect(mod.extractKeywords(undefined as unknown as string)).toEqual([])
  })

  test('dedupes case-insensitively', () => {
    expect(mod.extractKeywords('Foo foo FOO Bar')).toEqual(['foo', 'bar'])
  })

  test('stopwords list matches the documented size', () => {
    // ~50 stopwords; pin a sane floor + ceiling so a typo expanding the
    // list 10x does not silently strip query signal.
    expect(mod.__STOPWORDS_FOR_TESTS.size).toBeGreaterThanOrEqual(40)
    expect(mod.__STOPWORDS_FOR_TESTS.size).toBeLessThanOrEqual(80)
    // Spot-check a handful that must be there.
    for (const w of ['the', 'and', 'is', 'of', 'a', 'to']) {
      expect(mod.__STOPWORDS_FOR_TESTS.has(w)).toBe(true)
    }
  })

  test('filters out tokens shorter than 2 chars', () => {
    expect(mod.extractKeywords('a b c hello')).toEqual(['hello'])
  })
})

describe('scoreNotes (BM25-lite)', () => {
  const fixture = [
    { id: 'n1', title: 'Postgres tuning', body: 'WAL settings and vacuum strategy for postgres.' },
    { id: 'n2', title: 'Sourdough starter', body: 'Feeding schedule, hydration, ambient temperature.' },
    { id: 'n3', title: 'Postgres indexes', body: 'BRIN vs BTREE; postgres index choice depends on cardinality.' },
    { id: 'n4', title: 'Travel notes', body: 'Pack light, lock the door.' },
  ]

  test('ranks vault-relevant notes above noise', () => {
    const kw = mod.extractKeywords('postgres vacuum strategy')
    const scored = mod.scoreNotes(kw, fixture)
    expect(scored.length).toBeGreaterThan(0)
    expect(scored[0].note.title).toMatch(/postgres/i)
    // Travel notes never appears.
    expect(scored.map((s) => s.note.title)).not.toContain('Travel notes')
  })

  test('title hits outscore lone body hits when terms tied on TF', () => {
    const notes = [
      { id: 'a', title: 'sourdough', body: 'baking' },
      { id: 'b', title: 'baking', body: 'sourdough' },
    ]
    const scored = mod.scoreNotes(['sourdough'], notes)
    // Title weight is 2x, so the note with sourdough in the TITLE wins.
    expect(scored[0].note.title).toBe('sourdough')
  })

  test('returns empty when keywords are empty', () => {
    expect(mod.scoreNotes([], fixture)).toEqual([])
  })

  test('returns empty when notes are empty', () => {
    expect(mod.scoreNotes(['anything'], [])).toEqual([])
  })

  test('drops notes with score 0', () => {
    const scored = mod.scoreNotes(['notinanynote'], fixture)
    expect(scored).toEqual([])
  })
})

describe('truncateBody', () => {
  test('returns full body when under the cap', () => {
    expect(mod.truncateBody('hello world')).toBe('hello world')
  })

  test('caps with ellipsis at a word boundary when possible', () => {
    const long = 'one two three four five six seven eight nine ten'.repeat(40)
    const result = mod.truncateBody(long, 50)
    expect(result.length).toBeLessThanOrEqual(51)
    expect(result.endsWith('…')).toBe(true)
  })

  test('handles non-string input', () => {
    expect(mod.truncateBody(undefined as unknown as string)).toBe('')
  })
})

describe('buildSystemPrompt', () => {
  test('returns null on empty top-notes list', () => {
    expect(mod.buildSystemPrompt([])).toBeNull()
  })

  test('includes every top note title and body verbatim', () => {
    const top = [
      { note: { title: 'Alpha', body: 'first body' }, score: 5 },
      { note: { title: 'Beta', body: 'second body' }, score: 3 },
    ]
    const prompt = mod.buildSystemPrompt(top)
    expect(prompt).not.toBeNull()
    expect(prompt).toContain('Title: Alpha')
    expect(prompt).toContain('first body')
    expect(prompt).toContain('Title: Beta')
    expect(prompt).toContain('second body')
    expect(prompt).toContain('square brackets')
  })
})

describe('buildOpenAIRequest', () => {
  test('emits the right URL + headers + JSON body shape', () => {
    const { url, init } = mod.buildOpenAIRequest({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      conversation: [{ role: 'user', content: 'hello' }],
      systemPrompt: 'be brief',
    })
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(true)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' })
  })

  test('omits the system message when no systemPrompt', () => {
    const { init } = mod.buildOpenAIRequest({
      apiKey: 'sk-x',
      model: 'gpt-4o',
      conversation: [{ role: 'user', content: 'hi' }],
      systemPrompt: null,
    })
    const body = JSON.parse(init.body as string)
    expect(body.messages[0].role).toBe('user')
  })
})

describe('buildAnthropicRequest', () => {
  test('emits the right URL + headers + JSON body shape', () => {
    const { url, init } = mod.buildAnthropicRequest({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      conversation: [{ role: 'user', content: 'hi there' }],
      systemPrompt: 'cite by title',
    })
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    // Anthropic uses x-api-key, NOT Authorization.
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['Authorization']).toBeUndefined()
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.stream).toBe(true)
    // System prompt lives on the top-level field, NOT in messages.
    expect(body.system).toBe('cite by title')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi there' }])
    // Anthropic requires max_tokens.
    expect(typeof body.max_tokens).toBe('number')
  })

  test('omits `system` when no systemPrompt', () => {
    const { init } = mod.buildAnthropicRequest({
      apiKey: 'sk-ant-y',
      model: 'claude-haiku-4-5',
      conversation: [{ role: 'user', content: 'hi' }],
      systemPrompt: null,
    })
    const body = JSON.parse(init.body as string)
    expect(body.system).toBeUndefined()
  })

  test('drops malformed conversation entries', () => {
    const { init } = mod.buildAnthropicRequest({
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      conversation: [
        { role: 'user', content: 'ok' },
        { role: 'system', content: 'leaked' } as { role: string; content: string }, // should be filtered
        { role: 'assistant', content: 'fine' },
      ],
      systemPrompt: null,
    })
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: 'fine' },
    ])
  })
})

describe('parseSseDeltas — OpenAI shape', () => {
  test('extracts content deltas from chat.completion.chunk events', () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      'data: [DONE]\n\n'
    const events = mod.parseSseDeltas(raw, 'openai')
    expect(events).toEqual([
      { kind: 'delta', text: 'Hello' },
      { kind: 'delta', text: ' world' },
      { kind: 'done' },
    ])
  })

  test('tolerates empty data lines and malformed JSON', () => {
    const raw =
      'data: \n\n' +
      'data: not-json\n\n' +
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n'
    const events = mod.parseSseDeltas(raw, 'openai')
    expect(events).toEqual([{ kind: 'delta', text: 'x' }])
  })
})

describe('parseSseDeltas — Anthropic shape', () => {
  test('extracts text from content_block_delta events', () => {
    const raw =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n'
    const events = mod.parseSseDeltas(raw, 'anthropic')
    expect(events).toEqual([
      { kind: 'delta', text: 'Hi' },
      { kind: 'delta', text: ' there' },
    ])
  })

  test('ignores non-delta events', () => {
    const raw =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{}}\n\n' +
      'event: ping\n' +
      'data: {"type":"ping"}\n\n'
    const events = mod.parseSseDeltas(raw, 'anthropic')
    expect(events).toEqual([])
  })
})

describe('maskKey', () => {
  test('shows only last 4 chars for a real-length key', () => {
    const key = 'sk-abcdefghijklmnop1234'
    const masked = mod.maskKey(key)
    expect(masked).toContain('1234')
    expect(masked).not.toContain('abcdef')
    expect(masked.startsWith('••')).toBe(true)
  })

  test('handles short keys without revealing them', () => {
    expect(mod.maskKey('xy')).not.toContain('xy')
    expect(mod.maskKey('xy')).toBe('••••')
  })

  test('handles empty', () => {
    expect(mod.maskKey('')).toBe('')
  })
})

describe('conversationToMarkdown', () => {
  test('emits ## You / ## Assistant sections', () => {
    const md = mod.conversationToMarkdown([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello, how can I help?' },
    ])
    expect(md).toContain('## You')
    expect(md).toContain('Hi')
    expect(md).toContain('## Assistant')
    expect(md).toContain('Hello, how can I help?')
    // Trailing newline is markdown-friendly.
    expect(md.endsWith('\n')).toBe(true)
  })

  test('produces only a trailing newline for empty conversation', () => {
    expect(mod.conversationToMarkdown([])).toBe('\n')
  })
})
