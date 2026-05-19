'use client'

import { useEffect, useCallback, type ReactNode } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showCloseButton?: boolean
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true
}: ModalProps) => {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleEscape])

  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal content. Capped at the viewport height with an internal
          flex column so the header stays pinned and the body scrolls
          when its content overflows (e.g. the Settings modal with many
          sections). */}
      <div
        className={`relative w-full ${sizeClasses[size]} mx-4 bg-obsidianGray rounded-lg shadow-obsidian border border-obsidianBorder flex flex-col max-h-[90vh]`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-obsidianBorder flex-shrink-0">
            {title && (
              <h2 className="text-lg font-medium text-obsidianText">{title}</h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-obsidianHighlight transition-colors"
                aria-label="Close modal"
              >
                <XMarkIcon className="w-5 h-5 text-obsidianSecondaryText" />
              </button>
            )}
          </div>
        )}

        {/* Body — scrolls when content exceeds the modal height. */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}

export default Modal
