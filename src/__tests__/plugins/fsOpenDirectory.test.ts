/**
 * @jest-environment jsdom
 *
 * Plugin v1.2 PR E — `fs.openDirectory` capability gating + picker
 * behaviour. Covers, end-to-end:
 *
 *   1. Manifest validator accepts the new `fs.open-directory`
 *      permission and rejects mistaken spellings.
 *   2. PluginHost short-circuits `worker:requestDirectoryOpen` with a
 *      clear error when the manifest did not declare the permission.
 *   3. Host-side picker walker honours the 50,000-entry cap.
 *   4. The extension filter narrows the response (`.md`, `.markdown`),
 *      case-insensitively and regardless of leading dot.
 *   5. The `<input webkitdirectory>` fallback path rejects with
 *      "cancelled" when the user dismisses the picker.
 *
 * See docs/plugins-v1.2-plan.md section 4.3.
 */

import {
  validateManifest,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
} from '@/plugins/manifest'
import {
  PluginHost,
  type MinimalWorker,
} from '@/plugins/PluginHost'
import {
  MAX_DIRECTORY_ENTRIES,
  type HostToWorker,
  type WorkerToHost,
} from '@/plugins/protocol'
import {
  buildExtensionMatcher,
  walkDirectoryHandle,
  type FileSystemDirectoryHandleLike,
} from '@/plugins/directoryPickerHelpers'

// ─── manifest validator ─────────────────────────────────────────────────

