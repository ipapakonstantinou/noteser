'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUIStore, useNoteStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import {
  parseTaskMetadata,
  serializeTaskLine,
  UI_TASK_LINE_REGEX,
  type TaskPriority,
} from '@/utils/tasks'

// Stable list of priority options. `normal` has no emoji marker but is still
// a valid choice — picking it strips any existing priority marker on save.
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'highest', label: 'Highest (⏫)' },
  { value: 'high',    label: 'High (🔼)' },
  { value: 'normal',  label: 'Normal (no marker)' },
  { value: 'low',     label: 'Low (🔽)' },
  { value: 'lowest',  label: 'Lowest (⏬)' },
]

// Pulled out of the component so tests can import + reuse if needed.
interface TaskEditFormState {
  text: string
  open: boolean
  priority: TaskPriority
  dueDate: string
  scheduledDate: string
  startDate: string
  completedDate: string
}

const EMPTY_FORM: TaskEditFormState = {
  text: '',
  open: true,
  priority: 'normal',
  dueDate: '',
  scheduledDate: '',
  startDate: '',
  completedDate: '',
}

export const TaskEditModal = () => {
  const { modal, closeModal } = useUIStore()
  const { getNoteById, updateNote } = useNoteStore()

  const isOpen = modal.type === 'task-edit'
  const data = modal.data as { noteId: string; line: number } | undefined

  // Look up the task line's source text + parsed parts. Memoised on data so
  // re-renders during typing don't re-parse from the underlying note.
  const initial = useMemo(() => {
    if (!isOpen || !data) return null
    const note = getNoteById(data.noteId)
    if (!note?.content) return null
    const lines = note.content.split(/\r?\n/)
    const lineText = lines[data.line]
    if (lineText == null) return null
    const m = lineText.match(UI_TASK_LINE_REGEX)
    if (!m) return null
    const [, prefix, mark, , body] = m
    const parsed = parseTaskMetadata(body)
    const indent = /^(\s*)/.exec(prefix)?.[1] ?? ''
    // Preserve the original bullet style (e.g. `* `, `1. `, leading indent).
    // We rebuild it from the regex captures by stripping the trailing `[`.
    const bullet = prefix.endsWith('[') ? prefix.slice(0, -1) : prefix
    return {
      bullet: bullet || `${indent}- `,
      form: {
        text: parsed.text,
        open: mark.toLowerCase() !== 'x',
        priority: parsed.priority,
        dueDate: parsed.dueDate ?? '',
        scheduledDate: parsed.scheduledDate ?? '',
        startDate: parsed.startDate ?? '',
        completedDate: parsed.completedDate ?? '',
      } satisfies TaskEditFormState,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, data?.noteId, data?.line])

  const [form, setForm] = useState<TaskEditFormState>(EMPTY_FORM)
  const [bullet, setBullet] = useState<string>('- ')

  // Repopulate the form each time we open with new task data. Without the
  // reset, switching from one task to another would keep stale values.
  useEffect(() => {
    if (initial) {
      setForm(initial.form)
      setBullet(initial.bullet)
    }
  }, [initial])

  if (!isOpen) return null

  // Defensive: data missing or line no longer a task → close cleanly.
  if (!data || !initial) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="Edit Task" size="md">
        <div className="text-sm text-obsidianSecondaryText">
          This task line is no longer available.
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="secondary" onClick={closeModal}>Close</Button>
        </div>
      </Modal>
    )
  }

  const update = <K extends keyof TaskEditFormState>(key: K, value: TaskEditFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    const note = getNoteById(data.noteId)
    if (!note?.content) {
      closeModal()
      return
    }
    const lines = note.content.split(/\r?\n/)
    if (data.line < 0 || data.line >= lines.length) {
      closeModal()
      return
    }
    // Only rewrite if the line is still a task. If the user edited the line
    // out from under the modal (e.g. deleted the checkbox), bail rather than
    // corrupt their content.
    if (!UI_TASK_LINE_REGEX.test(lines[data.line])) {
      closeModal()
      return
    }
    const serialized = serializeTaskLine(
      {
        open: form.open,
        text: form.text,
        priority: form.priority,
        dueDate: form.dueDate || null,
        scheduledDate: form.scheduledDate || null,
        startDate: form.startDate || null,
        // Completed-date is only meaningful for closed tasks — strip it on
        // save when the user marks the task open.
        completedDate: form.open ? null : (form.completedDate || null),
      },
      bullet,
    )
    lines[data.line] = serialized
    updateNote(data.noteId, { content: lines.join('\n') })
    closeModal()
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Edit Task" size="md">
      <div className="space-y-4">
        <FormField label="Description">
          <input
            type="text"
            value={form.text}
            onChange={e => update('text', e.target.value)}
            className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple focus:border-transparent"
            placeholder="What needs doing?"
            aria-label="Task description"
            autoFocus
          />
        </FormField>

        <FormField label="Status">
          <label className="inline-flex items-center gap-2 text-sm text-obsidianText cursor-pointer">
            <input
              type="checkbox"
              checked={!form.open}
              onChange={e => update('open', !e.target.checked)}
              aria-label="Task done"
            />
            <span>Done</span>
          </label>
        </FormField>

        {!form.open && (
          <FormField label="Done date (✅)">
            <DateInput
              value={form.completedDate}
              onChange={v => update('completedDate', v)}
              ariaLabel="Done date"
            />
          </FormField>
        )}

        <FormField label="Due date (📅)">
          <DateInput
            value={form.dueDate}
            onChange={v => update('dueDate', v)}
            ariaLabel="Due date"
          />
        </FormField>

        <FormField label="Scheduled date (⏳)">
          <DateInput
            value={form.scheduledDate}
            onChange={v => update('scheduledDate', v)}
            ariaLabel="Scheduled date"
          />
        </FormField>

        <FormField label="Start date (🛫)">
          <DateInput
            value={form.startDate}
            onChange={v => update('startDate', v)}
            ariaLabel="Start date"
          />
        </FormField>

        <FormField label="Priority">
          <select
            value={form.priority}
            onChange={e => update('priority', e.target.value as TaskPriority)}
            aria-label="Priority"
            className="bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText focus:outline-none focus:border-obsidianAccentPurple"
          >
            {PRIORITY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </FormField>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

// Small two-column row used by every field in the modal.
const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start gap-3">
    <div className="w-32 flex-none text-sm text-obsidianSecondaryText pt-1.5">{label}</div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
)

// Wrap a native <input type="date"> with a small clear button so the user
// can remove a previously-set date without retyping. Native browser date
// pickers don't expose this affordance consistently.
const DateInput = ({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) => (
  <div className="flex items-center gap-2">
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded text-sm text-obsidianText focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple focus:border-transparent"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        className="text-xs text-obsidianSecondaryText hover:text-obsidianText underline"
        aria-label={`Clear ${ariaLabel}`}
      >
        clear
      </button>
    )}
  </div>
)

export default TaskEditModal
