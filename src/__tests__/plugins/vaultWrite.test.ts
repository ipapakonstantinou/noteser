/**
 * @jest-environment jsdom
 *
 * Plugin v1.2 PR D — `vault.write` capability.
 *
 * Covers:
 *  - Manifest validator accepts `vault.write`, rejects unknown values,
 *    and `isDestructivePermission` flags it.
 *  - PluginHost.permissionDenialReason rejects worker:requestVaultWrite
 *    when the permission was not declared OR was revoked.
 *  - Round-trip per op: create, update, delete, createFolder.
 *  - Title-collision resolver suffixes once + chains on repeat.
 *  - Audit log captures one entry per accepted op AND per rejection
 *    that survived the permission gate (validation failure).
 */

import {
  validateManifest,
  isDestructivePermission,
  PERMISSIONS,
  DESTRUCTIVE_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
} from '@/plugins/manifest'
import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import type { HostToWorker, WorkerToHost } from '@/plugins/protocol'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { usePluginInstallStore } from '@/stores/pluginInstallStore'
import {
  readPluginAudit,
  clearPluginAuditForTests,
} from '@/utils/pluginAudit'

// We exercise the singleton's vault-write handler indirectly via
// PluginHost listener events. To do that we have to import the
// singleton wiring AFTER zeroing the stores; the singleton resolves
// `useNoteStore.getState()` lazily so each test gets a fresh vault.

function makeFakeWorker(manifest: {
  id: string
  name: string
  version: string
  surfaces: object
  permissions?: string[]
}): { worker: MinimalWorker; sent: HostToWorker[]; inject: (data: unknown) => void } {
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

function resetVaultStores(): void {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({
    folders: [],
    activeFolderId: null,
    expandedFolders: {},
    deletedFolderPaths: [],
  })
  usePluginInstallStore.setState({ records: {} })
}

describe('manifest: vault.write permission', () => {
  const base = {
    id: 'writer',
    name: 'Writer',
    version: '1.0.0',
    surfaces: { commands: [{ id: 'go', title: 'Go' }] },
  }

  test('PERMISSIONS includes vault.write', () => {
    expect(PERMISSIONS).toContain('vault.write')
  })

  test('PERMISSION_DESCRIPTIONS covers vault.write', () => {
    expect(typeof PERMISSION_DESCRIPTIONS['vault.write']).toBe('string')
    expect(PERMISSION_DESCRIPTIONS['vault.write'].length).toBeGreaterThan(0)
  })

  test('validateManifest accepts vault.write', () => {
    const r = validateManifest({ ...base, permissions: ['vault.write'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['vault.write'])
  })

  test('validateManifest rejects unknown values', () => {
    const r = validateManifest({ ...base, permissions: ['vault.write', 'rm -rf'] })
    expect(r.ok).toBe(false)
  })

  test('isDestructivePermission flags vault.write', () => {
    expect(isDestructivePermission('vault.write')).toBe(true)
    expect(isDestructivePermission('file-save')).toBe(false)
    expect(isDestructivePermission('file-open')).toBe(false)
    expect(DESTRUCTIVE_PERMISSIONS).toEqual(expect.arrayContaining(['vault.write']))
  })
})

describe('PluginHost.vault.write permission gate', () => {
  test('refuses worker:requestVaultWrite when permission not declared', async () => {
    const fake = makeFakeWorker({
      id: 'no-perm',
      name: 'No perm',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'no-perm', pluginSource: '' })

    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 1,
      op: { kind: 'create', title: 'X', body: '' },
    })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:vaultWriteResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') {
      expect(reply.ok).toBe(false)
      expect(reply.requestSeq).toBe(1)
      expect(reply.error).toMatch(/vault\.write/)
    }
  })

  test('refuses worker:requestVaultWrite when permission was revoked', async () => {
    const fake = makeFakeWorker({
      id: 'revoked',
      name: 'Revoked',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.write'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'revoked', pluginSource: '' })
    host.revokePermission('revoked', 'vault.write')

    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 2,
      op: { kind: 'create', title: 'X', body: '' },
    })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:vaultWriteResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') {
      expect(reply.ok).toBe(false)
      expect(reply.error).toMatch(/revoked/i)
    }
  })

  test('does NOT short-circuit when permission IS declared and not revoked', async () => {
    const fake = makeFakeWorker({
      id: 'allowed',
      name: 'Allowed',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.write'],
    })
    const events: string[] = []
    const host = new PluginHost({ createWorker: () => fake.worker })
    host.on((e) => events.push(e.type))
    await host.load({ pluginId: 'allowed', pluginSource: '' })

    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 3,
      op: { kind: 'create', title: 'X', body: '' },
    })
    await flush()

    expect(events).toContain('vaultWriteRequested')
    const earlyError = fake.sent.find(
      (m) => m.type === 'host:vaultWriteResult' && m.ok === false,
    )
    expect(earlyError).toBeUndefined()
  })

  test('respondVaultWrite includes id + conflictResolved on success', async () => {
    const fake = makeFakeWorker({
      id: 'allowed2',
      name: 'Allowed 2',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['vault.write'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'allowed2', pluginSource: '' })

    host.respondVaultWrite('allowed2', 42, {
      ok: true,
      id: 'note-1',
      conflictResolved: 'suffix',
    })

    const reply = fake.sent.find((m) => m.type === 'host:vaultWriteResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') {
      expect(reply.ok).toBe(true)
      expect(reply.id).toBe('note-1')
      expect(reply.conflictResolved).toBe('suffix')
      expect(reply.requestSeq).toBe(42)
    }
  })
})