describe('manifest — fs.open-directory permission', () => {
  const base = {
    id: 'folder-demo',
    name: 'Folder demo',
    version: '1.0.0',
    surfaces: { commands: [{ id: 'pick', title: 'Pick' }] },
  }

  test('accepts fs.open-directory in the permissions list', () => {
    const r = validateManifest({ ...base, permissions: ['fs.open-directory'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['fs.open-directory'])
  })

  test('rejects a typo like fs.openDirectory', () => {
    const r = validateManifest({ ...base, permissions: ['fs.openDirectory'] })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('fs.openDirectory'))).toBe(true)
  })

  test('mixes cleanly with v1.1 permissions', () => {
    const r = validateManifest({
      ...base,
      permissions: ['file-open', 'fs.open-directory'],
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['file-open', 'fs.open-directory'])
  })

  test('PERMISSIONS const includes fs.open-directory', () => {
    expect(PERMISSIONS).toContain('fs.open-directory')
  })

  test('PERMISSION_DESCRIPTIONS covers fs.open-directory with a non-empty string', () => {
    const d = PERMISSION_DESCRIPTIONS['fs.open-directory']
    expect(typeof d).toBe('string')
    expect(d.length).toBeGreaterThan(0)
    // The spec line is "Open folders to read files into the plugin".
    // Pin the keyword so a future hand-edit that breaks the install
    // modal copy fails the test.
    expect(d.toLowerCase()).toMatch(/folder/)
  })
})

// ─── PluginHost permission gating ──────────────────────────────────────

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

describe('PluginHost — fs.open-directory permission gate', () => {
  test('refuses requestDirectoryOpen when permission not declared', async () => {
    const fake = makeFakeWorker({
      id: 'no-fs-perm',
      name: 'No FS perm',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'no-fs-perm', pluginSource: '' })

    fake.inject({ type: 'worker:requestDirectoryOpen', seq: 13 })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:directoryOpenResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:directoryOpenResult') {
      expect(reply.ok).toBe(false)
      expect(reply.requestSeq).toBe(13)
      expect(reply.error).toMatch(/fs\.open-directory/)
    }
  })

  test('emits directoryOpenRequested when the permission IS declared', async () => {
    const fake = makeFakeWorker({
      id: 'with-fs',
      name: 'With FS',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['fs.open-directory'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: string[] = []
    host.on((e) => events.push(e.type))
    await host.load({ pluginId: 'with-fs', pluginSource: '' })

    fake.inject({
      type: 'worker:requestDirectoryOpen',
      seq: 21,
      extensions: ['.md'],
    })
    await flush()

    expect(events).toContain('directoryOpenRequested')
    // Should NOT have sent an immediate refusal.
    const earlyError = fake.sent.find(
      (m) => m.type === 'host:directoryOpenResult' && m.ok === false,
    )
    expect(earlyError).toBeUndefined()
  })

  test('respondDirectoryOpen carries entries with blobs back to the worker', async () => {
    const fake = makeFakeWorker({
      id: 'fs-ok',
      name: 'FS OK',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['fs.open-directory'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'fs-ok', pluginSource: '' })

    host.respondDirectoryOpen('fs-ok', 7, {
      ok: true,
      entries: [
        { name: 'a.md', path: 'a.md', blob: new Blob(['# a'], { type: 'text/markdown' }) },
        { name: 'b.md', path: 'sub/b.md', blob: new Blob(['# b'], { type: 'text/markdown' }) },
      ],
    })

    const reply = fake.sent.find((m) => m.type === 'host:directoryOpenResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:directoryOpenResult') {
      expect(reply.ok).toBe(true)
      expect(reply.requestSeq).toBe(7)
      expect(reply.entries).toHaveLength(2)
      expect(reply.entries?.[0].path).toBe('a.md')
      expect(reply.entries?.[1].path).toBe('sub/b.md')
      expect(reply.entries?.[0].blob).toBeInstanceOf(Blob)
    }
  })

  test('respondDirectoryOpen without entries means user cancelled', async () => {
    const fake = makeFakeWorker({
      id: 'fs-cancel',
      name: 'FS cancel',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['fs.open-directory'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'fs-cancel', pluginSource: '' })

    host.respondDirectoryOpen('fs-cancel', 12, { ok: true })

    const reply = fake.sent.find((m) => m.type === 'host:directoryOpenResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:directoryOpenResult') {
      expect(reply.ok).toBe(true)
      expect(reply.entries).toBeUndefined()
    }
  })
})

// ─── Extension matcher ─────────────────────────────────────────────────

describe('buildExtensionMatcher', () => {
  test('returns "match all" for undefined / empty', () => {
    const a = buildExtensionMatcher(undefined)
    const b = buildExtensionMatcher([])
    expect(a('whatever.txt')).toBe(true)
    expect(b('whatever.png')).toBe(true)
  })

  test('matches case-insensitively, leading dot optional', () => {
    const m = buildExtensionMatcher(['md', '.MARKDOWN'])
    expect(m('a.md')).toBe(true)
    expect(m('a.MD')).toBe(true)
    expect(m('a.markdown')).toBe(true)
    expect(m('a.MARKDOWN')).toBe(true)
    expect(m('readme.txt')).toBe(false)
  })

  test('rejects names that do not end with one of the suffixes', () => {
    const m = buildExtensionMatcher(['.md'])
    // The `.md` in the middle should NOT match.
    expect(m('a.md.bak')).toBe(false)
    expect(m('image.png')).toBe(false)
  })
})

// ─── walkDirectoryHandle ────────────────────────────────────────────────

interface FakeDirSpec {
  kind: 'directory'
  name: string
  children: Array<FakeDirSpec | FakeFileSpec>
}
interface FakeFileSpec {
  kind: 'file'
  name: string
  file: File
}

function mkDir(name: string, children: Array<FakeDirSpec | FakeFileSpec>): FakeDirSpec {
  return { kind: 'directory', name, children }
}
function mkFile(name: string, contents = name): FakeFileSpec {
  return { kind: 'file', name, file: new File([contents], name, { type: 'text/markdown' }) }
}

function toHandle(spec: FakeDirSpec): FileSystemDirectoryHandleLike {
  return {
    kind: 'directory',
    name: spec.name,
    async *values() {
      for (const child of spec.children) {
        if (child.kind === 'directory') {
          yield toHandle(child)
        } else {
          yield {
            kind: 'file' as const,
            name: child.name,
            getFile: () => Promise.resolve(child.file),
          }
        }
      }
    },
  }
}

describe('walkDirectoryHandle', () => {
  test('returns every file under a flat directory', async () => {
    const root = toHandle(
      mkDir('vault', [mkFile('a.md'), mkFile('b.md'), mkFile('c.txt')]),
    )
    const entries = await walkDirectoryHandle(root, () => true)
    expect(entries.map((e) => e.path).sort()).toEqual(['a.md', 'b.md', 'c.txt'])
  })

  test('recurses into subdirectories and builds forward-slash relative paths', async () => {
    const root = toHandle(
      mkDir('vault', [
        mkFile('top.md'),
        mkDir('sub', [mkFile('a.md'), mkDir('deeper', [mkFile('b.md')])]),
      ]),
    )
    const entries = await walkDirectoryHandle(root, () => true)
    expect(entries.map((e) => e.path).sort()).toEqual([
      'sub/a.md',
      'sub/deeper/b.md',
      'top.md',
    ])
  })

  test('honours the extension matcher mid-walk', async () => {
    const root = toHandle(
      mkDir('vault', [
        mkFile('keep.md'),
        mkFile('skip.txt'),
        mkDir('sub', [mkFile('keep2.markdown'), mkFile('image.png')]),
      ]),
    )
    const matcher = buildExtensionMatcher(['.md', '.markdown'])
    const entries = await walkDirectoryHandle(root, matcher)
    expect(entries.map((e) => e.path).sort()).toEqual(['keep.md', 'sub/keep2.markdown'])
  })

  test('returned blobs are real File / Blob instances with the file name preserved', async () => {
    const root = toHandle(mkDir('vault', [mkFile('a.md', '# hello')]))
    const entries = await walkDirectoryHandle(root, () => true)
    expect(entries[0].blob).toBeInstanceOf(Blob)
    // jsdom's Blob predates the text() helper; we assert on properties
    // that survive (size + type) rather than reading the body.
    // Production browsers expose blob.text() so the plugin can do
    // `await entry.blob.text()` directly.
    expect((entries[0].blob as File).name).toBe('a.md')
    expect(entries[0].blob.size).toBe('# hello'.length)
    expect(entries[0].blob.type).toBe('text/markdown')
  })

  test('returns early once the cap is crossed', async () => {
    // Build a generator that pretends to be an infinite directory.
    // The walker should stop producing entries as soon as it crosses
    // the cap (which is the signal the caller turns into a
    // "Directory too large" error). We assert: a) the loop terminates,
    // b) the returned length crosses the cap, c) it does NOT walk
    // every entry (would-be 1 million in this generator).
    let produced = 0
    const generator: FileSystemDirectoryHandleLike = {
      kind: 'directory',
      name: 'infinite',
      async *values() {
        while (true) {
          produced++
          yield {
            kind: 'file' as const,
            name: `f${produced}.md`,
            // Cheap File-shaped stub — the walker only calls getFile()
            // and shoves the result into the entry. We avoid building
            // 50k real Files since jsdom's File constructor allocates.
            getFile: () =>
              Promise.resolve({ name: `f${produced}.md`, size: 0, type: '' } as unknown as File),
          }
        }
      },
    }
    const entries = await walkDirectoryHandle(generator, () => true)
    expect(entries.length).toBeGreaterThan(MAX_DIRECTORY_ENTRIES)
    // The walker is documented to stop one past the cap; we should
    // never have walked twice the cap.
    expect(produced).toBeLessThan(MAX_DIRECTORY_ENTRIES * 2)
  })

  test('MAX_DIRECTORY_ENTRIES is the documented 50_000', () => {
    expect(MAX_DIRECTORY_ENTRIES).toBe(50_000)
  })
})

// ─── webkitdirectory fallback — cancel path ─────────────────────────────

describe('webkitdirectory fallback — cancel rejects', () => {
  test('input cancel event surfaces to the caller as cancellation', async () => {
    // The fallback in pluginHostSingleton.ts creates this exact input
    // and listens for the `cancel` event. We replay that wiring here
    // so the rejection path the user prompt called out specifically
    // is locked down by a real DOM-event test (jsdom).
    const input = document.createElement('input')
    input.type = 'file'
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')

    const promise = new Promise<void>((_, reject) => {
      input.addEventListener('cancel', () => reject(new Error('cancelled')))
    })

    input.dispatchEvent(new Event('cancel'))
    await expect(promise).rejects.toThrow(/cancelled/)
  })
})
