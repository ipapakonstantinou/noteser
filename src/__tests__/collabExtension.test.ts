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

  test('JOINER: empty initialContent is never seeded, even after sync', () => {
    // A share-link joiner opens an EMPTY local note (content ''). It must
    // receive the room's content over the wire and NEVER push its own empty
    // body into the shared doc — otherwise two joiners could blank the room.
    const binding = createCollabBinding({
      url: 'wss://x',
      room: 'shared-room',
      initialContent: '',
      user: null,
      providerFactory: fakeFactory,
    })
    // Another client's content arrives, then we reach sync.
    binding.ytext.insert(0, 'real shared content')
    FakeProvider.last!.fireSync(true)
    expect(binding.ytext.toString()).toBe('real shared content')
    // Even a sync against a still-empty room leaves it empty (nothing to seed).
    const empty = createCollabBinding({
      url: 'wss://x', room: 'fresh', initialContent: '', user: null, providerFactory: fakeFactory,
    })
    FakeProvider.last!.fireSync(true)
    expect(empty.ytext.toString()).toBe('')
    binding.destroy()
    empty.destroy()
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

describe('SEED RACE: concurrent empty clients must not double the body', () => {
  // A hub that BUFFERS Yjs updates and cross-applies them only on flush(),
  // mimicking a y-websocket server that broadcasts updates to peers. Buffering
  // (rather than relaying immediately) is what makes the real race
  // reproducible: it lets every client seed while still empty BEFORE any
  // update crosses the wire. An immediate relay would hide the bug.
  function makeRelay() {
    const docs: Y.Doc[] = []
    const buffer: Array<{ from: Y.Doc; update: Uint8Array }> = []
    const register = (doc: Y.Doc) => {
      docs.push(doc)
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === 'relay') return // don't re-broadcast what we just applied
        buffer.push({ from: doc, update })
      })
    }
    // Deliver everything both ways, repeating until quiescent so the
    // collapser's trim (itself a new update) also propagates.
    const flush = () => {
      let guard = 0
      while (buffer.length && guard++ < 100) {
        const batch = buffer.splice(0, buffer.length)
        for (const { from, update } of batch) {
          for (const other of docs) {
            if (other !== from) Y.applyUpdate(other, update, 'relay')
          }
        }
      }
    }
    return { register, flush }
  }

  // Build N bindings on the same room, all seeded with the same body, all
  // starting empty. Returns the bindings + their providers + the relay.
  function setup(n: number, body: string) {
    const relay = makeRelay()
    const providers: FakeProvider[] = []
    const factory: ProviderFactory = (url, room, doc) => {
      relay.register(doc)
      const p = new FakeProvider(url, room, doc)
      providers.push(p)
      return p
    }
    const bindings = Array.from({ length: n }, (_, i) =>
      createCollabBinding({
        url: 'wss://x',
        room: 'note-1',
        initialContent: body,
        user: null,
        providerFactory: factory,
      }),
    )
    void bindings // referenced below by the caller
    return { relay, providers, bindings }
  }

  test('two empty clients both seeding leaves the body exactly once', () => {
    const body = '# 2026-06-19\n\n- [ ] morning routine\n'
    const { relay, providers, bindings } = setup(2, body)
    const [a, b] = bindings

    // Both reach sync while both are still empty → both seed (the race).
    providers[0].fireSync(true)
    providers[1].fireSync(true)
    // Each has its own single copy locally; nothing has crossed yet.
    expect(a.ytext.toString()).toBe(body)
    expect(b.ytext.toString()).toBe(body)

    // Server delivers the updates both ways; the election + collapse settle.
    relay.flush()

    // The regression guard: body appears ONCE, not body+body.
    expect(a.ytext.toString()).toBe(body)
    expect(b.ytext.toString()).toBe(body)
    bindings.forEach(x => x.destroy())
  })

  test('three empty clients collapse to a single body', () => {
    const body = 'shared body\nline 2\n'
    const { relay, providers, bindings } = setup(3, body)
    providers.forEach(p => p.fireSync(true))
    relay.flush()
    bindings.forEach(x => expect(x.ytext.toString()).toBe(body))
    bindings.forEach(x => x.destroy())
  })

  test('a genuine edit during the race window is never destroyed', () => {
    const body = 'one\n'
    const { relay, providers, bindings } = setup(2, body)
    const [a, b] = bindings
    providers[0].fireSync(true)
    providers[1].fireSync(true)
    // Before the updates cross, client B edits its copy. After merge the text
    // is no longer an exact k-fold repeat, so the collapser must leave it
    // alone — we never delete real edits. (Some duplication may remain; data
    // safety beats tidiness.)
    b.ytext.insert(b.ytext.length, 'EDIT')
    relay.flush()
    // The edit survived on both clients.
    expect(a.ytext.toString()).toContain('EDIT')
    expect(b.ytext.toString()).toContain('EDIT')
    bindings.forEach(x => x.destroy())
  })
})