// ─── End-to-end: singleton vault.write handler ─────────────────────────────
//
// These tests go through `handleVaultWriteRequest` (the host glue),
// which mutates useNoteStore + useFolderStore and records audit
// entries. The PluginHost's listener wires to the singleton lazily, so
// to keep these tests deterministic we drive the host directly and
// import the singleton wiring to trigger its handler.

describe('singleton: vault.write end-to-end', () => {
  beforeEach(() => {
    resetVaultStores()
    clearPluginAuditForTests()
  })

  async function bootedHost(pluginId: string, withPerm = true): Promise<{
    host: PluginHost
    fake: ReturnType<typeof makeFakeWorker>
  }> {
    const fake = makeFakeWorker({
      id: pluginId,
      name: pluginId,
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      ...(withPerm ? { permissions: ['vault.write'] } : {}),
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    // Import + wire the singleton's vault-write handler manually.
    // We can't share the app-wide singleton here because each test
    // wants a fresh host. Replicate the wiring: dispatch
    // 'vaultWriteRequested' through this host's listener.
    const { wireSingletonHandlersForTests } = await import('@/plugins/pluginHostSingleton')
    wireSingletonHandlersForTests(host)
    await host.load({ pluginId, pluginSource: '' })
    return { host, fake }
  }

  test('createNote: round-trips and writes through useNoteStore', async () => {
    const { fake } = await bootedHost('p1')
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 10,
      op: { kind: 'create', title: 'Hello', body: '# Hi', folderPath: 'Inbox' },
    })
    await flush()

    const reply = fake.sent.find(
      (m) => m.type === 'host:vaultWriteResult' && m.requestSeq === 10,
    )
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') {
      expect(reply.ok).toBe(true)
      expect(typeof reply.id).toBe('string')
      expect(reply.conflictResolved).toBe('none')
    }
    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('Hello')
    expect(notes[0].folderId).not.toBeNull()
    const folder = useFolderStore.getState().folders.find((f) => f.id === notes[0].folderId)
    expect(folder?.name).toBe('Inbox')

    const audit = readPluginAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0].op).toBe('create')
    expect(audit[0].ok).toBe(true)
    expect(audit[0].pluginId).toBe('p1')
  })

  test('createNote: title collision resolves with " (imported)" suffix', async () => {
    const { fake } = await bootedHost('p2')
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 11,
      op: { kind: 'create', title: 'Twin', body: 'a' },
    })
    await flush()
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 12,
      op: { kind: 'create', title: 'Twin', body: 'b' },
    })
    await flush()

    const replies = fake.sent.filter(
      (m): m is Extract<HostToWorker, { type: 'host:vaultWriteResult' }> =>
        m.type === 'host:vaultWriteResult',
    )
    expect(replies).toHaveLength(2)
    expect(replies[0].conflictResolved).toBe('none')
    expect(replies[1].conflictResolved).toBe('suffix')

    const titles = useNoteStore
      .getState()
      .notes.map((n) => n.title)
      .sort()
    expect(titles).toEqual(['Twin', 'Twin (imported)'])

    // Third invocation: should chain to "(imported 2)".
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 13,
      op: { kind: 'create', title: 'Twin', body: 'c' },
    })
    await flush()
    const titles2 = useNoteStore
      .getState()
      .notes.map((n) => n.title)
    expect(titles2).toEqual(
      expect.arrayContaining(['Twin', 'Twin (imported)', 'Twin (imported 2)']),
    )
    expect(titles2).toHaveLength(3)
  })

  test('updateNote: round-trips and patches title + body', async () => {
    const { fake } = await bootedHost('p3')
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 20,
      op: { kind: 'create', title: 'Old', body: 'body' },
    })
    await flush()
    const noteId = useNoteStore.getState().notes[0].id

    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 21,
      op: { kind: 'update', id: noteId, title: 'New', body: 'updated' },
    })
    await flush()

    const reply = fake.sent.find(
      (m) => m.type === 'host:vaultWriteResult' && m.requestSeq === 21,
    )
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') expect(reply.ok).toBe(true)

    const note = useNoteStore.getState().notes.find((n) => n.id === noteId)
    expect(note?.title).toBe('New')
    expect(note?.content).toContain('updated')

    const audit = readPluginAudit()
    expect(audit.some((e) => e.op === 'update' && e.target === noteId)).toBe(true)
  })

  test('deleteNote: round-trips and soft-deletes', async () => {
    const { fake } = await bootedHost('p4')
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 30,
      op: { kind: 'create', title: 'Doomed', body: 'x' },
    })
    await flush()
    const noteId = useNoteStore.getState().notes[0].id

    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 31,
      op: { kind: 'delete', id: noteId },
    })
    await flush()

    const reply = fake.sent.find(
      (m) => m.type === 'host:vaultWriteResult' && m.requestSeq === 31,
    )
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') expect(reply.ok).toBe(true)

    const note = useNoteStore.getState().notes.find((n) => n.id === noteId)
    expect(note?.isDeleted).toBe(true)
    expect(note?.deletedAt).not.toBeNull()

    const audit = readPluginAudit()
    expect(audit.some((e) => e.op === 'delete' && e.target === noteId && e.ok === true)).toBe(true)
  })

  test('createFolder: round-trips and creates folder tree', async () => {
    const { fake } = await bootedHost('p5')
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 40,
      op: { kind: 'createFolder', path: 'Imported/Obsidian' },
    })
    await flush()

    const reply = fake.sent.find(
      (m) => m.type === 'host:vaultWriteResult' && m.requestSeq === 40,
    )
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') expect(reply.ok).toBe(true)

    const folders = useFolderStore.getState().folders
    expect(folders.some((f) => f.name === 'Imported')).toBe(true)
    expect(folders.some((f) => f.name === 'Obsidian')).toBe(true)

    const audit = readPluginAudit()
    expect(audit.some((e) => e.op === 'createFolder' && e.target === 'Imported/Obsidian')).toBe(true)
  })

  test('createNote: validation failure surfaces ok=false + audit entry', async () => {
    const { fake } = await bootedHost('p6')
    fake.inject({
      type: 'worker:requestVaultWrite',
      seq: 50,
      op: { kind: 'create', title: '', body: '' },
    })
    await flush()

    const reply = fake.sent.find(
      (m) => m.type === 'host:vaultWriteResult' && m.requestSeq === 50,
    )
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:vaultWriteResult') {
      expect(reply.ok).toBe(false)
      expect(reply.error).toMatch(/title/i)
    }
    expect(useNoteStore.getState().notes).toHaveLength(0)

    const audit = readPluginAudit()
    expect(audit.some((e) => e.op === 'create' && e.ok === false)).toBe(true)
  })
})
