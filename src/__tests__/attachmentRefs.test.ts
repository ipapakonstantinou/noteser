// idb-keyval is touched via attachments.ts → settings store import chain.
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import {
  extractAttachmentRefs,
  extractWikiImageTargets,
  collectReferencedAttachments,
  findOrphanAttachments,
} from '../utils/attachmentRefs'
import { useSettingsStore } from '../stores/settingsStore'
import { DEFAULT_ATTACHMENT_DIR } from '../utils/attachments'
import type { Note } from '../types'

beforeEach(() => {
  useSettingsStore.getState().setAttachmentsFolder(DEFAULT_ATTACHMENT_DIR)
})

function makeNote(content: string, overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: overrides.title ?? 'untitled',
    content,
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: overrides.isDeleted ?? false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    ...overrides,
  }
}

describe('extractAttachmentRefs', () => {
  test('picks up markdown image links pointing at attachments/', () => {
    const md = 'before ![alt](attachments/foo.png) middle ![](attachments/bar.jpg) end'
    expect(extractAttachmentRefs(md)).toEqual([
      'attachments/foo.png',
      'attachments/bar.jpg',
    ])
  })

  test('ignores non-attachment paths and external URLs', () => {
    const md = '![ext](https://example.com/x.png) ![local](other/y.png)'
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  test('picks up HTML <img src="attachments/...">', () => {
    const md = `<img src="attachments/foo.png" alt="x">`
    expect(extractAttachmentRefs(md)).toEqual(['attachments/foo.png'])
  })

  test('deduplicates repeated refs', () => {
    const md = '![a](attachments/foo.png) and again ![b](attachments/foo.png)'
    expect(extractAttachmentRefs(md)).toEqual(['attachments/foo.png'])
  })

  test('empty input returns []', () => {
    expect(extractAttachmentRefs('')).toEqual([])
  })

  test('matches refs under the configured folder + the default for back-compat', () => {
    useSettingsStore.getState().setAttachmentsFolder('images')
    const md = '![a](images/new.png) and ![b](attachments/old.png) and ![c](other/foo.png)'
    expect(extractAttachmentRefs(md).sort()).toEqual([
      'attachments/old.png',
      'images/new.png',
    ])
  })

  test('matches refs under a nested configured path', () => {
    useSettingsStore.getState().setAttachmentsFolder('assets/images')
    const md = '![a](assets/images/foo.png) ![b](assets/other.png)'
    expect(extractAttachmentRefs(md)).toEqual(['assets/images/foo.png'])
  })
})

describe('collectReferencedAttachments', () => {
  test('unions refs across multiple notes', () => {
    const notes = [
      makeNote('![a](attachments/a.png)'),
      makeNote('![b](attachments/b.png)'),
      makeNote('plain text, no images'),
    ]
    const refs = collectReferencedAttachments(notes)
    expect([...refs].sort()).toEqual(['attachments/a.png', 'attachments/b.png'])
  })

  test('skips deleted notes', () => {
    const notes = [
      makeNote('![a](attachments/a.png)'),
      makeNote('![b](attachments/b.png)', { isDeleted: true }),
    ]
    expect([...collectReferencedAttachments(notes)]).toEqual(['attachments/a.png'])
  })
})

describe('extractWikiImageTargets', () => {
  test('captures bare image filenames from wiki embeds', () => {
    const md = 'see ![[Pasted image 20260522.png]] and ![[diagram.jpg|alt]]'
    expect(extractWikiImageTargets(md)).toEqual([
      'Pasted image 20260522.png',
      'diagram.jpg',
    ])
  })

  test('ignores non-image wiki embeds (note transclusions)', () => {
    expect(extractWikiImageTargets('![[Some Note]] and ![[notes/Daily]]')).toEqual([])
  })
})

describe('collectReferencedAttachments — wiki image embeds', () => {
  test('resolves a bare wiki embed to its stored path by basename', () => {
    const notes = [makeNote('![[Pasted image 20260522.png]]')]
    const stored = ['Files/Pasted image 20260522.png', 'Files/other.png']
    const refs = collectReferencedAttachments(notes, stored)
    expect(refs.has('Files/Pasted image 20260522.png')).toBe(true)
    expect(refs.has('Files/other.png')).toBe(false)
  })

  test('without knownPaths, only explicit ![](path) forms are counted', () => {
    const notes = [makeNote('![[Pasted image.png]] ![](attachments/x.png)')]
    const refs = collectReferencedAttachments(notes)
    expect([...refs]).toEqual(['attachments/x.png'])
  })
})

describe('findOrphanAttachments', () => {
  test('returns paths in storage that no note references', () => {
    const paths = [
      'attachments/used.png',
      'attachments/orphan1.png',
      'attachments/orphan2.png',
    ]
    const notes = [makeNote('![](attachments/used.png)')]
    expect(findOrphanAttachments(paths, notes).sort()).toEqual([
      'attachments/orphan1.png',
      'attachments/orphan2.png',
    ])
  })

  test('a wiki-embedded image is NOT flagged as an orphan', () => {
    // The Obsidian case: attachments folder configured to `Files`, note embeds
    // the bare filename. Before the fix all 164 such files were false orphans.
    useSettingsStore.getState().setAttachmentsFolder('Files')
    const paths = [
      'Files/Pasted image 20260522.png', // referenced via wiki embed
      'Files/unused.png',                // genuine orphan
    ]
    const notes = [makeNote('here it is: ![[Pasted image 20260522.png]]')]
    expect(findOrphanAttachments(paths, notes)).toEqual(['Files/unused.png'])
  })

  test('excludes non-attachment keys defensively', () => {
    const paths = ['some/other/key', 'attachments/orphan.png']
    expect(findOrphanAttachments(paths, [])).toEqual(['attachments/orphan.png'])
  })

  test('empty inputs → []', () => {
    expect(findOrphanAttachments([], [])).toEqual([])
    expect(findOrphanAttachments([], [makeNote('![a](attachments/a.png)')])).toEqual([])
  })
})
