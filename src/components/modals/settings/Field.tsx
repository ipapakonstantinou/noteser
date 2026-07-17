import React from 'react'

export const Field = ({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1 min-w-0">
      <div className="text-obsidianText text-sm">{label}</div>
      <div className="text-obsidianSecondaryText text-xs mt-0.5">{description}</div>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)
