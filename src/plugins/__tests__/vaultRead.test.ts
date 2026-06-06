/**
 * @jest-environment jsdom
 *
 * Plugin API v1.2 PR C — `vault.read.all` capability.
 *
 * Coverage:
 *   - Manifest validator accepts the new permission and rejects unknown
 *     variants.
 *   - Host snapshot returns the live note-store contents, parsed
 *     frontmatter included.
 *   - The chunked stream emits the right slice counts at chunkSize=1,
 *     100, and clamps to the 500-note ceiling on oversized requests.
 *   - PluginHost rejects `worker:requestVaultRead` when the permission
 *     was not declared or was revoked at runtime.
 *
 * The PluginHost tests inject a FakeWorker (real Web Workers are not
 * available in Jest) to assert the message routing without spinning
 * up the real worker entry. The snapshot tests drive the real
 * Zustand stores via their setState API.
 */

import { validateManifest, PERMISSIONS, PERMISSION_DESCRIPTIONS } from '@/plugins/manifest'
import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import type { HostToWorker, WorkerToHost } from '@/plugins/protocol'
import {
  snapshotAllNotes,
  snapshotNoteById,
  streamVaultSnapshot,
  resetVaultSnapshotCacheForTests,
  computeVaultSha,
  MAX_STREAM_CHUNK_SIZE,
} from '@/plugins/vaultSnapshot'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import type { Note } from '@/types'

function makeNote(over: Partial<Note> & { id: string; title: string }): Note {
  return {
    folderId: null,
    content: '',
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    ...over,
  } as Note
}

function seedStore(notes: Note[]): void {
  resetVaultSnapshotCacheForTests()
  useNoteStore.setState({ notes, selectedNoteId: null })
  useFolderStore.setState({ folders: [] })
}

afterEach(() => {
  resetVaultSnapshotCacheForTests()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [] })
})

