/**
 * @jest-environment jsdom
 *
 * Phase B live-collaboration binding tests. We exercise createCollabBinding
 * with a MOCKED provider + awareness — no real websocket server is opened.
 * The mock lets us fire the provider's 'sync' event synchronously so we can
 * assert the seed-on-empty logic and cleanup wiring.
 *
 * The real Y.Doc / Y.Text are used (they're DOM-free), so seeding into the
 * shared text is exercised for real; only the network layer is faked.
 */

import * as Y from 'yjs'
import {
  createCollabBinding,
  colorForUser,
  type ProviderLike,
  type ProviderFactory,
} from '../components/editor/collabExtension'
import type { GitHubUser } from '../types'

// Minimal fake provider. Captures the constructor args, records the local
// awareness state, and lets the test drive the 'sync' event by hand.
class FakeProvider implements ProviderLike {
  static last: FakeProvider | null = null
  url: string
  room: string
  doc: Y.Doc
  destroyed = false
  localState: Record<string, unknown> = {}
  private syncHandlers: Array<(s: boolean) => void> = []

  awareness = {
    setLocalStateField: (field: string, value: unknown) => {
      this.localState[field] = value
    },
  }

  constructor(url: string, room: string, doc: Y.Doc) {
    this.url = url
    this.room = room
    this.doc = doc
    FakeProvider.last = this
  }

  on(_event: 'sync', cb: (s: boolean) => void) {
    this.syncHandlers.push(cb)
  }
  off(_event: 'sync', cb: (s: boolean) => void) {
    this.syncHandlers = this.syncHandlers.filter(h => h !== cb)
  }
  destroy() {
    this.destroyed = true
  }
  // Test helper: simulate the provider reaching sync.
  fireSync(isSynced = true) {
    this.syncHandlers.forEach(h => h(isSynced))
  }
}

const fakeFactory: ProviderFactory = (url, room, doc) =>
  new FakeProvider(url, room, doc)

const USER: GitHubUser = { id: 1, login: 'octocat', name: 'Octo Cat', avatar_url: '' }

beforeEach(() => {
  FakeProvider.last = null
})

describe('colorForUser', () => {
  test('is deterministic for the same seed', () => {
    expect(colorForUser('octocat')).toBe(colorForUser('octocat'))
  })
  test('differs across seeds (usually) and is a valid hsl string', () => {
    expect(colorForUser('alice')).toMatch(/^hsl\(\d+, 70%, 55%\)$/)
    expect(colorForUser('alice')).not.toBe(colorForUser('bob'))
  })
})

describe('createCollabBinding', () => {
  test('wires the provider with url + room and produces a CM extension', () => {
    const binding = createCollabBinding({
      url: 'wss://collab.example.com',
      room: 'room-123',
      initialContent: 'hello',
      user: USER,
      providerFactory: fakeFactory,
    })

    const p = FakeProvider.last!
    expect(p.url).toBe('wss://collab.example.com')
    expect(p.room).toBe('room-123')
    // yCollab returns a non-null CodeMirror extension.
    expect(binding.extension).toBeTruthy()
    expect(binding.doc).toBeInstanceOf(Y.Doc)
    expect(binding.ytext.toString()).toBe('') // not seeded until sync
    binding.destroy()
  })

  test('sets the local awareness user (label + derived color)', () => {
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'r',
      initialContent: '',
      user: USER,
      providerFactory: fakeFactory,
    })
    const state = FakeProvider.last!.localState.user as { name: string; color: string }
    expect(state.name).toBe('octocat')
    expect(state.color).toBe(colorForUser('octocat'))
    binding.destroy()
  })

  test('falls back to "anonymous" when no GitHub user is present', () => {
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'r',
      initialContent: '',
      user: null,
      providerFactory: fakeFactory,
    })
    const state = FakeProvider.last!.localState.user as { name: string; color: string }
    expect(state.name).toBe('anonymous')
    expect(state.color).toMatch(/^hsl\(/)
    binding.destroy()
  })

  test('SEED-ON-EMPTY: seeds the Y.Text on first sync when the room is empty', () => {
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'r',
      initialContent: '# My note\nbody',
      user: USER,
      providerFactory: fakeFactory,
    })
    expect(binding.ytext.toString()).toBe('') // nothing yet
    FakeProvider.last!.fireSync(true)
    expect(binding.ytext.toString()).toBe('# My note\nbody')
    binding.destroy()
  })

  test('SEED-ON-EMPTY: does NOT seed when the room already has content', () => {
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'r',
      initialContent: 'local content',
      user: USER,
      providerFactory: fakeFactory,
    })
    // Simulate another client having already populated the shared doc
    // (arrives over the wire before our sync handler runs).
    binding.ytext.insert(0, 'remote content')
    FakeProvider.last!.fireSync(true)
    // Our local content must NOT be appended/prepended — the remote wins.
    expect(binding.ytext.toString()).toBe('remote content')
    binding.destroy()
  })

  test('SEED-ON-EMPTY: does nothing on a not-yet-synced event', () => {
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'r',
      initialContent: 'local',
      user: USER,
      providerFactory: fakeFactory,
    })
    FakeProvider.last!.fireSync(false) // isSynced=false
    expect(binding.ytext.toString()).toBe('')
    binding.destroy()
  })

  test('cleanup: destroy() tears down the provider and is idempotent', () => {
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'r',
      initialContent: '',
      user: USER,
      providerFactory: fakeFactory,
    })
    const p = FakeProvider.last!
    expect(p.destroyed).toBe(false)
    binding.destroy()
    expect(p.destroyed).toBe(true)
    // Second call must not throw.
    expect(() => binding.destroy()).not.toThrow()
  })
})
