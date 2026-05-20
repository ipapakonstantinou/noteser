'use client'

import { useMemo } from 'react'
import { useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { parseBasesQuery, executeBasesQuery } from '@/utils/basesQuery'

interface Props {
  /** Source text of the ```bases fence (body only, no fences). */
  source: string
}

// Renders the executed BasesQuery as a table. Clicking a row title opens
// the underlying note in the active pane. Read-only for v1 — inline cell
// edits land in a follow-up.
export function BasesBlock({ source }: Props) {
  const notes = useNoteStore(s => s.notes)
  const folders = useFolderStore(s => s.folders)
  const openNote = useWorkspaceStore(s => s.openNote)

  const { rows, columns, error } = useMemo(() => {
    try {
      const q = parseBasesQuery(source)
      const rows = executeBasesQuery(q, notes, folders)
      return { rows, columns: q.columns, error: null }
    } catch (e) {
      return { rows: [], columns: [], error: e instanceof Error ? e.message : 'query failed' }
    }
  }, [source, notes, folders])

  if (error) {
    return (
      <div className="my-2 p-3 border border-red-500/40 bg-red-500/5 rounded text-sm text-red-400">
        <strong>Bases query error:</strong> {error}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="my-2 p-3 border border-obsidianBorder bg-obsidianDarkGray/40 rounded text-sm text-obsidianSecondaryText">
        <em>No matching notes.</em>
      </div>
    )
  }

  return (
    <div className="my-2 overflow-x-auto" data-testid="bases-block">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-obsidianBorder">
            {columns.map(col => (
              <th
                key={col}
                className="text-left px-2 py-1.5 text-obsidianSecondaryText font-medium"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.noteId}
              className="border-b border-obsidianBorder/40 hover:bg-obsidianHighlight/40 cursor-pointer"
              onClick={() => openNote(row.noteId, { preview: false })}
            >
              {columns.map(col => (
                <td
                  key={col}
                  className="px-2 py-1.5 text-obsidianText align-top"
                >
                  {col === 'title' ? (
                    <span className="text-obsidianAccentPurple hover:underline">
                      {row.cells[col]}
                    </span>
                  ) : (
                    row.cells[col] || <span className="text-obsidianSecondaryText/60">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-obsidianSecondaryText/70 mt-1 px-2">
        {rows.length} note{rows.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}

export default BasesBlock