describe('manifest accepts vault.read.all', () => {
  const base = {
    id: 'echo',
    name: 'Echo',
    version: '1.0.0',
    surfaces: { commands: [{ id: 'go', title: 'Go' }] },
  }

  test('vault.read.all is in the PERMISSIONS list and has a description', () => {
    expect((PERMISSIONS as readonly string[]).includes('vault.read.all')).toBe(true)
    expect(typeof PERMISSION_DESCRIPTIONS['vault.read.all']).toBe('string')
    expect(PERMISSION_DESCRIPTIONS['vault.read.all'].length).toBeGreaterThan(0)
  })

  test('validator accepts vault.read.all alongside v1.1 permissions', () => {
    const r = validateManifest({ ...base, permissions: ['file-open', 'vault.read.all'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['file-open', 'vault.read.all'])
  })

  test('validator still rejects unknown permissions', () => {
    // PRs C/D/E/F each added a v1.2 permission; pick a name that has
    // never shipped to verify the rejection arm still works.
    const r = validateManifest({ ...base, permissions: ['vault.read.all', 'network.fetch'] })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('network.fetch'))).toBe(true)
  })

  test('validator deduplicates a repeated vault.read.all', () => {
    const r = validateManifest({ ...base, permissions: ['vault.read.all', 'vault.read.all'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['vault.read.all'])
  })
})

describe('host snapshot', () => {
  test('snapshotAllNotes returns every non-deleted note with body + frontmatter', () => {
    seedStore([
      makeNote({
        id: 'a',
        title: 'A',
        content: '---\nstatus: draft\ntags: [x, y]\n---\nBody A',
        updatedAt: 100,
      }),
      makeNote({ id: 'b', title: 'B', content: 'Plain body', updatedAt: 200 }),
      makeNote({
        id: 'gone',
        title: 'Gone',
        content: 'deleted',
        isDeleted: true,
        deletedAt: 300,
      }),
    ])

    const snap = snapshotAllNotes()
    expect(snap).toHaveLength(2)
    const a = snap.find((n) => n.id === 'a')!
    expect(a.body).toBe('Body A')
    expect(a.frontmatter).toEqual({ status: 'draft', tags: ['x', 'y'] })
    const b = snap.find((n) => n.id === 'b')!
    expect(b.body).toBe('Plain body')
    expect(b.frontmatter).toBeNull()
  })

  test('snapshotAllNotes caches by SHA — second call is the same array', () => {
    seedStore([makeNote({ id: 'a', title: 'A', content: 'x', updatedAt: 1 })])
    const first = snapshotAllNotes()
    const second = snapshotAllNotes()
    expect(second).toBe(first)
  })

  test('snapshotAllNotes invalidates when a note updates', () => {
    seedStore([makeNote({ id: 'a', title: 'A', content: 'x', updatedAt: 1 })])
    const first = snapshotAllNotes()
    useNoteStore.setState({
      notes: [makeNote({ id: 'a', title: 'A', content: 'y', updatedAt: 2 })],
    })
    const second = snapshotAllNotes()
    expect(second).not.toBe(first)
    expect(second[0].body).toBe('y')
  })

  test('snapshotNoteById returns null for deleted / unknown notes', () => {
    seedStore([
      makeNote({ id: 'a', title: 'A', content: 'x', updatedAt: 1 }),
      makeNote({ id: 'b', title: 'B', content: 'y', isDeleted: true, deletedAt: 1 }),
    ])
    expect(snapshotNoteById('a')?.body).toBe('x')
    expect(snapshotNoteById('b')).toBeNull()
    expect(snapshotNoteById('missing')).toBeNull()
  })

  test('computeVaultSha changes when content updates', () => {
    seedStore([makeNote({ id: 'a', title: 'A', content: 'x', updatedAt: 1 })])
    const a = computeVaultSha()
    useNoteStore.setState({
      notes: [makeNote({ id: 'a', title: 'A', content: 'y', updatedAt: 2 })],
    })
    expect(computeVaultSha()).not.toBe(a)
  })
})

describe('chunked stream', () => {
  function seedN(n: number): void {
    const notes: Note[] = []
    for (let i = 0; i < n; i++) {
      notes.push(
        makeNote({ id: `n${i}`, title: `N${i}`, content: `body ${i}`, updatedAt: i + 1 }),
      )
    }
    seedStore(notes)
  }

  test('chunkSize=1 yields one chunk per note', async () => {
    seedN(5)
    const sizes: number[] = []
    await streamVaultSnapshot({
      chunkSize: 1,
      onChunk: (slice) => {
        sizes.push(slice.length)
      },
    })
    expect(sizes).toEqual([1, 1, 1, 1, 1])
  })

  test('chunkSize=100 yields one chunk for 50 notes', async () => {
    seedN(50)
    const sizes: number[] = []
    await streamVaultSnapshot({
      chunkSize: 100,
      onChunk: (slice) => {
        sizes.push(slice.length)
      },
    })
    expect(sizes).toEqual([50])
  })

  test('chunkSize=100 yields three chunks for 250 notes', async () => {
    seedN(250)
    const sizes: number[] = []
    await streamVaultSnapshot({
      chunkSize: 100,
      onChunk: (slice) => {
        sizes.push(slice.length)
      },
    })
    expect(sizes).toEqual([100, 100, 50])
  })

  test('chunkSize is clamped to MAX_STREAM_CHUNK_SIZE', async () => {
    seedN(MAX_STREAM_CHUNK_SIZE + 10)
    const sizes: number[] = []
    await streamVaultSnapshot({
      chunkSize: MAX_STREAM_CHUNK_SIZE * 4,
      onChunk: (slice) => {
        sizes.push(slice.length)
      },
    })
    // Two chunks — clamped to 500 each, last is the remainder.
    expect(sizes[0]).toBe(MAX_STREAM_CHUNK_SIZE)
    expect(sizes[1]).toBe(10)
  })

  test('isAborted terminates the stream with onAbort + no further chunks', async () => {
    seedN(20)
    const sizes: number[] = []
    let aborted: string | null = null
    let chunks = 0
    await streamVaultSnapshot({
      chunkSize: 5,
      isAborted: () => (chunks >= 2 ? 'Permission "vault.read.all" was revoked.' : null),
      onChunk: (slice) => {
        chunks++
        sizes.push(slice.length)
      },
      onAbort: (reason) => {
        aborted = reason
      },
    })
    expect(sizes).toEqual([5, 5])
    expect(aborted).toBe('Permission "vault.read.all" was revoked.')
  })

  test('end-of-stream onEnd fires after the last chunk', async () => {
    seedN(3)
    const order: string[] = []
    await streamVaultSnapshot({
      chunkSize: 2,
      onChunk: (slice) => {
        order.push(`chunk:${slice.length}`)
      },
      onEnd: () => {
        order.push('end')
      },
    })
    expect(order).toEqual(['chunk:2', 'chunk:1', 'end'])
  })
})

// ─── PluginHost wire-protocol gate ──────────────────────────────────────

interface FakeWorkerHandle {
  worker: MinimalWorker
  sent: HostToWorker[]
  inject: (data: unknown) => void
}

function makeFakeWorker(manifest: {
  id: string
  name: string
  version: string
  surfaces: object
  permissions?: string[]
}): FakeWorkerHandle {
  const sent: HostToWorker[] = []
  let handler: ((event: MessageEvent) => void) | null = null
  const worker: MinimalWorker = {
    onmessage: null,
    postMessage(message: unknown) {
      sent.push(message as HostToWorker)
      const msg = message as HostToWorker
      if (msg.type === 'host:boot') {
        queueMicrotask(() => {
          handler?.({
            data: { type: 'worker:ready', seq: msg.seq, manifest } as WorkerToHost,
          } as MessageEvent)
        })
      }
    },
    terminate() {
      handler = null
    },
  } as MinimalWorker
  Object.defineProperty(worker, 'onmessage', {
    configurable: true,
    get() {
      return handler
    },
    set(v) {
      handler = v
    },
  })
  return {
    worker,
    sent,
    inject(data: unknown) {
      handler?.({ data } as MessageEvent)
    },
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('PluginHost vault.read.all gate', () => {
  test('refuses worker:requestVaultRead when permission not declared', async () => {
    const fake = makeFakeWorker({
      id: 'no-perm',
      name: 'No perm',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'no-perm', pluginSource: '' })

    fake.inject({ type: 'worker:requestVaultRead', seq: 5, mode: 'all' })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:vaultReadResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultReadResult') {
      expect(reply.ok).toBe(false)
      expect(reply.requestSeq).toBe(5)
      expect(reply.error).toMatch(/vault\.read\.all/)
    }
  })

  test('refuses stream-mode request with a terminal chunk on no-permission', async () => {
    const fake = makeFakeWorker({
      id: 'no-perm2',
      name: 'No perm 2',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'no-perm2', pluginSource: '' })

    fake.inject({ type: 'worker:requestVaultRead', seq: 7, mode: 'stream' })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:vaultStreamChunk')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultStreamChunk') {
      expect(reply.requestSeq).toBe(7)
      expect(reply.notes).toEqual([])
      expect(reply.error).toMatch(/vault\.read\.all/)
    }
  })

  test('emits vaultReadRequested when permission IS declared', async () => {
    const fake = makeFakeWorker({
      id: 'ok',
      name: 'OK',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.read.all'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: string[] = []
    host.on((e) => events.push(e.type))
    await host.load({ pluginId: 'ok', pluginSource: '' })

    fake.inject({ type: 'worker:requestVaultRead', seq: 11, mode: 'all' })
    await flush()

    expect(events).toContain('vaultReadRequested')
    // No early rejection.
    const earlyError = fake.sent.find(
      (m) => m.type === 'host:vaultReadResult' && m.ok === false,
    )
    expect(earlyError).toBeUndefined()
  })

  test('revocation rejects the next call', async () => {
    const fake = makeFakeWorker({
      id: 'revokee',
      name: 'Revokee',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.read.all'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'revokee', pluginSource: '' })

    host.revokePermission('revokee', 'vault.read.all')
    fake.inject({ type: 'worker:requestVaultRead', seq: 13, mode: 'all' })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:vaultReadResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultReadResult') {
      expect(reply.ok).toBe(false)
      expect(reply.requestSeq).toBe(13)
      expect(reply.error).toMatch(/revoked/)
    }
  })

  test('restorePermission re-enables after a revoke', async () => {
    const fake = makeFakeWorker({
      id: 'flap',
      name: 'Flap',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.read.all'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: string[] = []
    host.on((e) => events.push(e.type))
    await host.load({ pluginId: 'flap', pluginSource: '' })

    host.revokePermission('flap', 'vault.read.all')
    expect(host.hasPermission('flap', 'vault.read.all')).toBe(false)
    host.restorePermission('flap', 'vault.read.all')
    expect(host.hasPermission('flap', 'vault.read.all')).toBe(true)

    fake.inject({ type: 'worker:requestVaultRead', seq: 17, mode: 'all' })
    await flush()
    expect(events).toContain('vaultReadRequested')
  })

  test('respondVaultRead routes the snapshot back to the worker', async () => {
    const fake = makeFakeWorker({
      id: 'h',
      name: 'H',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.read.all'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'h', pluginSource: '' })

    host.respondVaultRead('h', 99, {
      ok: true,
      notes: [
        { id: 'a', title: 'A', folderPath: '', body: 'x', frontmatter: null, updatedAt: 1 },
      ],
    })

    const reply = fake.sent.find((m) => m.type === 'host:vaultReadResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultReadResult') {
      expect(reply.ok).toBe(true)
      expect(reply.requestSeq).toBe(99)
      expect(reply.notes?.[0].id).toBe('a')
    }
  })

  test('respondVaultStreamChunk passes chunkIndex + notes through', async () => {
    const fake = makeFakeWorker({
      id: 's',
      name: 'S',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.read.all'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 's', pluginSource: '' })

    host.respondVaultStreamChunk('s', 21, {
      chunkIndex: 1,
      notes: [
        { id: 'a', title: 'A', folderPath: '', body: 'x', frontmatter: null, updatedAt: 1 },
      ],
    })
    host.respondVaultStreamChunk('s', 21, { chunkIndex: 2, notes: [] })

    const chunks = fake.sent.filter((m) => m.type === 'host:vaultStreamChunk') as Array<
      Extract<HostToWorker, { type: 'host:vaultStreamChunk' }>
    >
    expect(chunks).toHaveLength(2)
    expect(chunks[0].chunkIndex).toBe(1)
    expect(chunks[0].notes).toHaveLength(1)
    expect(chunks[1].chunkIndex).toBe(2)
    expect(chunks[1].notes).toHaveLength(0)
  })
})
