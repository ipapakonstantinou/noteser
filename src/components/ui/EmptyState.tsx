'use client'

import { type ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export const EmptyState = ({
  icon,
  title,
  description,
  action
}: EmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && (
        <div className="text-obsidianSecondaryText mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-obsidianText mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-obsidianSecondaryText max-w-sm mb-4">
          {description}
        </p>
      )}
      {action}
    </div>
  )
}

export default EmptyState
