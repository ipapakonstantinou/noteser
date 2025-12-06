'use client'

import { type ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  color?: string
  onRemove?: () => void
  className?: string
}

export const Badge = ({
  children,
  color = '#6b7280',
  onRemove,
  className = ''
}: BadgeProps) => {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${className}`}
      style={{ backgroundColor: color }}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-1 inline-flex items-center justify-center w-3 h-3 rounded-full hover:bg-white/20 transition-colors"
          aria-label="Remove"
        >
          <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 8 8">
            <path d="M1.41 0L0 1.41l2.59 2.59L0 6.59 1.41 8l2.59-2.59L6.59 8 8 6.59 5.41 4 8 1.41 6.59 0 4 2.59 1.41 0z" />
          </svg>
        </button>
      )}
    </span>
  )
}

export default Badge
