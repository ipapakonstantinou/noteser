'use client'

import { useEffect, useCallback, type ReactNode } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  /**
   * When true, the body slot does NOT add padding or scroll. Use for
   * children that manage their own scroll containers (e.g. the
   * 2-pane Settings layout where each pane scrolls independently).
   */
  bodyless?: boolean
  showCloseButton?: boolean
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  bodyless = false,
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
    xl: 'max-w-xl',
    '2xl': 'max-w-3xl',
    '3xl': 'max-w-5xl',
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
          sections). role="dialog" + aria-modal=true so screen readers
          announce noteser modals correctly. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`relative w-full ${sizeClasses[size]} mx-4 bg-obsidianGray rounded-lg shadow-obsidian border border-obsidianBorder flex flex-col max-h-[90vh]`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-obsidianBorder flex-shrink-0">
            {title && (
              <h2 id="modal-title" className="text-lg font-medium text-obsidianText">{title}</h2>
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

        {/* Body — by default scrolls when content exceeds modal height.
            With `bodyless`, the caller takes over layout entirely (used
            for the 2-pane Settings layout where each pane scrolls
            independently). */}
        {bodyless
          ? <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
          : <div className="p-4 overflow-y-auto flex-1 min-h-0">{children}</div>}
      </div>
    </div>
  )
}

export default Modal
