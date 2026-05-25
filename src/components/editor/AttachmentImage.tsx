'use client'

import { useEffect, useState } from 'react'
import { getAttachmentUrl, isAttachmentPath, isKnownAttachmentPath } from '@/utils/attachments'

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
    getAttachmentUrl(src).then(url => {
      if (cancelled) return
      if (url) setResolved(url)
      else setMissing(true)
    })
    return () => { cancelled = true }
  }, [src, isStored])

  if (src && isStored) {
    if (missing) {
      return (
        <span className="inline-block px-2 py-1 rounded bg-obsidianDarkGray text-xs text-obsidianSecondaryText">
          Missing attachment: {src}
        </span>
      )
    }
    if (!resolved) {
      return (
        <span className="inline-block px-2 py-1 rounded bg-obsidianDarkGray text-xs text-obsidianSecondaryText">
          Loading {alt || src}…
        </span>
      )
    }
    // next/image doesn't work here: `resolved` is a blob: URL pointing at an
    // IndexedDB-stored attachment, which next/image's optimizer can't fetch.
    // Plain <img> is the right call.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolved} alt={alt} title={title} className="max-w-full rounded" />
  }

  // Same reason as above — `src` may be a wikilink-style ref we resolved to a
  // blob URL elsewhere, or a remote URL we don't want next/image to proxy.
  // Use the RAW (un-decoded) src here so external URLs keep their original
  // encoding; only the attachment lookup above needs the decoded form.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={rawSrc} alt={alt} title={title} className="max-w-full rounded" />
}

export default AttachmentImage
