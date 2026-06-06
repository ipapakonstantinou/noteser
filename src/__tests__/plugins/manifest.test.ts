/**
 * @jest-environment node
 *
 * Manifest validator contract tests. Covers the golden-path shape +
 * the negative cases the host MUST refuse before spawning a worker.
 */

import { validateManifest } from '@/plugins/manifest'

const goodManifest = {
  id: 'word-count',
  name: 'Word count',
  version: '1.0.0',
  author: 'jane@example.com',
  surfaces: {
    commands: [{ id: 'show', title: 'Word count: show' }],
    sidebarPanels: [{ id: 'panel', title: 'Word count', icon: 'document-text' }],
  },
}

describe('validateManifest', () => {
  test('accepts a complete well-formed manifest', () => {
    const r = validateManifest(goodManifest)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.manifest?.id).toBe('word-count')
  })

  test('lowercases code-block renderer languages', () => {
    const r = validateManifest({
      id: 'mer',
      name: 'Mermaid',
      version: '1.0.0',
      surfaces: { codeBlockRenderers: [{ language: 'MerMAID' }] },
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.surfaces.codeBlockRenderers?.[0].language).toBe('mermaid')
  })

  test('rejects manifest with no surfaces', () => {
    const r = validateManifest({
      id: 'plug',
      name: 'P',
      version: '1.0.0',
      surfaces: {},
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/at least one surface/i)
  })

  test('rejects invalid id', () => {
    const bad = { ...goodManifest, id: 'BadID' }
    const r = validateManifest(bad)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.toLowerCase().includes('"id"'))).toBe(true)
  })

  test('rejects non-semver version', () => {
    const bad = { ...goodManifest, version: '1.0' }
    const r = validateManifest(bad)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.toLowerCase().includes('semver'))).toBe(true)
  })

  test('rejects an absurdly long name', () => {
    const bad = { ...goodManifest, name: 'x'.repeat(200) }
    const r = validateManifest(bad)
    expect(r.ok).toBe(false)
  })

  test('rejects a non-object input', () => {
    expect(validateManifest('not an object').ok).toBe(false)
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest(undefined).ok).toBe(false)
    expect(validateManifest(42).ok).toBe(false)
  })

  test('rejects when surfaces.commands is not an array', () => {
    const bad = { ...goodManifest, surfaces: { commands: { id: 'a', title: 'A' } } }
    const r = validateManifest(bad)
    expect(r.ok).toBe(false)
  })

  test('rejects when a command entry is missing fields', () => {
    const bad = {
      ...goodManifest,
      surfaces: { commands: [{ id: 'bad', title: '' }] },
    }
    const r = validateManifest(bad)
    expect(r.ok).toBe(false)
  })

  test('rejects when codeBlockRenderers entry has empty language', () => {
    const bad = {
      ...goodManifest,
      surfaces: { codeBlockRenderers: [{ language: '' }] },
    }
    const r = validateManifest(bad)
    expect(r.ok).toBe(false)
  })

  test('accepts minimal one-command manifest', () => {
    const r = validateManifest({
      id: 'ap',
      name: 'A',
      version: '0.0.1',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    expect(r.ok).toBe(true)
  })

  test('rejects single-char ids', () => {
    const r = validateManifest({
      id: 'a',
      name: 'A',
      version: '0.0.1',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    expect(r.ok).toBe(false)
  })

  test('accepts an optional description and surfaces it on the normalised manifest', () => {
    const r = validateManifest({
      ...goodManifest,
      description: 'Counts words in the active note.',
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.description).toBe('Counts words in the active note.')
  })

  test('rejects an oversize description', () => {
    const r = validateManifest({
      ...goodManifest,
      description: 'x'.repeat(500),
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.toLowerCase().includes('description'))).toBe(true)
  })

  test('accepts an https homepage URL', () => {
    const r = validateManifest({
      ...goodManifest,
      homepage: 'https://example.com/word-count',
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.homepage).toBe('https://example.com/word-count')
  })

  test('rejects a non-https homepage', () => {
    const r = validateManifest({
      ...goodManifest,
      homepage: 'javascript:alert(1)',
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.toLowerCase().includes('homepage'))).toBe(true)
  })

  test('accepts http://localhost as a homepage for dev', () => {
    const r = validateManifest({
      ...goodManifest,
      homepage: 'http://localhost:3001/plugin',
    })
    expect(r.ok).toBe(true)
  })

  // v1.2 PR B — fullscreenViews surface ----------------------------------
  describe('surfaces.fullscreenViews', () => {
    test('accepts a manifest that declares one fullscreen view', () => {
      const r = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: {
          fullscreenViews: [{ id: 'graph', title: 'Note graph' }],
        },
      })
      expect(r.ok).toBe(true)
      expect(r.manifest?.surfaces.fullscreenViews?.[0].id).toBe('graph')
      expect(r.manifest?.surfaces.fullscreenViews?.[0].title).toBe('Note graph')
    })

    test('treats a single fullscreen view as enough to satisfy the at-least-one-surface check', () => {
      const r = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: {
          fullscreenViews: [{ id: 'graph', title: 'Note graph' }],
        },
      })
      expect(r.ok).toBe(true)
    })

    test('rejects when fullscreenViews is not an array', () => {
      const r = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: { fullscreenViews: { id: 'graph', title: 'Note graph' } },
      })
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.toLowerCase().includes('fullscreenviews'))).toBe(true)
    })

    test('rejects fullscreen views with non-kebab-case ids', () => {
      const r = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: {
          fullscreenViews: [{ id: 'BadID', title: 'Note graph' }],
        },
      })
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.toLowerCase().includes('kebab-case'))).toBe(true)
    })

    test('rejects fullscreen views with empty or oversize titles', () => {
      const empty = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: { fullscreenViews: [{ id: 'graph', title: '' }] },
      })
      expect(empty.ok).toBe(false)

      const huge = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: {
          fullscreenViews: [{ id: 'graph', title: 'x'.repeat(200) }],
        },
      })
      expect(huge.ok).toBe(false)
    })

    test('rejects duplicate fullscreen view ids', () => {
      const r = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: {
          fullscreenViews: [
            { id: 'graph', title: 'Note graph' },
            { id: 'graph', title: 'Note graph 2' },
          ],
        },
      })
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.toLowerCase().includes('duplicat'))).toBe(true)
    })

    test('preserves the optional icon when present', () => {
      const r = validateManifest({
        id: 'graph',
        name: 'Graph',
        version: '1.0.0',
        surfaces: {
          fullscreenViews: [{ id: 'graph', title: 'Note graph', icon: 'document-text' }],
        },
      })
      expect(r.ok).toBe(true)
      expect(r.manifest?.surfaces.fullscreenViews?.[0].icon).toBe('document-text')
    })
  })
})
