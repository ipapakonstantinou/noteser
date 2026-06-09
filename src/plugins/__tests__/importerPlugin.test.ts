/**
 * @jest-environment jsdom
 *
 * noteser-importer plugin — parser, conflict, and Logseq lossy-conversion
 * coverage.
 *
 * The plugin lives at `public/plugins/noteser-importer/`; the bulk of
 * its surface is rendered VNode trees the host already exercises via
 * other tests. This file zeroes in on the format-specific transform
 * logic (parsers) and the run loop's interaction with the host's
 * conflict-suffix resolver and Logseq block-ref handling.
 *
 * Closes #73.
 */
import path from 'path'

// Resolve the plugin source by absolute path so Jest reads from
// `public/plugins/...` outside the usual `src/` tree. The dynamic
// `import()` runs through next/jest's SWC transform; the named
// exports below are exposed by both `main.js` and `parsers.js` solely
// for testing.
const PLUGIN_ROOT = path.resolve(__dirname, '../../../public/plugins/noteser-importer')

async function loadParsers(): Promise<{
  parseObsidianEntry: (rel: string, content: string) => null | {
    title: string
    body: string
    folderPath?: string
  }
  parseNotionEntry: (rel: string, content: string) => null | {
    title: string
    body: string
    folderPath?: string
  }
  parseLogseqEntry: (rel: string, content: string) => null | {
    title: string
    body: string
    folderPath?: string
    lossy?: number
  }
  convertNotionLinks: (body: string) => string
  convertLogseqBlockRefs: (body: string) => { body: string; lossy: number }
  stripNotionIds: (s: string) => string
  splitPath: (p: string) => { folderPath: string; baseName: string }
  stripMarkdownExtension: (n: string) => string
  hasMarkdownExtension: (n: string) => boolean
}> {
  return await import(path.join(PLUGIN_ROOT, 'parsers.js'))
}

async function loadMain(): Promise<{
  __TEST_STATE: {
    phase: 'pick' | 'progress' | 'done'
    format: 'obsidian' | 'notion' | 'logseq'
    progress: { current: number; total: number; label: string }
    summary: { imported: number; conflicts: number; lossy: number; errors: number }
  }
  __testResetState: () => void
  __testCurrentView: () => unknown
  __testRunImport: (
    ctx: unknown,
    records: ReadonlyArray<{ title: string; body: string; folderPath?: string; lossy?: number }>,
  ) => Promise<void>
}> {
  return await import(path.join(PLUGIN_ROOT, 'main.js'))
}

// ─── Parsers ──────────────────────────────────────────────────────────

describe('parsers — Obsidian', () => {
  it('keeps wikilinks and frontmatter intact', async () => {
    const p = await loadParsers()
    const body = '---\ntags: [foo]\n---\n\n# A note\n\n[[Other note]] and #tag.\n'
    const r = p.parseObsidianEntry('folder/A note.md', body)
    expect(r).not.toBeNull()
    expect(r!.title).toBe('A note')
    expect(r!.body).toBe(body)
    expect(r!.folderPath).toBe('folder')
  })

  it('drops the .markdown extension too', async () => {
    const p = await loadParsers()
    const r = p.parseObsidianEntry('Top.markdown', '# top')
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Top')
    expect(r!.folderPath).toBeUndefined()
  })

  it('returns null for an unnamed file', async () => {
    const p = await loadParsers()
    expect(p.parseObsidianEntry('.md', 'x')).toBeNull()
  })
})

describe('parsers — Notion', () => {
  it('strips Notion 32-hex ids from path and converts intra-vault links', async () => {
    const p = await loadParsers()
    const body = [
      '# My page',
      '',
      'See [Child page](Child%20page%20abcdef0123456789abcdef0123456789.md) for more.',
      '',
      'External [stays](https://example.com/page).',
    ].join('\n')
    const r = p.parseNotionEntry(
      'My page abcdef0123456789abcdef0123456789/Sub abcdef0123456789abcdef0123456789.md',
      body,
    )
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Sub')
    expect(r!.folderPath).toBe('My page')
    expect(r!.body).toContain('[[Child page]]')
    expect(r!.body).toContain('[stays](https://example.com/page)')
  })

  it('leaves anchor-only and csv links untouched', async () => {
    const p = await loadParsers()
    const body = 'See [intro](#intro) or the [db](Tasks%20abcdef0123456789abcdef0123456789.csv).'
    const out = p.convertNotionLinks(body)
    expect(out).toBe(body)
  })

  it('stripNotionIds is idempotent on a path with no id', async () => {
    const p = await loadParsers()
    expect(p.stripNotionIds('plain/title.md')).toBe('plain/title.md')
  })
})

