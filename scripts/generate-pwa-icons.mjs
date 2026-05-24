/**
 * Generate the PWA PNG icons the manifest needs (192, 512, maskable 512)
 * from the existing src/app/icon.svg monogram. Run once; the PNGs are then
 * committed under public/icons/. Re-run if the source icon changes:
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Uses `sharp` (already in node_modules via Next's image optimizer).
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public', 'icons')

const BG = '#1b1b1b' // obsidianBlack — matches theme_color / background_color
const ACCENT = '#1d6ee8' // noteser blue

// A full-bleed "any" icon: rounded-square dark tile + centered N glyph,
// scaled so the glyph fills most of the tile (good for browser/Android).
function anyIconSvg(size) {
  const r = Math.round(size * 0.18)
  // The glyph path is authored on a 32x32 viewBox (see src/app/icon.svg);
  // scale it to the requested size.
  const s = size / 32
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/>
  <g transform="scale(${s})">
    <path fill="${ACCENT}" d="M9 7 h3.4 l7.2 11.5 V7 H23 v18 h-3.4 l-7.2-11.5 V25 H9 z"/>
  </g>
</svg>`
}

// A maskable icon: same glyph but shrunk into the inner ~60% "safe zone"
// so platform masks (circle, squircle, rounded-rect) never clip it. The
// background fills the whole canvas (full bleed) so any mask shape is dark.
function maskableIconSvg(size) {
  const s = size / 32
  const inner = 0.6 // glyph occupies 60% of the canvas, centered
  const offset = (size * (1 - inner)) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${(s * inner).toFixed(4)})">
    <path fill="${ACCENT}" d="M9 7 h3.4 l7.2 11.5 V7 H23 v18 h-3.4 l-7.2-11.5 V25 H9 z"/>
  </g>
</svg>`
}

async function render(svg, file) {
  const out = resolve(outDir, file)
  await sharp(Buffer.from(svg)).png().toFile(out)
  console.log('wrote', out)
}

await mkdir(outDir, { recursive: true })
await render(anyIconSvg(192), 'icon-192.png')
await render(anyIconSvg(512), 'icon-512.png')
await render(maskableIconSvg(512), 'icon-maskable-512.png')
console.log('done')
