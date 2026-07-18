'use client'

import { useMemo, useState } from 'react'
import { useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { parseBasesQuery, executeBasesQuery } from '@/utils/basesQuery'
import { parseFrontmatter, writeFrontmatter } from '@/utils/frontmatter'

interface Props {
  /** Source text of the ```bases fence (body only, no fences). */
  source: string
}

// Synthesized columns are read-only — they're computed from other state
// (folder path, modified timestamp, etc) and can't be written via
// frontmatter.
const READ_ONLY_COLUMNS = new Set(['folder', 'path', 'modified', 'created', 'tags'])

// Renders the executed BasesQuery as a table. Click a frontmatter cell
// to edit it inline — value is written back to the source note via
// writeFrontmatter. Click the title cell to open the underlying note.
export function BasesBlock({ source }: Props) {
  const notes = useNoteStore(s => s.notes)
  const folders = useFolderStore(s => s.folders)
  const updateNote = useNoteStore(s => s.updateNote)
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

  // Single in-flight edit at a time. `${noteId}|${column}` is the key.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (error) {
    return (
      <div className="my-2 p-3 border border-red-500/40 bg-red-500/5 rounded-sm text-sm text-red-400">
        <strong>Bases query error:</strong> {error}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="my-2 p-3 border border-obsidianBorder bg-obsidianDarkGray/40 rounded-sm text-sm text-obsidianSecondaryText">
        <em>No matching notes.</em>
      </div>
    )
  }

  function commitEdit(noteId: string, col: string, raw: string) {
    const note = useNoteStore.getState().notes.find(n => n.id === noteId)
    if (!note) return
    const trimmed = raw.trim()

    // Special-case: `title` writes to the note's title field, not frontmatter.
    if (col === 'title') {
      updateNote(noteId, { title: trimmed || 'Untitled' })
      return
    }

    const fm = parseFrontmatter(note.content ?? '')
    const fields = fm.fields.slice()
    const idx = fields.findIndex(f => f.key === col)
    if (trimmed === '' && idx !== -1) {
      // Empty value → remove the property entirely.
      fields.splice(idx, 1)
    } else if (trimmed !== '') {
      if (idx === -1) {
        fields.push({ key: col, value: trimmed, isArray: false, raw: '', isUnknown: false })
      } else {
        fields[idx] = { ...fields[idx], value: trimmed, raw: '' }
      }
    }
    const nextContent = writeFrontmatter(note.content ?? '', fields)
    updateNote(noteId, { content: nextContent })
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
              className="border-b border-obsidianBorder/40 hover:bg-obsidianHighlight/40"
            >
              {columns.map(col => {
                const cellKey = `${row.noteId}|${col}`
                const isEditing = editing === cellKey
                const isReadOnly = READ_ONLY_COLUMNS.has(col.toLowerCase())
                const value = row.cells[col] ?? ''

                if (isEditing) {
                  return (
                    <td key={col} className="px-2 py-1 align-top">
                      <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => {
                          commitEdit(row.noteId, col, draft)
                          setEditing(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitEdit(row.noteId, col, draft)
                            setEditing(null)
                          } else if (e.key === 'Escape') {
                            setEditing(null)
                          }
                        }}
                        autoFocus
                        className="w-full bg-obsidianDarkGray border border-obsidianAccentPurple rounded-sm px-1.5 py-0.5 text-obsidianText focus:outline-hidden"
                        data-testid={`bases-edit-${row.noteId}-${col}`}
                      />
                    </td>
                  )
                }

                return (
                  <td
                    key={col}
                    className={`px-2 py-1.5 text-obsidianText align-top ${
                      isReadOnly ? 'cursor-default' : 'cursor-text hover:bg-obsidianHighlight/30'
                    }`}
                    onClick={(e) => {
                      if (col === 'title') {
                        // Title clicks open the note (matches the v1 behaviour).
                        e.stopPropagation()
                        openNote(row.noteId, { preview: false })
                        return
                      }
                      if (isReadOnly) return
                      e.stopPropagation()
                      setEditing(cellKey)
                      setDraft(value)
                    }}
                  >
                    {col === 'title' ? (
                      <span className="text-obsidianAccentPurple hover:underline">{value}</span>
                    ) : (
                      value || <span className="text-obsidianSecondaryText/60">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-obsidianSecondaryText/70 mt-1 px-2">
        {rows.length} note{rows.length === 1 ? '' : 's'}
        <span className="ml-2 text-obsidianSecondaryText/50">
          Click a cell to edit · Read-only: {[...READ_ONLY_COLUMNS].join(', ')}
        </span>
      </div>
    </div>
  )
}

export default BasesBlock
