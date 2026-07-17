'use client'

import { useEffect, useState } from 'react'
import { getAttachmentUrl, isAttachmentPath, isKnownAttachmentPath, putAttachmentAtPath } from '@/utils/attachments'
import { TUTORIAL_ASSETS_SUBDIR, TUTORIAL_IMAGES } from '@/utils/featureTourNote'

interface AttachmentImageProps {
  // ReactMarkdown widens src to `string | Blob`; we only handle string paths.
  src?: string | Blob
  alt?: string
  title?: string
}

// ReactMarkdown img-tag replacement. For attachment paths we resolve the
// IDB-stored blob to an object URL; everything else falls through to a plain
// <img> so external URLs (http(s), data:, etc.) keep working.
//
// "Attachment path" = either under the configured attachments folder
// (isAttachmentPath) OR a path the in-memory index knows is a stored blob
// (isKnownAttachmentPath). The latter covers Obsidian image embeds resolved
// to a non-`attachments/` folder such as `Files/foo.png`.
//
// The markdown renderer percent-encodes image destinations (a path with
// spaces like `Files/Pasted image.png` becomes `Files/Pasted%20image.png`),
// but attachments are stored/indexed under their LITERAL path. So we decode
// the src before every IDB lookup, otherwise the reading-mode preview shows
// "Missing attachment" while the live preview (which resolves directly) works.
function decodeAttachmentSrc(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Feature-tour images live under `<attachmentsFolder>/feature-tour/<file>.png`
// and ship as static assets in `/public/feature-tour/`. The tour note is
// seeded once (clicking the Feature tour card on the welcome screen seeds
// the PNGs into IDB), but if the IDB is cleared by a reset or the user
// opens the note on a fresh device before clicking the card, the images
// resolve as "Missing attachment". Detecting that pattern lets us heal
// on-the-fly: fetch the public asset, write it back into IDB so subsequent
// paints are instant, and return its URL for this paint.
const TUTORIAL_FILES = new Set<string>(TUTORIAL_IMAGES)

function tourFallbackUrl(path: string): string | null {
  // Match `<anything>/feature-tour/<filename>.png` where filename is a
  // bundled tutorial image. Anchor on the segment to avoid matching user
  // attachments that happen to share a filename.
  const segments = path.split('/')
  const len = segments.length
  if (len < 2) return null
  if (segments[len - 2] !== TUTORIAL_ASSETS_SUBDIR) return null
  const filename = segments[len - 1]
  if (!TUTORIAL_FILES.has(filename)) return null
  return `/${TUTORIAL_ASSETS_SUBDIR}/${filename}`
}

// Heal by re-fetching the public asset and writing it into IDB at the
// expected attachment path. Best-effort: a failed write still lets the
// caller paint the public URL directly.
async function healTourAttachment(path: string, filename: string): Promise<string | null> {
  try {
    const res = await fetch(`/${TUTORIAL_ASSETS_SUBDIR}/${filename}`)
    if (!res.ok) return null
    const blob = await res.blob()
    void putAttachmentAtPath(path, blob, filename).catch(() => { /* fire-and-forget */ })
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

export const AttachmentImage = ({ src: srcProp, alt, title }: AttachmentImageProps) => {
  const rawSrc = typeof srcProp === 'string' ? srcProp : undefined
  // Decoded form used for the attachment index + IDB lookup (literal spaces).
  const src = rawSrc ? decodeAttachmentSrc(rawSrc) : undefined
  const isStored = !!src && (isAttachmentPath(src) || isKnownAttachmentPath(src))
  const [resolved, setResolved] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!src || !isStored) {
      setResolved(null)
      setMissing(false)
      return
    }
    setMissing(false)
    getAttachmentUrl(src).then(async url => {
      if (cancelled) return
      if (url) {
        setResolved(url)
        return
      }
      // IDB miss — if this looks like a Feature tour image, fetch the
      // bundled public asset, repaint with that, and write it back into
      // IDB so the next paint hits the fast path. Falls through to the
      // "Missing attachment" callout if the heal also fails.
      const fallback = tourFallbackUrl(src)
      if (fallback) {
        const filename = fallback.split('/').pop()!
        const healedUrl = await healTourAttachment(src, filename)
        if (cancelled) return
        if (healedUrl) {
          setResolved(healedUrl)
          return
        }
      }
      setMissing(true)
    })
    return () => { cancelled = true }
  }, [src, isStored])

  if (src && isStored) {
    if (missing) {
      return (
        <span className="inline-block px-2 py-1 rounded-sm bg-obsidianDarkGray text-xs text-obsidianSecondaryText">
          Missing attachment: {src}
        </span>
      )
    }
    if (!resolved) {
      return (
        <span className="inline-block px-2 py-1 rounded-sm bg-obsidianDarkGray text-xs text-obsidianSecondaryText">
          Loading {alt || src}…
        </span>
      )
    }
    // next/image doesn't work here: `resolved` is a blob: URL pointing at an
    // IndexedDB-stored attachment, which next/image's optimizer can't fetch.
    // Plain <img> is the right call.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolved} alt={alt} title={title} className="max-w-full rounded-sm" />
  }

  // Same reason as above — `src` may be a wikilink-style ref we resolved to a
  // blob URL elsewhere, or a remote URL we don't want next/image to proxy.
  // Use the RAW (un-decoded) src here so external URLs keep their original
  // encoding; only the attachment lookup above needs the decoded form.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={rawSrc} alt={alt} title={title} className="max-w-full rounded-sm" />
}

export default AttachmentImage
