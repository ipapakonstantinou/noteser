'use client'

import { useSettingsStore } from '@/stores'
import type { AIProvider } from '@/stores'
import { DEFAULT_AI_MODEL } from '@/stores/settingsStore'
import { Field, SettingsSelect, SettingsTextInput } from './settings'

// Settings sub-section: lets the user wire up their own Anthropic or
// OpenAI key + pick a default model. Everything is BYO key — the
// aiClient sends requests straight from the browser to the provider.
export const AISection = () => {
  const aiProvider = useSettingsStore(s => s.aiProvider)
  const aiApiKey = useSettingsStore(s => s.aiApiKey)
  const aiModel = useSettingsStore(s => s.aiModel)
  const setAiProvider = useSettingsStore(s => s.setAiProvider)
  const setAiApiKey = useSettingsStore(s => s.setAiApiKey)
  const setAiModel = useSettingsStore(s => s.setAiModel)

  // Show the default model for the active provider as a placeholder. When
  // provider is 'off' there's nothing useful to suggest, so we fall back
  // to a generic hint.
  const modelPlaceholder =
    aiProvider === 'off'
      ? 'model id (pick a provider first)'
      : DEFAULT_AI_MODEL[aiProvider]

  const isOff = aiProvider === 'off'

  return (
    <div className="space-y-3">
      <div className="text-xs text-obsidianSecondaryText leading-relaxed">
        Keys stay in your browser&apos;s localStorage — never sent anywhere
        except the provider&apos;s API.
      </div>

      <Field
        label="Provider"
        description="Which AI service to call. Off disables every AI feature."
      >
        <SettingsSelect<AIProvider>
          value={aiProvider}
          onChange={setAiProvider}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'anthropic', label: 'Anthropic Claude' },
            { value: 'openai', label: 'OpenAI' },
          ]}
        />
      </Field>

      <Field
        label="API key"
        description="Paste your provider key. Masked in this field; stored in localStorage."
      >
        <SettingsTextInput
          value={aiApiKey}
          onCommit={setAiApiKey}
          placeholder={isOff ? 'pick a provider first' : 'sk-…'}
          type="password"
          mono
        />
      </Field>

      <Field
        label="Model"
        description="Free-form model id. Leave the suggested default unless you need a specific snapshot."
      >
        <SettingsTextInput
          value={aiModel}
          onCommit={setAiModel}
          placeholder={modelPlaceholder}
          mono
        />
      </Field>
    </div>
  )
}

export default AISection
