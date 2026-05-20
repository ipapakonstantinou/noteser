'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui'
import {
  useNoteStore,
  useFolderStore,
  useSettingsStore,
  useWorkspaceStore,
} from '@/stores'
import { STARTER_VAULTS, seedStarterVault, type StarterVault } from '@/utils/starterVaults'

interface OnboardingModalProps {
  isOpen: boolean
  onDismiss: () => void
}

// First-run modal — pick a starter vault or skip. Triggered from page.tsx
// when the store hydrates and there are zero notes AND onboardingShown
// is false.
export function OnboardingModal({ isOpen, onDismiss }: OnboardingModalProps) {
  const [picked, setPicked] = useState<StarterVault['id'] | null>(null)
  const setOnboardingShown = useSettingsStore(s => s.setOnboardingShown)

  const handlePick = (vault: StarterVault) => {
    setPicked(vault.id)
    // Defer the actual seeding until after render so the spinner state shows.
    setTimeout(() => {
      const firstId = seedStarterVault(vault, {
        ensureFolderPath: useFolderStore.getState().ensureFolderPath,
        addNote: useNoteStore.getState().addNote,
      })
      setOnboardingShown(true)
      if (firstId) {
        useWorkspaceStore.getState().openNote(firstId, { preview: false })
      }
      onDismiss()
    }, 50)
  }

  const handleSkip = () => {
    setOnboardingShown(true)
    onDismiss()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleSkip} title="Welcome to Noteser" size="2xl">
      <div className="space-y-4" data-testid="onboarding-modal">
        <p className="text-sm text-obsidianText">
          Pick a starter vault to get going, or skip and start with an empty workspace. You can always import/sync a real vault from GitHub later (Sidebar → GitHub view).
        </p>

        <div className="grid grid-cols-2 gap-3">
          {STARTER_VAULTS.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => handlePick(v)}
              disabled={picked != null}
              data-testid={`onboarding-vault-${v.id}`}
              className="text-left p-3 border border-obsidianBorder rounded-lg hover:border-obsidianAccentPurple/60 hover:bg-obsidianHighlight/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <div className="text-sm font-medium text-obsidianText">{v.label}</div>
              <div className="text-xs text-obsidianAccentPurple mt-0.5">{v.tagline}</div>
              <p className="text-xs text-obsidianSecondaryText mt-2 leading-snug">
                {v.description}
              </p>
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2">
          <p className="text-xs text-obsidianSecondaryText">
            Picking a vault creates a handful of example notes + folders. Nothing is sent anywhere.
          </p>
          <button
            type="button"
            onClick={handleSkip}
            data-testid="onboarding-skip"
            className="text-sm text-obsidianSecondaryText hover:text-obsidianText underline"
          >
            Skip — start empty
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default OnboardingModal
