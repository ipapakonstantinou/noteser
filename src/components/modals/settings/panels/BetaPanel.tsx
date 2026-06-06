'use client'

import { useSettingsStore } from '@/stores'
import { FLAGS } from '@/utils/featureFlags'
import {
  Field,
  SettingsCheckbox,
} from '../index'
import { PanelHeading } from '../PanelHeading'

export function BetaPanel() {
  const betaEnabled = useSettingsStore(s => s.betaEnabled)
  const betaFlags = useSettingsStore(s => s.betaFlags)
  const setBetaEnabled = useSettingsStore(s => s.setBetaEnabled)
  const setBetaFlag = useSettingsStore(s => s.setBetaFlag)

  return (
    <div className="space-y-4" data-testid="settings-beta-panel">
      <PanelHeading>Beta features</PanelHeading>
      <p className="text-xs text-obsidianSecondaryText -mt-2">
        Opt into work-in-progress features. They may be buggy or removed.
        Bug reports for beta features are welcome via the About → Report a bug
        button.
      </p>
      <Field
        label="Enable beta features"
        description="Master switch. Individual flags below have no effect when this is off."
      >
        <SettingsCheckbox checked={betaEnabled} onChange={setBetaEnabled} />
      </Field>
      {betaEnabled && (
        <div className="space-y-3 pt-2 border-t border-obsidianBorder">
          {FLAGS.map(flag => (
            <Field
              key={flag.id}
              label={flag.label}
              description={flag.description}
            >
              <SettingsCheckbox
                checked={Boolean(betaFlags[flag.id])}
                onChange={(v) => setBetaFlag(flag.id, v)}
              />
            </Field>
          ))}
          {FLAGS.length === 0 && (
            <p className="text-sm text-obsidianSecondaryText italic">
              No experimental features available right now.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
