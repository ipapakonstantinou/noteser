/**
 * @jest-environment jsdom
 *
 * Plugin audit trail unit tests. Exercises the localStorage-backed
 * ring buffer in isolation from the host glue.
 */

import {
  clearPluginAuditForTests,
  readPluginAudit,
  readPluginAuditFor,
  recordPluginWrite,
} from '@/utils/pluginAudit'

describe('pluginAudit', () => {
  beforeEach(() => clearPluginAuditForTests())

  test('records a create entry with the requested fields', () => {
    recordPluginWrite({
      pluginId: 'demo',
      op: 'create',
      target: 'note-1',
      ok: true,
      conflictResolved: 'none',
    })
    const entries = readPluginAudit()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      pluginId: 'demo',
      op: 'create',
      target: 'note-1',
      ok: true,
      conflictResolved: 'none',
    })
    expect(typeof entries[0].ts).toBe('number')
  })

  test('preserves insertion order (oldest first)', () => {
    for (let i = 0; i < 5; i++) {
      recordPluginWrite({
        pluginId: 'demo',
        op: 'update',
        target: `note-${i}`,
        ok: true,
      })
    }
    const entries = readPluginAudit()
    expect(entries.map((e) => e.target)).toEqual([
      'note-0',
      'note-1',
      'note-2',
      'note-3',
      'note-4',
    ])
  })

  test('rolls off the oldest entry past MAX_ENTRIES', () => {
    // MAX_ENTRIES is 500 (internal). Push 510 and verify we keep the
    // last 500 with the oldest 10 dropped.
    for (let i = 0; i < 510; i++) {
      recordPluginWrite({ pluginId: 'demo', op: 'create', target: `n-${i}`, ok: true })
    }
    const entries = readPluginAudit()
    expect(entries).toHaveLength(500)
    expect(entries[0].target).toBe('n-10')
    expect(entries[entries.length - 1].target).toBe('n-509')
  })

  test('readPluginAuditFor filters by plugin id', () => {
    recordPluginWrite({ pluginId: 'a', op: 'create', target: 'a-1', ok: true })
    recordPluginWrite({ pluginId: 'b', op: 'create', target: 'b-1', ok: true })
    recordPluginWrite({ pluginId: 'a', op: 'delete', target: 'a-1', ok: true })
    expect(readPluginAuditFor('a').map((e) => e.target)).toEqual(['a-1', 'a-1'])
    expect(readPluginAuditFor('b').map((e) => e.target)).toEqual(['b-1'])
  })

  test('error string lands on failed entries', () => {
    recordPluginWrite({
      pluginId: 'demo',
      op: 'delete',
      target: 'missing',
      ok: false,
      error: 'note "missing" does not exist',
    })
    const e = readPluginAudit()[0]
    expect(e.ok).toBe(false)
    expect(e.error).toMatch(/does not exist/)
  })

  test('flushes to localStorage so a fresh reader picks it up', async () => {
    recordPluginWrite({ pluginId: 'demo', op: 'create', target: 'note-1', ok: true })
    // Allow the 250 ms debounce timer to fire.
    await new Promise((r) => setTimeout(r, 300))
    const raw = localStorage.getItem('noteser-plugin-audit')
    expect(raw).not.toBeNull()
    expect(raw).toContain('note-1')
  })
})
