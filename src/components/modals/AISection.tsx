'use client'

import { useState } from 'react'
import { useSettingsStore, useNoteStore } from '@/stores'
import type { AIProvider } from '@/stores'
import { DEFAULT_AI_MODEL } from '@/stores/settingsStore'
import { Field, SettingsSelect, SettingsCheckbox, SettingsTextInput } from './settings'
import { indexAllNotes, clearAllEmbeddings, type IndexProgress } from '@/utils/embeddings'

// Settings sub-section: lets the user wire up their own Anthropic or
// OpenAI key + pick a default model. Everything is BYO key — the
// aiClient sends requests straight from the browser to the provider.
export const AISection = () => {
  const aiProvider = useSettingsStore(s => s.aiProvider)
  const aiApiKey = useSettingsStore(s => s.aiApiKey)
  const aiModel = useSettingsStore(s => s.aiModel)
  const aiEmbeddingsEnabled = useSettingsStore(s => s.aiEmbeddingsEnabled)
  const aiCommitMessages = useSettingsStore(s => s.aiCommitMessages)
  const setAiCommitMessages = useSettingsStore(s => s.setAiCommitMessages)
  const setAiProvider = useSettingsStore(s => s.setAiProvider)
  const setAiApiKey = useSettingsStore(s => s.setAiApiKey)
  const setAiModel = useSettingsStore(s => s.setAiModel)
  const setAiEmbeddingsEnabled = useSettingsStore(s => s.setAiEmbeddingsEnabled)

  // Bulk-index UI state. We don't track this in the store because it
  // only matters for the duration of the modal session.
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [indexResult, setIndexResult] = useState<{ indexed: number; skipped: number; errors: number } | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const indexing = indexProgress != null && indexProgress.done < indexProgress.total

  const handleIndexAll = async () => {
    setIndexError(null)
    setIndexResult(null)
    setIndexProgress({ done: 0, total: 0, currentTitle: '' })
    try {
      const allNotes = useNoteStore.getState().notes
      const result = await indexAllNotes(allNotes, p => setIndexProgress(p))
      setIndexResult(result)
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : 'Indexing failed.')
    } finally {
      // Mark progress complete even on error so the spinner stops.
      setIndexProgress(p => p ? { ...p, done: p.total } : null)
    }
  }

  const handleClearEmbeddings = async () => {
    if (!confirm('Delete every cached embedding? You can rebuild them with "Index all notes" — this will re-call the embeddings API on the next index.')) return
    await clearAllEmbeddings()
    setIndexResult(null)
    setIndexError(null)
  }

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

      {/* Embeddings opt-in (a1f7). Visible regardless of provider so
          users discover it; the "Related notes" panel and the bulk-
          index button do the actual gating. */}
      <div className="pt-3 mt-3 border-t border-obsidianBorder space-y-3">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          Embeddings
        </div>
        <Field
          label="Enable AI embeddings"
          description="Index notes via OpenAI text-embedding-3-small to power the Related notes panel. Requires an OpenAI key. Cheap (~$0.02 per million tokens) but not free."
        >
          <SettingsCheckbox
            checked={aiEmbeddingsEnabled}
            onChange={setAiEmbeddingsEnabled}
          />
        </Field>
        {aiEmbeddingsEnabled && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleIndexAll}
                disabled={indexing || aiProvider !== 'openai'}
                className="px-3 py-1.5 text-sm rounded bg-obsidianAccentPurple text-white hover:opacity-90 disabled:opacity-50"
                data-testid="ai-index-all"
              >
                {indexing ? 'Indexing…' : 'Index all notes'}
              </button>
              <button
                type="button"
                onClick={handleClearEmbeddings}
                disabled={indexing}
                className="px-3 py-1.5 text-sm rounded border border-obsidianBorder text-obsidianText hover:bg-obsidianDarkGray disabled:opacity-50"
              >
                Clear embeddings
              </button>
            </div>
            {aiProvider !== 'openai' && (
              <p className="text-xs text-yellow-400">
                Switch the provider to OpenAI above to enable indexing.
              </p>
            )}
            {indexProgress && indexProgress.total > 0 && (
              <p className="text-xs text-obsidianSecondaryText">
                {indexProgress.done} / {indexProgress.total}
                {indexProgress.currentTitle && (
                  <span className="ml-2 italic">({indexProgress.currentTitle})</span>
                )}
              </p>
            )}
            {indexResult && (
              <p className="text-xs text-obsidianSecondaryText">
                Indexed {indexResult.indexed}, skipped {indexResult.skipped}{indexResult.errors > 0 ? `, errors ${indexResult.errors}` : ''}.
              </p>
            )}
            {indexError && (
              <p className="text-xs text-red-400">{indexError}</p>
            )}
          </div>
        )}
      </div>

      {/* AI commit messages. Independent of embeddings — uses the
          chat provider, not the embeddings one. Visible regardless of
          aiProvider so users discover the feature; falls back to the
          auto-generated message when AI is off or the call fails. */}
      <div className="pt-3 mt-3 border-t border-obsidianBorder space-y-3">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          Commit messages
        </div>
        <Field
          label="AI-drafted commit messages"
          description="When syncing, ask the model to draft a one-line commit message from the pending diff instead of the auto-generated 'Sync from Noteser (N changes)'. Uses the chat provider above; one small call per sync. Manual messages in the SCM input override this."
        >
          <SettingsCheckbox
            checked={aiCommitMessages}
            onChange={setAiCommitMessages}
          />
        </Field>
      </div>
    </div>
  )
}

export default AISection
