'use client'

import { useEffect, useState } from 'react'

// True while a tab is being dragged anywhere on the page. We listen to
// `dragstart`/`dragend` at the window level and key off our custom mime type
// so unrelated drags (note moves, files dropped in, etc.) don't trip this.
export const TAB_DRAG_MIME = 'application/x-noteser-tab'

export function useTabDragActive(): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      // dataTransfer.types is a DOMStringList; on dragstart the data is
      // available; on dragover it's also available but values aren't readable
      // until drop. types is always readable.
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes(TAB_DRAG_MIME)) {
        setActive(true)
      }
    }
    const onEnd = () => setActive(false)
    window.addEventListener('dragstart', onStart)
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    return () => {
      window.removeEventListener('dragstart', onStart)
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('drop', onEnd)
    }
  }, [])
  return active
}
