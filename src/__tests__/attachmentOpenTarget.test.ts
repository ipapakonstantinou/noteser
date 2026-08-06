/**
 * attachmentOpenTarget.test.ts
 *
 * Opening an attachment from the sidebar used to hand `window.open` a `blob:`
 * URL built from the STORED blob — whose type a collab peer sets verbatim
 * (`AttachmentEntry.mime`) and the sync path lifts from the repo. A `blob:`
 * document is same-origin, so `text/html` or an `.svg` full of script would run
 * with access to this origin's localStorage, where the GitHub token lives.
 *
 * getAttachmentOpenTarget decides the type from the extension instead, and
 * flags anything script-capable or unrecognised for download.
 */

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (k: string) => idb.get(k)),
  set: jest.fn(async (k: string, v: unknown) => { idb.set(k, v) }),
  del: jest.fn(async (k: string) => { idb.delete(k) }),
  keys: jest.fn(async () => Array.from(idb.keys())),
}))

import { getAttachmentOpenTarget, putAttachmentAtPath } from '../utils/attachments'

// jsdom has no object-URL implementation; hand back the blob so assertions can
// read the type the helper chose.
const minted: Blob[] = []
beforeAll(() => {
  URL.createObjectURL = jest.fn((blob: Blob) => {
    minted.push(blob)
    return `blob:mock/${minted.length - 1}`
  }) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL
})

beforeEach(() => {
  idb.clear()
  minted.length = 0
})

function mintedTypeFor(url: string): string {
  return minted[Number(url.split('/')[1])].type
}

test('a png opens in a tab with the type derived from its extension', async () => {
  await putAttachmentAtPath('attachments/shot.png', new Blob(['x'], { type: 'image/png' }))

  const target = await getAttachmentOpenTarget('attachments/shot.png')

  expect(target).not.toBeNull()
  expect(target!.mode).toBe('view')
  expect(mintedTypeFor(target!.url)).toBe('image/png')
  expect(target!.filename).toBe('shot.png')
})

test('an svg is never navigated to — it downloads', async () => {
  // Exactly the hostile case: script-capable bytes under an image type.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  await putAttachmentAtPath('attachments/logo.svg', new Blob([svg], { type: 'image/svg+xml' }))

  const target = await getAttachmentOpenTarget('attachments/logo.svg')

  expect(target!.mode).toBe('download')
  expect(mintedTypeFor(target!.url)).toBe('application/octet-stream')
})

test('a peer-supplied text/html type is ignored in favour of the extension', async () => {
  await putAttachmentAtPath(
    'attachments/innocent.png',
    new Blob(['<h1>hi</h1><script>alert(1)</script>'], { type: 'text/html' }),
  )

  const target = await getAttachmentOpenTarget('attachments/innocent.png')

  expect(target!.mode).toBe('view')
  // The bytes are not an image, so the tab shows a broken image — not a
  // same-origin HTML document, which is the whole point.
  expect(mintedTypeFor(target!.url)).toBe('image/png')
})

test('an html attachment downloads rather than opening', async () => {
  await putAttachmentAtPath('attachments/page.html', new Blob(['<h1>hi</h1>'], { type: 'text/html' }))

  const target = await getAttachmentOpenTarget('attachments/page.html')

  expect(target!.mode).toBe('download')
  expect(mintedTypeFor(target!.url)).toBe('application/octet-stream')
})

test('a pdf still opens in the browser viewer', async () => {
  await putAttachmentAtPath('attachments/spec.pdf', new Blob(['%PDF-1.4'], { type: 'application/pdf' }))

  const target = await getAttachmentOpenTarget('attachments/spec.pdf')

  expect(target!.mode).toBe('view')
  expect(mintedTypeFor(target!.url)).toBe('application/pdf')
})

test('an extensionless or unknown file downloads', async () => {
  await putAttachmentAtPath('attachments/README', new Blob(['x'], { type: 'text/plain' }))
  await putAttachmentAtPath('attachments/data.bin', new Blob(['x'], { type: 'text/html' }))

  expect((await getAttachmentOpenTarget('attachments/README'))!.mode).toBe('download')
  expect((await getAttachmentOpenTarget('attachments/data.bin'))!.mode).toBe('download')
})

test('an unknown path returns null', async () => {
  expect(await getAttachmentOpenTarget('attachments/missing.png')).toBeNull()
})
