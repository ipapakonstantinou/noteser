'use client'
import { useEffect, useRef } from 'react'
import { DataSet, Network } from 'vis-network/standalone'
import useNotesStorage from '../../hooks/useNotesStorage'

export default function GraphPage() {
  const { notes } = useNotesStorage()
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    const nodes = notes.map(n => ({ id: n.id, label: n.title }))
    const edges = []
    const linkRegex = /\[\[(.+?)\]\]/g
    notes.forEach(n => {
      const matches = n.content.matchAll(linkRegex)
      for (const m of matches) {
        const target = notes.find(t => t.title === m[1])
        if (target) edges.push({ from: n.id, to: target.id })
      }
    })
    const data = { nodes: new DataSet(nodes), edges: new DataSet(edges) }
    const network = new Network(containerRef.current, data, {
      nodes: { shape: 'dot', size: 16, font: { color: '#fff' } },
      edges: { color: '#999', arrows: { to: { enabled: true, scaleFactor: 0.5 } } },
      physics: { stabilization: true }
    })
    return () => network.destroy()
  }, [notes])

  return <div ref={containerRef} className="w-full h-screen bg-obsidianBlack" />
}
