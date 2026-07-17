'use client'

import { useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { parseFrontmatter, writeFrontmatter, type FrontmatterField, type FrontmatterValue } from '@/utils/frontmatter'

interface Props {
  /** Note's full content (frontmatter + body). */
  content: string
  /** Called with the new full content when the user edits a field. */
  onChange: (next: string) => void
}

// Renders the YAML frontmatter block above the editor as an editable
// key-value table. Collapsed by default to save vertical space; expands
// when the user clicks the header. When the note has no frontmatter
// we still mount a compact "Add properties" affordance so the feature
// is discoverable.
export function FrontmatterPanel({ content, onChange }: Props) {
  const parsed = useMemo(() => parseFrontmatter(content), [content])
  const [expanded, setExpanded] = useState(parsed.hasFrontmatter)

  if (!parsed.hasFrontmatter) {
    return (
      <div className="px-4 py-1 text-xs text-obsidianSecondaryText border-b border-obsidianBorder/50">
        <button
          type="button"
          onClick={() => {
            // Seed with a single empty row so the user has something to type into.
            const next = writeFrontmatter(content, [
              { key: 'tags', value: [], isArray: true, raw: 'tags: []', isUnknown: false },
            ])
            onChange(next)
            setExpanded(true)
          }}
          className="text-obsidianSecondaryText hover:text-obsidianText transition-colors flex items-center gap-1"
          data-testid="frontmatter-add"
        >
          <PlusIcon className="w-3 h-3" />
          Add properties
        </button>
      </div>
    )
  }

  const updateField = (idx: number, next: Partial<FrontmatterField>) => {
    const fields = parsed.fields.slice()
    fields[idx] = { ...fields[idx], ...next, raw: '' /* force re-serialize */ }
    onChange(writeFrontmatter(content, fields))
  }

  const removeField = (idx: number) => {
    const fields = parsed.fields.slice()
    fields.splice(idx, 1)
    onChange(writeFrontmatter(content, fields))
  }

  const addField = () => {
    const fields = parsed.fields.slice()
    // Find a non-colliding default key.
    let n = 1
    let key = 'property'
    while (fields.some(f => f.key === key)) {
      n += 1
      key = `property${n}`
    }
    fields.push({ key, value: '', isArray: false, raw: '', isUnknown: false })
    onChange(writeFrontmatter(content, fields))
  }

  return (
    <div className="border-b border-obsidianBorder/50 bg-obsidianBlack/40" data-testid="frontmatter-panel">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1 px-4 py-1.5 text-xs text-obsidianSecondaryText hover:text-obsidianText"
      >
        {expanded
          ? <ChevronDownIcon className="w-3 h-3" />
          : <ChevronRightIcon className="w-3 h-3" />}
        <span>Properties ({parsed.fields.length})</span>
      </button>
      {expanded && (
        <div className="px-4 pb-2 space-y-1">
          {parsed.fields.map((field, idx) => (
            <FieldRow
              key={`${field.key}-${idx}`}
              field={field}
              onChange={(next) => updateField(idx, next)}
              onRemove={() => removeField(idx)}
            />
          ))}
          <button
            type="button"
            onClick={addField}
            data-testid="frontmatter-add-row"
            className="text-xs text-obsidianSecondaryText hover:text-obsidianText flex items-center gap-1 pt-1"
          >
            <PlusIcon className="w-3 h-3" />
            Add property
          </button>
        </div>
      )}
    </div>
  )
}

function FieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: FrontmatterField
  onChange: (next: Partial<FrontmatterField>) => void
  onRemove: () => void
}) {
  if (field.isUnknown) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <code className="font-mono text-obsidianSecondaryText flex-1 truncate" title={field.raw}>
          {field.raw}
        </code>
        <span className="text-obsidianSecondaryText italic">(unparsed — edit in source)</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <input
        type="text"
        value={field.key}
        onChange={e => onChange({ key: e.target.value })}
        className="font-mono w-32 px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:border-obsidianAccentPurple"
      />
      <ValueInput field={field} onChange={onChange} />
      <button
        type="button"
        onClick={onRemove}
        title="Remove property"
        className="p-1 text-obsidianSecondaryText hover:text-red-400"
      >
        <TrashIcon className="w-3 h-3" />
      </button>
    </div>
  )
}

function ValueInput({
  field,
  onChange,
}: {
  field: FrontmatterField
  onChange: (next: Partial<FrontmatterField>) => void
}) {
  // Boolean → checkbox.
  if (typeof field.value === 'boolean') {
    return (
      <label className="flex-1 flex items-center gap-2 text-obsidianText">
        <input
          type="checkbox"
          checked={field.value}
          onChange={e => onChange({ value: e.target.checked })}
        />
        <span className="text-obsidianSecondaryText">{field.value ? 'true' : 'false'}</span>
      </label>
    )
  }
  // Array → comma-separated. We split on commas at save time.
  if (field.isArray) {
    const arr = Array.isArray(field.value) ? field.value : []
    return (
      <input
        type="text"
        value={arr.join(', ')}
        onChange={e => {
          const next = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
          onChange({ value: next, isArray: true })
        }}
        placeholder="comma-separated"
        className="flex-1 px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText focus:outline-hidden focus:border-obsidianAccentPurple"
      />
    )
  }
  // Number → numeric input.
  if (typeof field.value === 'number') {
    return (
      <input
        type="number"
        value={field.value}
        onChange={e => onChange({ value: e.target.value === '' ? 0 : Number(e.target.value) })}
        className="flex-1 px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText focus:outline-hidden focus:border-obsidianAccentPurple"
      />
    )
  }
  // String (default).
  const s = (field.value as FrontmatterValue) == null ? '' : String(field.value)
  return (
    <input
      type="text"
      value={s}
      onChange={e => onChange({ value: e.target.value })}
      className="flex-1 px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText focus:outline-hidden focus:border-obsidianAccentPurple"
    />
  )
}

export default FrontmatterPanel
