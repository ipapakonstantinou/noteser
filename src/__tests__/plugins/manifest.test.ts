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
})
