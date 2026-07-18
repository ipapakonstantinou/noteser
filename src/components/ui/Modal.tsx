'use client'

import { useEffect, useCallback, useRef, type ReactNode } from 'react'
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

// CSS selector for everything we consider focusable inside the modal —
// the inline focus trap uses this to find the first/last focusable so
// Tab / Shift+Tab can wrap between the two ends without escaping. It's
// the same baseline that focus-trap / focus-trap-react use; we keep an
// inline version because the dep isn't installed and the requirements
// here are minimal (no nested traps, no portals).
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const getFocusable = (root: HTMLElement): HTMLElement[] => {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1)
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

  // Refs for the focus-trap dance:
  //   - `dialogRef` points at the actual modal panel so we can query its
  //     focusable children + decide whether a Tab key landed inside.
  //   - `previouslyFocusedRef` snapshots the element that had focus
  //     before the modal opened so we can return focus there on close
  //     (matches every standards-compliant dialog implementation, and
  //     prevents losing keyboard context when a quick modal closes).
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

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

  // Focus management. On open: remember the trigger element, then focus
  // the first focusable inside the modal (falling back to the dialog
  // root if none exists so screen readers still get an announcement).
  // On close: restore focus to whatever was focused before the modal
  // opened. The cleanup runs in two cases — modal unmounts naturally
  // OR `isOpen` flips false — so a programmatic close (Esc, backdrop
  // click, action button) still lands the user back on their trigger.
  useEffect(() => {
    if (!isOpen) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    // Defer focus to the next frame — the dialog content may render its
    // own children that mount after the initial paint (e.g. lazy lists
    // inside Settings). Without this, getFocusable() can return an
    // empty list because the children haven't committed yet.
    const id = requestAnimationFrame(() => {
      const root = dialogRef.current
      if (!root) return
      const focusables = getFocusable(root)
      const first = focusables[0]
      if (first) first.focus()
      else root.focus()
    })
    return () => {
      cancelAnimationFrame(id)
      // Restore focus, but only if the previously focused element is
      // still in the DOM (otherwise blur to body — better than throwing).
      const prev = previouslyFocusedRef.current
      if (prev && document.contains(prev)) {
        prev.focus()
      }
    }
  }, [isOpen])

  // Tab key trap. Wrap focus between the first and last focusable
  // element inside the dialog so the user can never tab out into the
  // background (which would also break the screen reader's modal
  // context). We listen at the document level + filter on Tab + check
  // the active element is inside the dialog; this also catches the case
  // where focus has somehow escaped the modal entirely and snaps it back.
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = getFocusable(root)
      if (focusables.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      // If focus is somehow OUTSIDE the dialog (escaped via mouse to a
      // background element behind the modal — rare but possible if the
      // backdrop loses pointer-events), snap it back to the first input.
      if (!active || !root.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

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
        className="absolute inset-0 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Modal content. Capped at the viewport height with an internal
          flex column so the header stays pinned and the body scrolls
          when its content overflows (e.g. the Settings modal with many
          sections). role="dialog" + aria-modal=true so screen readers
          announce noteser modals correctly. tabIndex=-1 lets the modal
          root itself receive focus as a last-ditch fallback when the
          dialog has no focusable children. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        tabIndex={-1}
        className={`relative w-full ${sizeClasses[size]} mx-4 bg-obsidianGray rounded-lg shadow-obsidian border border-obsidianBorder flex flex-col max-h-[90dvh] focus:outline-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-obsidianBorder shrink-0">
            {title && (
              <h2 id="modal-title" className="text-lg font-medium text-obsidianText">{title}</h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 rounded-sm hover:bg-obsidianHighlight transition-colors"
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