describe('parsers — Logseq', () => {
  it('keeps wikilinks and converts block refs to a blockquote', async () => {
    const p = await loadParsers()
    const body = [
      '- Some text [[Linked]]',
      '- A block ref: ((11111111-2222-3333-4444-555555555555))',
      '- Another: ((aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee))',
    ].join('\n')
    const r = p.parseLogseqEntry('pages/Topic.md', body)
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Topic')
    expect(r!.folderPath).toBe('pages')
    expect(r!.body).toContain('[[Linked]]')
    expect(r!.body).toContain('> note from Logseq import: block ref 11111111-')
    expect(r!.body).toContain('> note from Logseq import: block ref aaaaaaaa-')
    expect(r!.lossy).toBe(2)
  })

  it('emits no `lossy` field when no block refs exist', async () => {
    const p = await loadParsers()
    const r = p.parseLogseqEntry('Plain.md', '# Plain')
    expect(r).not.toBeNull()
    expect(r!.lossy).toBeUndefined()
  })

  it('convertLogseqBlockRefs is direct + safe to call with no matches', async () => {
    const p = await loadParsers()
    expect(p.convertLogseqBlockRefs('hello')).toEqual({ body: 'hello', lossy: 0 })
  })
})

describe('parsers — splitPath helpers', () => {
  it('normalises backslashes and strips leading slashes', async () => {
    const p = await loadParsers()
    expect(p.splitPath('\\a\\b\\c.md')).toEqual({ folderPath: 'a/b', baseName: 'c.md' })
    expect(p.splitPath('/top.md')).toEqual({ folderPath: '', baseName: 'top.md' })
  })

  it('hasMarkdownExtension is case-insensitive', async () => {
    const p = await loadParsers()
    expect(p.hasMarkdownExtension('A.MD')).toBe(true)
    expect(p.hasMarkdownExtension('A.MarkDown')).toBe(true)
    expect(p.hasMarkdownExtension('A.txt')).toBe(false)
  })
})

// ─── runImport — relies on host's conflict-suffix resolver ─────────────

type CreateArgs = { title: string; body: string; folderPath?: string }
type CreateResult = { id: string; conflictResolved: 'none' | 'suffix' }

interface FakeCtx {
  vault: {
    write: {
      createNote: jest.Mock<Promise<CreateResult>, [CreateArgs]>
    }
  }
  setFullscreenContent: jest.Mock<void, [string, unknown]>
  notify: jest.Mock<void, [string]>
  closeFullscreen: jest.Mock<void, [string]>
}

function makeCtx(responses: Array<{ conflictResolved: 'none' | 'suffix' }>): FakeCtx {
  let i = 0
  const createNote = jest.fn<Promise<CreateResult>, [CreateArgs]>(async () => {
    const r = responses[i++] ?? { conflictResolved: 'none' }
    return { id: `id-${i}`, conflictResolved: r.conflictResolved }
  })
  return {
    vault: { write: { createNote } },
    setFullscreenContent: jest.fn<void, [string, unknown]>(),
    notify: jest.fn<void, [string]>(),
    closeFullscreen: jest.fn<void, [string]>(),
  }
}

describe('runImport — wires conflict + lossy tallies', () => {
  it('counts suffix responses as conflicts and lossy fields as lossy', async () => {
    const m = await loadMain()
    m.__testResetState()
    const ctx = makeCtx([
      { conflictResolved: 'none' },
      { conflictResolved: 'suffix' },
      { conflictResolved: 'suffix' },
    ])
    await m.__testRunImport(ctx, [
      { title: 'A', body: '# A' },
      { title: 'A', body: '# A again' },
      { title: 'B', body: '> note from Logseq import: block ref deadbeef-...', lossy: 1 },
    ])
    expect(m.__TEST_STATE.summary.imported).toBe(3)
    expect(m.__TEST_STATE.summary.conflicts).toBe(2)
    expect(m.__TEST_STATE.summary.lossy).toBe(1)
    expect(m.__TEST_STATE.summary.errors).toBe(0)
    expect(m.__TEST_STATE.phase).toBe('done')
    expect(ctx.vault.write.createNote).toHaveBeenCalledTimes(3)
    // First call passes the verbatim title; the host owns the rename.
    expect(ctx.vault.write.createNote.mock.calls[0][0]).toEqual({
      title: 'A',
      body: '# A',
    })
  })

  it('records errors but still advances the loop', async () => {
    const m = await loadMain()
    m.__testResetState()
    const ctx = makeCtx([{ conflictResolved: 'none' }, { conflictResolved: 'none' }])
    // Make the second createNote reject; the loop should still hit
    // record three and tally a single error.
    let n = 0
    ctx.vault.write.createNote.mockImplementation(async () => {
      n++
      if (n === 2) throw new Error('boom')
      return { id: `id-${n}`, conflictResolved: 'none' }
    })

    await m.__testRunImport(ctx, [
      { title: 'A', body: 'a' },
      { title: 'B', body: 'b' },
      { title: 'C', body: 'c' },
    ])

    expect(m.__TEST_STATE.summary.imported).toBe(2)
    expect(m.__TEST_STATE.summary.errors).toBe(1)
    expect(ctx.notify).toHaveBeenCalledWith(
      expect.stringContaining('Import failed for "B"'),
    )
  })

  it('forwards folderPath when present', async () => {
    const m = await loadMain()
    m.__testResetState()
    const ctx = makeCtx([{ conflictResolved: 'none' }])
    await m.__testRunImport(ctx, [
      { title: 'A', body: 'a', folderPath: 'sub/dir' },
    ])
    expect(ctx.vault.write.createNote.mock.calls[0][0]).toEqual({
      title: 'A',
      body: 'a',
      folderPath: 'sub/dir',
    })
  })
})
