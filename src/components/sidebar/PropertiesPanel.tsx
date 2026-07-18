'use client'

import { useMemo } from 'react'
import { StarIcon as StarOutlineIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid'
import { useNoteStore } from '@/stores'
import { extractTags } from '@/utils/tags'

// Per-note metadata panel rendered inside the right sidebar.
//
// v1 surface (deliberately narrow — Obsidian's Properties pane shows
// frontmatter aliases/cssclasses/tags, but noteser's data model has
// no aliases or cssclasses, only inline `#tag` patterns in the body):
//   - Title (read-only label; rename still happens via the sidebar
//     tree's inline-edit affordance)
//   - Tag chips (derived from `#word` patterns in content)
//   - Pin toggle (mirrors the context-menu Pin action)
//   - Git path (when synced)
//   - Created / Updated timestamps
//
// Empty state: shown when no note is selected.

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
})

function formatTimestamp(ts: number | null | undefined): string {
  if (ts == null || ts === 0) return '—'
  try {
    return dateFmt.format(new Date(ts))
  } catch {
    return '—'
  }
}

export const PropertiesPanel = () => {
  const selectedNoteId = useNoteStore(s => s.selectedNoteId)
  const note = useNoteStore(s =>
    selectedNoteId ? s.notes.find(n => n.id === selectedNoteId) : undefined,
  )
  const togglePinNote = useNoteStore(s => s.togglePinNote)

  // Memoise tag extraction so we don't re-parse the body on every
  // unrelated re-render (the panel re-renders when ANY note in the
  // store changes). `content` is the only field tag extraction reads,
  // so the dep array can scope tightly.
  const content = note?.content ?? ''
  const tags = useMemo(() => extractTags(content), [content])

  if (!note) {
    return (
      <div className="p-4 text-sm text-obsidianSecondaryText" data-testid="properties-empty">
        Select a note to see its properties.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 text-sm" data-testid="properties-panel">
      <PropertyRow label="Title">
        <div className="text-obsidianText truncate" title={note.title || '(untitled)'}>
          {note.title || <span className="text-obsidianSecondaryText italic">(untitled)</span>}
        </div>
      </PropertyRow>

      <PropertyRow label="Tags">
        {tags.length === 0 ? (
          <span className="text-obsidianSecondaryText italic">No tags</span>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="properties-tags">
            {tags.map(tag => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-sm text-xs bg-obsidianAccentPurple/15 text-obsidianAccentPurple"
                data-testid={`properties-tag-${tag}`}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </PropertyRow>

      <PropertyRow label="Pinned">
        <button
          type="button"
          onClick={() => togglePinNote(note.id)}
          className="inline-flex items-center gap-1.5 text-xs text-obsidianSecondaryText hover:text-obsidianText transition-colors"
          aria-pressed={note.isPinned}
          data-testid="properties-pin-toggle"
        >
          {note.isPinned ? (
            <>
              <StarSolidIcon className="w-4 h-4 text-yellow-500" />
              Pinned (click to unpin)
            </>
          ) : (
            <>
              <StarOutlineIcon className="w-4 h-4" />
              Not pinned
            </>
          )}
        </button>
      </PropertyRow>

      {note.gitPath && (
        <PropertyRow label="File path">
          <div
            className="font-mono text-xs text-obsidianSecondaryText break-all"
            data-testid="properties-git-path"
            title={note.gitPath}
          >
            {note.gitPath}
          </div>
        </PropertyRow>
      )}

      <PropertyRow label="Created">
        <div className="text-xs text-obsidianSecondaryText" data-testid="properties-created">
          {formatTimestamp(note.createdAt)}
        </div>
      </PropertyRow>

      <PropertyRow label="Updated">
        <div className="text-xs text-obsidianSecondaryText" data-testid="properties-updated">
          {formatTimestamp(note.updatedAt)}
        </div>
      </PropertyRow>
    </div>
  )
}

const PropertyRow = ({
  label, children,
}: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <div className="text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
      {label}
    </div>
    {children}
  </div>
)

export default PropertiesPanel
