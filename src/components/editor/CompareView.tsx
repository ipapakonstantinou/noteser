'use client'

import { useMemo } from 'react'
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import { diffByLine, type DiffHunk } from '@/utils/lineDiff'

interface Props {
  tabId: string
  leftNoteId: string
  rightNoteId: string
}

// Read-only side-by-side diff between two notes. Mirrors VS Code's
// "Compare with Selected" surface — no Apply, no resolve actions; the
// user closes the tab when done.
export const CompareView = ({ tabId, leftNoteId, rightNoteId }: Props) => {
  const notes = useNoteStore(s => s.notes)
  const closeTab = useWorkspaceStore(s => s.closeTab)

  const left = notes.find(n => n.id === leftNoteId) ?? null
  const right = notes.find(n => n.id === rightNoteId) ?? null

  const rows = useMemo<DisplayRow[]>(() => {
    if (!left || !right) return []
    return buildSideRows(diffByLine(left.content, right.content))
  }, [left, right])

  if (!left || !right) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center text-obsidianSecondaryText text-sm">
        One or both notes are no longer available.
        <Button variant="ghost" onClick={() => closeTab(tabId)} className="mt-3">
          Close
        </Button>
      </div>
    )
  }

  const changedCount = rows.filter(r => r.kind === 'change').length

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-obsidianBlack">
      <div className="px-4 py-2 border-b border-obsidianBorder flex items-center gap-2">
        <DocumentDuplicateIcon className="w-5 h-5 shrink-0 text-obsidianAccentPurple" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-obsidianText truncate">
            {left.title || 'Untitled'} <span className="text-obsidianSecondaryText">↔</span> {right.title || 'Untitled'}
          </div>
          <div className="text-xs text-obsidianSecondaryText">
            Compare · {changedCount} change{changedCount === 1 ? '' : 's'} · read only
          </div>
        </div>
        <Button variant="ghost" onClick={() => closeTab(tabId)}>Close</Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3 font-mono text-xs">
          <SidePanel
            title={left.title || 'Untitled'}
            side="left"
            rows={rows}
          />
          <SidePanel
            title={right.title || 'Untitled'}
            side="right"
            rows={rows}
          />
        </div>
      </div>
    </div>
  )
}

type DisplayRow =
  | { kind: 'equal'; leftLine: string; rightLine: string; leftLineNo: number; rightLineNo: number }
  | { kind: 'change'; leftLine: string | null; rightLine: string | null; leftLineNo: number | null; rightLineNo: number | null }

// Walk hunks into aligned left/right rows. `change` hunks pad the shorter
// side with null lines so both columns line up vertically — the same way
// VS Code's side-by-side diff stacks unmatched lines.
function buildSideRows(hunks: DiffHunk[]): DisplayRow[] {
  const out: DisplayRow[] = []
  let leftLineNo = 0
  let rightLineNo = 0
  for (const h of hunks) {
    if (h.type === 'equal') {
      for (const line of h.lines) {
        leftLineNo++
        rightLineNo++
        out.push({ kind: 'equal', leftLine: line, rightLine: line, leftLineNo, rightLineNo })
      }
      continue
    }
    const maxLen = Math.max(h.localLines.length, h.remoteLines.length)
    for (let i = 0; i < maxLen; i++) {
      const hasLeft = i < h.localLines.length
      const hasRight = i < h.remoteLines.length
      if (hasLeft) leftLineNo++
      if (hasRight) rightLineNo++
      out.push({
        kind: 'change',
        leftLine: hasLeft ? h.localLines[i] : null,
        rightLine: hasRight ? h.remoteLines[i] : null,
        leftLineNo: hasLeft ? leftLineNo : null,
        rightLineNo: hasRight ? rightLineNo : null,
      })
    }
  }
  return out
}

const SidePanel = ({
  title,
  side,
  rows,
}: {
  title: string
  side: 'left' | 'right'
  rows: DisplayRow[]
}) => (
  <div className="border border-obsidianBorder rounded-sm overflow-hidden">
    <div className="px-2 py-1 bg-obsidianDarkGray text-obsidianText border-b border-obsidianBorder truncate" title={title}>
      {title}
    </div>
    <div>
      {rows.map((row, idx) => {
        const text = side === 'left' ? row.leftLine : row.rightLine
        const lineNo = side === 'left' ? row.leftLineNo : row.rightLineNo
        const present = text != null
        const isChange = row.kind === 'change'
        const bg = !present
          ? 'bg-obsidianHighlight/30'
          : isChange
            ? side === 'left' ? 'bg-red-950/25' : 'bg-green-950/25'
            : ''
        return (
          <div key={idx} className={`flex ${bg}`} data-testid={`compare-row-${side}`}>
            <div className="select-none w-10 text-right pr-2 py-0.5 text-obsidianSecondaryText/60 shrink-0">
              {lineNo ?? ''}
            </div>
            <pre className="flex-1 py-0.5 px-2 text-obsidianText whitespace-pre-wrap wrap-break-word min-w-0">
              {present ? (text === '' ? ' ' : text) : ''}
            </pre>
          </div>
        )
      })}
    </div>
  </div>
)

export default CompareView
