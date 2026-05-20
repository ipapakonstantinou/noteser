/**
 * bugReport.test.ts
 *
 * Verifies the issue-body builder + the settings sanitizer. The actual
 * GitHub API call is not exercised here — that's an integration concern.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import {
  buildIssueBody,
  sanitizeSettings,
  DEFAULT_TARGET_REPO,
  type BugReportForm,
} from '../utils/bugReport'

const baseForm: BugReportForm = {
  title: 'It broke',
  description: 'Things went wrong when I clicked sync.',
  steps: '1. Open app\n2. Click sync\n3. Cry',
  includeDiagnostics: false,
  targetRepo: DEFAULT_TARGET_REPO,
}

describe('buildIssueBody', () => {
  test('includes the description and steps in named sections', () => {
    const body = buildIssueBody(baseForm)
    expect(body).toContain('## What happened')
    expect(body).toContain('Things went wrong when I clicked sync.')
    expect(body).toContain('## Steps to reproduce')
    expect(body).toContain('1. Open app')
  })

  test('omits the steps section when empty', () => {
    const body = buildIssueBody({ ...baseForm, steps: '   ' })
    expect(body).not.toContain('## Steps to reproduce')
  })

  test('includes the trailer comment so we can filter app-filed issues', () => {
    const body = buildIssueBody(baseForm)
    expect(body).toContain('<!-- Filed via in-app bug reporter -->')
  })

  test('adds the diagnostics section when includeDiagnostics=true', () => {
    const body = buildIssueBody({ ...baseForm, includeDiagnostics: true })
    expect(body).toContain('## Diagnostics')
    expect(body).toContain('Settings (sanitized)')
  })

  test('omits diagnostics when includeDiagnostics=false', () => {
    const body = buildIssueBody({ ...baseForm, includeDiagnostics: false })
    expect(body).not.toContain('## Diagnostics')
  })
})

describe('sanitizeSettings', () => {
  test('strips api keys and tokens', () => {
    const out = sanitizeSettings({
      aiApiKey: 'sk-1234',
      githubToken: 'ghp_secret',
      password: 'hunter2',
      randomSecret: 'cant see me',
      folderSortMode: 'alphabetical',
    })
    expect(out.aiApiKey).toBe('***')
    expect(out.githubToken).toBe('***')
    expect(out.password).toBe('***')
    expect(out.randomSecret).toBe('***')
    expect(out.folderSortMode).toBe('alphabetical')
  })

  test('keeps empty secret values empty (not "***")', () => {
    const out = sanitizeSettings({ aiApiKey: '' })
    expect(out.aiApiKey).toBe('')
  })

  test('skips functions', () => {
    const out = sanitizeSettings({
      foo: 'bar',
      doStuff: () => 'nope',
    })
    expect(out.foo).toBe('bar')
    expect('doStuff' in out).toBe(false)
  })

  test('handles plain objects but skips class instances', () => {
    class WithProto { x = 1 }
    const out = sanitizeSettings({
      plain: { a: 1 },
      classy: new WithProto(),
    })
    expect(out.plain).toEqual({ a: 1 })
    expect('classy' in out).toBe(false)
  })

  test('preserves arrays + primitives', () => {
    const out = sanitizeSettings({
      flag: true,
      n: 42,
      list: ['a', 'b'],
      nothing: null,
    })
    expect(out).toEqual({ flag: true, n: 42, list: ['a', 'b'], nothing: null })
  })
})
