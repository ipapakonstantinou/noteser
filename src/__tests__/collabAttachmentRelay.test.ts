/**
 * @jest-environment jsdom
 *
 * Live-collaboration attachment relay: a screenshot pasted while a note is
 * being co-edited must reach other connected collaborators over the SAME
 * Y.Doc as the note text (a new `attachments` Y.Map), and the receiving side
 * must persist it into ITS OWN IndexedDB via putAttachmentAtPath — the same
 * call the GitHub-sync pull path uses — so the image survives after the
 * collab session ends and isn't re-fetched on the next open.
 *
 * Two in-memory Y.Doc instances + a manual Y.applyUpdate relay is the same
 * idiom collabExtension.test.ts's "SEED RACE" suite uses to exercise real
 * cross-client sync without a websocket server.
 */

const attachmentStore = new Map<string, Blob>()
const putAttachmentAtPathMock = jest.fn(async (path: string, blob: Blob, _name?: string) => {
  attachmentStore.set(path, blob)
})
const getAttachmentBlobMock = jest.fn(async (path: string) => attachmentStore.get(path) ?? null)

jest.mock('../utils/attachments', () => ({
  getAttachmentBlob: (path: string) => getAttachmentBlobMock(path),
  putAttachmentAtPath: (path: string, blob: Blob, name?: string) =>
    putAttachmentAtPathMock(path, blob, name),
}))

import * as Y from 'yjs'
import {
  createCollabBinding,
  MAX_COLLAB_ATTACHMENT_BYTES,
  type ProviderLike,
  type ProviderFactory,
  type CollabBinding,
} from '../components/editor/collabExtension'

// No 'sync' event is ever fired in this suite — attachment relay doesn't
// depend on the seed-on-empty handshake, only on doc-level updates, and
// initialContent is always '' so seed-on-empty is a no-op anyway.
class FakeProvider implements ProviderLike {
  awareness = { setLocalStateField: () => {} }
  on() { /* no-op: tests drive sync via the relay, not this event */ }
  off() { /* no-op */ }
  destroy() { /* no-op */ }
}

// Buffers Yjs updates and cross-applies them only on flush() — mirrors
// collabExtension.test.ts's makeRelay, standing in for the y-websocket relay
// the real collab-server provides (confirmed opaque to document shape).
function makeRelay() {
  const docs: Y.Doc[] = []
  const buffer: Array<{ from: Y.Doc; update: Uint8Array }> = []
  const register = (doc: Y.Doc) => {
    docs.push(doc)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'relay') return
      buffer.push({ from: doc, update })
    })
  }
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

function makeBinding(relay: ReturnType<typeof makeRelay>): CollabBinding {
  const factory: ProviderFactory = (_url, _room, doc) => {
    relay.register(doc)
    return new FakeProvider()
  }
  return createCollabBinding({
    url: 'wss://x',
    room: 'note-1',
    initialContent: '',
    user: null,
    providerFactory: factory,
  })
}

// A couple of microtask turns for the async shareAttachment/receiveAttachment
// chains (base64 encode, mocked IDB reads/writes) to settle.
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

beforeEach(() => {
  attachmentStore.clear()
  putAttachmentAtPathMock.mockClear()
  getAttachmentBlobMock.mockClear()
})

describe('collab attachment relay', () => {
  test("device A's shared attachment appears on device B's synced doc", async () => {
    const relay = makeRelay()
    const a = makeBinding(relay)
    const b = makeBinding(relay)

    const blob = new Blob(['fake png bytes'], { type: 'image/png' })
    await a.shareAttachment('attachments/foo.png', blob, 'foo.png')
    relay.flush()

    const entry = b.attachments.get('attachments/foo.png')
    expect(entry).toBeTruthy()
    expect(entry!.mime).toBe('image/png')
    expect(entry!.name).toBe('foo.png')
    expect(typeof entry!.data).toBe('string')

    a.destroy()
    b.destroy()
  })

  test('the receiving side calls putAttachmentAtPath with the right path + blob', async () => {
    const relay = makeRelay()
    const a = makeBinding(relay)
    const b = makeBinding(relay)
    void b // referenced only to keep it alive as the receiver in this room

    const source = new Blob(['fake png bytes'], { type: 'image/png' })
    await a.shareAttachment('attachments/foo.png', source, 'foo.png')
    relay.flush()
    await flushAsync()

    expect(putAttachmentAtPathMock).toHaveBeenCalledTimes(1)
    const [path, writtenBlob, name] = putAttachmentAtPathMock.mock.calls[0]
    expect(path).toBe('attachments/foo.png')
    expect(name).toBe('foo.png')
    expect(writtenBlob).toBeInstanceOf(Blob)
    expect((writtenBlob as Blob).size).toBe(source.size)
    expect((writtenBlob as Blob).type).toBe('image/png')

    a.destroy()
    b.destroy()
  })

  test('an attachment already present locally is not redundantly re-written', async () => {
    const relay = makeRelay()
    const a = makeBinding(relay)
    const b = makeBinding(relay)

    // As if a prior sync (GitHub pull, or an earlier collab session) already
    // landed this exact path in B's IndexedDB.
    attachmentStore.set('attachments/foo.png', new Blob(['already here']))

    const blob = new Blob(['fake png bytes'], { type: 'image/png' })
    await a.shareAttachment('attachments/foo.png', blob, 'foo.png')
    relay.flush()
    await flushAsync()

    expect(getAttachmentBlobMock).toHaveBeenCalledWith('attachments/foo.png')
    expect(putAttachmentAtPathMock).not.toHaveBeenCalled()

    a.destroy()
    b.destroy()
  })

  test('device A does not redundantly re-process its own write', async () => {
    const relay = makeRelay()
    const a = makeBinding(relay)

    const blob = new Blob(['fake png bytes'], { type: 'image/png' })
    await a.shareAttachment('attachments/foo.png', blob, 'foo.png')
    // Deliberately no relay.flush() — this is A's own LOCAL transaction
    // (transaction.local === true), which the receiving observer must skip
    // on every doc that saw it, including the author's own.
    await flushAsync()

    expect(putAttachmentAtPathMock).not.toHaveBeenCalled()
    expect(getAttachmentBlobMock).not.toHaveBeenCalled()

    a.destroy()
  })

  test('oversized attachments skip the live relay (still saved locally by the caller)', async () => {
    const relay = makeRelay()
    const a = makeBinding(relay)
    const b = makeBinding(relay)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const big = new Blob([new Uint8Array(MAX_COLLAB_ATTACHMENT_BYTES + 1)], { type: 'image/png' })
    await a.shareAttachment('attachments/huge.png', big, 'huge.png')
    relay.flush()
    await flushAsync()

    expect(a.attachments.has('attachments/huge.png')).toBe(false)
    expect(b.attachments.has('attachments/huge.png')).toBe(false)
    expect(putAttachmentAtPathMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
    a.destroy()
    b.destroy()
  })

  test('destroy() unobserves the attachments map — a late remote update never throws', async () => {
    const relay = makeRelay()
    const a = makeBinding(relay)
    const b = makeBinding(relay)
    b.destroy()

    await a.shareAttachment('attachments/late.png', new Blob(['x'], { type: 'image/png' }), 'late.png')
    expect(() => relay.flush()).not.toThrow()

    a.destroy()
  })
})
