'use client'

import { useMemo } from 'react'
import { useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { toggleTaskLine } from '@/utils/tasks'
import {
  parseTaskQuery,
  executeTaskQuery,
  groupTasks,
  explainQuery,
  type ExecutedTask,
} from '@/utils/taskQuery'

// Rendered inside the markdown preview wherever the user writes:
//   ```tasks
//   not done path includes Projects group by folder
//   ```
// Currently rendered preview only — live preview falls back to the raw fence
// until the CodeMirror widget lands.
export const TaskQueryBlock = ({ source }: { source: string }) => {
  const notes = useNoteStore(s => s.notes)
  const folders = useFolderStore(s => s.folders)
  const updateNote = useNoteStore(s => s.updateNote)
  const openNote = useWorkspaceStore(s => s.openNote)

  const { query, groups } = useMemo(() => {
    const query = parseTaskQuery(source)
    const tasks = executeTaskQuery(query, { notes, folders })
    return { query, groups: groupTasks(tasks, query.groupBy) }
  }, [source, notes, folders])

  const handleToggle = (task: ExecutedTask) => {
    const note = notes.find(n => n.id === task.noteId)
    if (!note) return
    const next = toggleTaskLine(note.content, task.lineNumber)
    if (next !== note.content) updateNote(task.noteId, { content: next })
  }

  const handleOpen = (task: ExecutedTask) => {
    openNote(task.noteId, { preview: false })
  }

  const total = groups.reduce((n, g) => n + g.tasks.length, 0)

  return (
    <div
      className="not-prose my-2 rounded border border-obsidianBorder bg-obsidianDarkGray/40 px-3 py-2 text-sm"
      data-keep-preview="true"
    >
      {query.explain && (
        <div className="text-[11px] text-obsidianSecondaryText mb-2 italic">
          {explainQuery(query)}
          <span className="ml-2 not-italic">· {total} result{total === 1 ? '' : 's'}</span>
        </div>
      )}
      {total === 0 ? (
        <div className="text-[12px] text-obsidianSecondaryText italic py-1">No matching tasks.</div>
      ) : (
        groups.map((g, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
            {g.keys.length > 0 && (
              <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText mb-1">
                {g.keys.join(' › ')}
              </div>
            )}
            <ul className="space-y-1">
              {g.tasks.map(task => (
                <li
                  key={`${task.noteId}:${task.lineNumber}`}
                  className="flex items-start gap-2"
                >
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => handleToggle(task)}
                    className="mt-1 flex-shrink-0 accent-obsidianAccentPurple cursor-pointer"
                  />
                  <div className="min-w-0 flex-1">
                    <span
                      className={`cursor-pointer hover:underline ${
                        task.completed ? 'text-obsidianSecondaryText line-through' : 'text-obsidianText'
                      }`}
                      onClick={() => handleOpen(task)}
                      title={`Open ${task.noteTitle}`}
                    >
                      {task.text || '(empty)'}
                    </span>
                    {!query.groupBy.includes('filename') && (
                      <span className="ml-2 text-[11px] text-obsidianSecondaryText">
                        — {task.noteTitle}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}

export default TaskQueryBlock
