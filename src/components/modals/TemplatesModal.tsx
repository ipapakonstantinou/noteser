'use client'

import { useUIStore, useNoteStore, useFolderStore } from '@/stores'
import { Modal } from '@/components/ui'
import { DEFAULT_TEMPLATES, type Template } from '@/types'

export const TemplatesModal = () => {
  const { modal, closeModal } = useUIStore()
  const { createFromTemplate } = useNoteStore()
  const { activeFolderId } = useFolderStore()

  const isOpen = modal.type === 'template'

  const handleSelectTemplate = (template: Template) => {
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
