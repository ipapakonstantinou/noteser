/**
 * aiClient.test.ts
 *
 * Covers the `runPrompt` wrapper with `fetch` mocked: it should refuse to
 * call out when AI is off or the key is empty, and it should hit the
 * right URL + headers + body for each provider and parse the right field
 * out of the response.
 *
 * Lives in `src/__tests__/` to match repo convention (jest only sees the
 * tests under that directory).
 */

import { runPrompt, AIClientError, ANTHROPIC_MESSAGES_URL, OPENAI_CHAT_COMPLETIONS_URL } from '../utils/aiClient'
import { useSettingsStore } from '../stores/settingsStore'

// Helper: shape a `fetch` mock that returns a JSON body with a given
// status. We capture the request args so each test can assert against
// the URL / headers / body individually.
function mockFetchOnce(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response)
  ;(global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch
  return fn
}

// Reset the persisted settings store between tests so one test can't see
// another's provider/key config.
beforeEach(() => {
  useSettingsStore.setState({
    aiProvider: 'off',
    aiApiKey: '',
    aiModel: 'claude-haiku-4-5-20251001',
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('runPrompt — guards', () => {
  test('throws AIClientError when aiProvider is "off"', async () => {
    useSettingsStore.setState({ aiProvider: 'off', aiApiKey: 'whatever' })
    await expect(
      runPrompt({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AIClientError)
  })

  test('throws AIClientError when API key is empty even if provider is set', async () => {
    useSettingsStore.setState({ aiProvider: 'anthropic', aiApiKey: '' })
    await expect(
      runPrompt({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AIClientError)
  })
})

describe('runPrompt — Anthropic', () => {
  test('hits the Anthropic URL with the right headers and parses text out', async () => {
    useSettingsStore.setState({
      aiProvider: 'anthropic',
      aiApiKey: 'sk-ant-test',
      aiModel: 'claude-haiku-4-5-20251001',
    })
    const fetchMock = mockFetchOnce(200, {
      content: [{ type: 'text', text: 'hello back' }],
    })

    const result = await runPrompt({
      system: 'You are terse.',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result).toBe('hello back')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ANTHROPIC_MESSAGES_URL)
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    // Critical: without this header Anthropic CORS-blocks browser calls.
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('claude-haiku-4-5-20251001')
    expect(body.max_tokens).toBe(1024)
    expect(body.system).toBe('You are terse.')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  test('omits system from the body when not provided', async () => {
    useSettingsStore.setState({
      aiProvider: 'anthropic',
      aiApiKey: 'sk-ant-test',
      aiModel: 'claude-haiku-4-5-20251001',
    })
    const fetchMock = mockFetchOnce(200, {
      content: [{ type: 'text', text: 'ok' }],
    })

    await runPrompt({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).not.toHaveProperty('system')
  })
})

describe('runPrompt — OpenAI', () => {
  test('hits the OpenAI URL with the right headers and parses choices[0]', async () => {
    useSettingsStore.setState({
      aiProvider: 'openai',
      aiApiKey: 'sk-openai-test',
      aiModel: 'gpt-4o-mini',
    })
    const fetchMock = mockFetchOnce(200, {
      choices: [{ message: { role: 'assistant', content: 'hello back' } }],
    })

    const result = await runPrompt({
      system: 'You are terse.',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result).toBe('hello back')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPENAI_CHAT_COMPLETIONS_URL)
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-openai-test')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('gpt-4o-mini')
    // System message gets prepended as the first message in the list.
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'hi' },
    ])
  })

  test('omits system message when not provided', async () => {
    useSettingsStore.setState({
      aiProvider: 'openai',
      aiApiKey: 'sk-openai-test',
      aiModel: 'gpt-4o-mini',
    })
    const fetchMock = mockFetchOnce(200, {
      choices: [{ message: { content: 'ok' } }],
    })

    await runPrompt({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('runPrompt — error surfacing', () => {
  test('Anthropic 4xx surfaces the API error message in the thrown AIClientError', async () => {
    useSettingsStore.setState({
      aiProvider: 'anthropic',
      aiApiKey: 'sk-ant-test',
      aiModel: 'claude-haiku-4-5-20251001',
    })
    mockFetchOnce(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } })

    await expect(
      runPrompt({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      name: 'AIClientError',
      message: expect.stringContaining('invalid x-api-key'),
    })
  })

  test('OpenAI 4xx surfaces the API error message in the thrown AIClientError', async () => {
    useSettingsStore.setState({
      aiProvider: 'openai',
      aiApiKey: 'sk-openai-test',
      aiModel: 'gpt-4o-mini',
    })
    mockFetchOnce(429, { error: { type: 'rate_limit', message: 'too many requests' } })

    await expect(
      runPrompt({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      name: 'AIClientError',
      message: expect.stringContaining('too many requests'),
    })
  })
})
