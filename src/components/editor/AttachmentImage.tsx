'use client'

import { useEffect, useState } from 'react'
import { getAttachmentUrl, isAttachmentPath } from '@/utils/attachments'

interface AttachmentImageProps {
  // ReactMarkdown widens src to `string | Blob`; we only handle string paths.
  src?: string | Blob
  alt?: string
  title?: string
}

// ReactMarkdown img-tag replacement. For `attachments/...` paths we resolve
// the IDB-stored blob to an object URL; everything else falls through to a
// plain <img> so external URLs (http(s), data:, etc.) keep working.
export const AttachmentImage = ({ src: srcProp, alt, title }: AttachmentImageProps) => {
  const src = typeof srcProp === 'string' ? srcProp : undefined
  const [resolved, setResolved] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!src || !isAttachmentPath(src)) {
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
  }, [src])

  if (src && isAttachmentPath(src)) {
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
    return <img src={resolved} alt={alt} title={title} className="max-w-full rounded" />
  }

  return <img src={src} alt={alt} title={title} className="max-w-full rounded" />
}

export default AttachmentImage
