'use client'

import { useUIStore, useNoteStore, useFolderStore } from '@/stores'
import { Modal } from '@/components/ui'
import { DEFAULT_TEMPLATES, type Template } from '@/types'
import { buildWeeklyReview } from '@/utils/weeklyReview'

export const TemplatesModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const createFromTemplate = useNoteStore(s => s.createFromTemplate)
  const notes = useNoteStore(s => s.notes)
  const activeFolderId = useFolderStore(s => s.activeFolderId)

  const isOpen = modal.type === 'template'

  const handleSelectTemplate = (template: Template) => {
    // The Weekly Review template is computed from current notes rather
    // than dropped in verbatim. Swap the static content out for the
    // dynamic body before creating the note. We override `name` too so
    // the new note has a date-stamped title (otherwise every Sunday's
    // review would have the same name and collide).
    if (template.id === 'weekly-review') {
      const now = new Date()
      const built = buildWeeklyReview(notes, now)
      const yyyyMmDd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      createFromTemplate(
        { ...template, name: `Weekly Review ${yyyyMmDd}`, content: built.body },
        activeFolderId,
      )
      closeModal()
      return
    }
    createFromTemplate(template, activeFolderId)
    closeModal()
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Create from Template" size="lg">
      <div className="grid grid-cols-2 gap-3">
        {DEFAULT_TEMPLATES.map(template => (
          <button
            key={template.id}
            onClick={() => handleSelectTemplate(template)}
            className="p-4 text-left rounded-lg border border-obsidianBorder hover:border-obsidianAccentPurple hover:bg-obsidianDarkGray transition-colors group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{template.icon}</span>
              <span className="font-medium text-obsidianText group-hover:text-obsidianAccentPurple">
                {template.name}
              </span>
            </div>
            <p className="text-sm text-obsidianSecondaryText">
              {template.description}
            </p>
          </button>
        ))}
      </div>
    </Modal>
  )
}

export default TemplatesModal
