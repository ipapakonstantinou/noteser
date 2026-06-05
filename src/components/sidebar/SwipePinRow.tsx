'use client'

import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useSwipePin } from '@/hooks'

// Mobile drag-to-pin shell. Renders children inside a horizontally-
// translatable row with a pin icon revealing under it. Activates only
// when `enabled` is true (mobile, non-trash, non-deleted). When
// disabled, behaves as a transparent passthrough — no listeners, no
// transform, no DOM cost beyond the wrapping <div>.
//
// Defined at module scope so React keeps a stable component identity
// across parent renders; that is what keeps the hook state alive
// between pointer events. The previous attempt declared this inline in
// FolderTree which would have remounted on every parent re-render and
// dropped state mid-gesture.
export function SwipePinRow({
  enabled,
  onPinToggle,
  children,
}: {
  enabled: boolean
  onPinToggle: () => void
  children: React.ReactNode
}) {
  const { bind, offset } = useSwipePin({
    enabled,
    onCommit: onPinToggle,
  })

  if (!enabled) {
    return <>{children}</>
  }

  const showAction = Math.abs(offset) > 6
  const willCommit = Math.abs(offset) >= 60
  return (
    <div className="relative" data-testid="swipe-pin-row">
      {showAction && (
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center px-3 ${
            offset > 0 ? 'justify-start text-yellow-500' : 'justify-end text-obsidianSecondaryText'
          } ${willCommit ? 'opacity-100' : 'opacity-60'}`}
          aria-hidden="true"
        >
          <StarIconSolid className="w-4 h-4" />
        </div>
      )}
      <div
        {...bind}
        style={{
          transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
          touchAction: 'pan-y',
          backgroundColor: offset !== 0 ? 'var(--obsidian-gray, #242424)' : undefined,
        }}
        data-swipe-offset={offset}
      >
        {children}
      </div>
    </div>
  )
}
