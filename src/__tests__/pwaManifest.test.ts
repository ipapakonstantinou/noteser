// Smoke test for the PWA manifest. Asserts the shape Chrome / iOS
// rely on so a typo in JSON does not silently break the install flow.
import fs from 'node:fs'
import path from 'node:path'

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

interface Manifest {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: ManifestIcon[]
}

function loadManifest(): Manifest {
  const file = path.join(process.cwd(), 'public', 'manifest.json')
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest
}

describe('public/manifest.json', () => {
  const manifest = loadManifest()

  test('declares a name and short_name', () => {
    expect(typeof manifest.name).toBe('string')
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(typeof manifest.short_name).toBe('string')
    expect(manifest.short_name.length).toBeGreaterThan(0)
  })

  test('start_url and scope point at the app root', () => {
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
  })

  test('display mode is standalone (full PWA chrome)', () => {
    expect(manifest.display).toBe('standalone')
  })

  test('theme_color matches the obsidian palette', () => {
    expect(manifest.theme_color).toBe('#1b1b1b')
    expect(manifest.background_color).toBe('#1b1b1b')
  })

  test('provides 192 and 512 icons (Chrome required sizes)', () => {
    const sizes = manifest.icons.map(i => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  test('provides a maskable 512 icon for Android adaptive icons', () => {
    const maskable = manifest.icons.find(
      i => i.sizes === '512x512' && i.purpose === 'maskable',
    )
    expect(maskable).toBeDefined()
  })

  test('every declared icon file exists on disk', () => {
    for (const icon of manifest.icons) {
      const p = path.join(process.cwd(), 'public', icon.src.replace(/^\//, ''))
      expect(fs.existsSync(p)).toBe(true)
    }
  })
})
