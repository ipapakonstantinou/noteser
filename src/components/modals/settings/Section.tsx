import React from 'react'

export const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <h4 className="text-sm font-medium text-obsidianSecondaryText uppercase tracking-wide mb-3">
      {title}
    </h4>
    <div className="space-y-3">{children}</div>
  </div>
)
