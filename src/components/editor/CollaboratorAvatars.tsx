'use client'

import { useState } from 'react'
import type { Presence } from '@/types'

interface CollaboratorAvatarsProps {
  users: Presence[]
  maxVisible?: number
}

export const CollaboratorAvatars = ({
  users,
  maxVisible = 3
}: CollaboratorAvatarsProps) => {
  const [showTooltip, setShowTooltip] = useState(false)

  const visibleUsers = users.slice(0, maxVisible)
  const hiddenCount = users.length - maxVisible

  if (users.length === 0) return null

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex -space-x-2">
        {visibleUsers.map((user, index) => (
          <div
            key={user.oderId}
            className="relative w-7 h-7 rounded-full border-2 border-obsidianBlack flex items-center justify-center text-xs font-medium text-white"
            style={{
              backgroundColor: user.color,
              zIndex: visibleUsers.length - index
            }}
            title={user.name}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        ))}
        {hiddenCount > 0 && (
          <div
            className="relative w-7 h-7 rounded-full border-2 border-obsidianBlack bg-obsidianDarkGray flex items-center justify-center text-xs font-medium text-obsidianText"
            style={{ zIndex: 0 }}
          >
            +{hiddenCount}
          </div>
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full mt-2 right-0 bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian p-2 min-w-[150px] z-50">
          <div className="text-xs font-medium text-obsidianSecondaryText mb-2">
            Collaborators ({users.length})
          </div>
          <div className="space-y-1">
            {users.map(user => (
              <div key={user.oderId} className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white"
                  style={{ backgroundColor: user.color }}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-obsidianText truncate">
                  {user.name}
                </span>
                {user.cursor && (
                  <span className="ml-auto text-[10px] text-obsidianSecondaryText">
                    editing
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default CollaboratorAvatars
