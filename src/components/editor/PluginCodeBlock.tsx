'use client'

// Renders a fenced code block whose language is claimed by an
// installed plugin's `codeBlockRenderers` surface entry. The block's
// source is sent into the plugin's Worker via PluginHost; the plugin
// emits a virtual-DOM node back, which we draw here.
//
// Hot path: invoked once per fenced block during each markdown
// render pass. The blockId is derived from a hash of (language +
// source) so that two structurally-identical blocks share the same
// pending render request and the same cached result.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPluginHost } from '@/plugins/pluginHostSingleton'
import { PluginNode, type PluginVNodeEvent } from '@/plugins/PluginVNode'
import type { PluginHostEvent } from '@/plugins/PluginHost'

interface Props {
  pluginId: string
  language: string
  source: string
}

export const PluginCodeBlock = ({ pluginId, language, source }: Props) => {
  const blockId = useStableBlockId(language, source)
  const [node, setNode] = useState<unknown | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = getPluginHost()
    if (!host) {
      setError('Plugin host not available.')
      return
    }

    const handler = (event: PluginHostEvent) => {
      if (event.type === 'renderResult' && event.pluginId === pluginId && event.blockId === blockId) {
        setNode(event.node)
      } else if (event.type === 'workerError' && event.pluginId === pluginId) {
        setError(event.message)
      }
    }
    const unsubscribe = host.on(handler)

    host.renderCodeBlock(pluginId, { language, source, blockId })

    return () => {
      unsubscribe()
    }
  }, [pluginId, language, source, blockId])

  // VNode event dispatch — wraps the renderer's event tuple with the
  // `codeBlock` source descriptor and forwards through the plugin host.
  // Rate-limited per plugin in PluginHost.sendVNodeEvent.
  const handleEvent = useCallback(
    (e: PluginVNodeEvent) => {
      const host = getPluginHost()
      if (!host) return
      host.sendVNodeEvent(pluginId, { kind: 'codeBlock', blockId }, e.event, e.payload)
    },
    [pluginId, blockId],
  )

  if (error) {
    return (
      <pre className="my-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
        Plugin error ({pluginId}): {error}
      </pre>
    )
  }

  if (node === undefined) {
    return (
      <div className="my-2 rounded-lg border border-obsidianBorder bg-obsidianDarkGray p-3 text-xs text-obsidianSecondaryText">
        Rendering {language}… (plugin: {pluginId})
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-obsidianBorder bg-obsidianDarkGray p-3 text-sm text-obsidianText overflow-x-auto">
      <PluginNode node={node} onEvent={handleEvent} />
    </div>
  )
}

/**
 * Deterministic per-render id derived from (language + source). Two
 * blocks with identical content share an id; if the user edits a
 * block, the id changes and a fresh render request fires. Returning
 * the same value across re-renders prevents an infinite re-mount
 * loop when the parent's render is cheap and frequent.
 */
function useStableBlockId(language: string, source: string): string {
  const idRef = useRef<{ language: string; source: string; id: string } | null>(null)
  if (
    idRef.current === null ||
    idRef.current.language !== language ||
    idRef.current.source !== source
  ) {
    idRef.current = {
      language,
      source,
      id: `${language}:${djb2(language + '\0' + source)}`,
    }
  }
  return idRef.current.id
}

/** djb2 string hash — small, fast, good enough for cache-key dedup
 *  on user-typed content. Returned as an unsigned base-36 string so
 *  the id stays short and URL-safe. */
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}
