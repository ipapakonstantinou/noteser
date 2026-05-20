// Dispatcher for note-level AI actions (z0e6).
//
// Used by both the right-click context menu and the command palette so
// the run-action plumbing has exactly one home. Resolves the action,
// reads the note, calls aiClient.runPrompt, then opens AIResultModal
// with the result. Errors surface via alert() — keeping the UX minimal
// for v1; a toast system is a separate concern.

import { useNoteStore, useUIStore } from '@/stores'
import { runPrompt, AIClientError } from './aiClient'
import { getAIAction, type AIActionId } from './aiActions'

export interface RunNoteAIActionInput {
  actionId: AIActionId
  noteId: string
  // Pre-collected extra input for actions that need it (e.g. target
  // language for translate). When the action declares needsExtraInput
  // and no value is passed, the caller is expected to have already
  // prompted; we just default to an empty string.
  extraInput?: string
}

// Tracks an in-flight action so two concurrent invocations don't
// stack modals (the user double-clicked the menu, etc.). Per-note +
// per-action key so different actions on different notes can still
// run in parallel.
const inflight = new Set<string>()

export async function runNoteAIAction({
  actionId, noteId, extraInput,
}: RunNoteAIActionInput): Promise<void> {
  const key = `${noteId}::${actionId}`
  if (inflight.has(key)) return
  inflight.add(key)

  const action = getAIAction(actionId)
  if (!action) {
    inflight.delete(key)
    return
  }

  const note = useNoteStore.getState().getNoteById(noteId)
  if (!note) {
    inflight.delete(key)
    return
  }

  const ui = useUIStore.getState()

  // Show a transient running state via the modal. The modal renders an
  // "AI result" placeholder until the response lands, then re-renders
  // with the real text. Re-using the same modal means the user sees a
  // consistent target while the request is in flight.
  ui.openModal({
    type: 'ai-result',
    data: {
      actionId: action.id,
      actionLabel: `${action.label} — running…`,
      display: action.display,
      noteId: note.id,
      originalContent: note.content ?? '',
      resultText: 'Working…',
    },
  })

  try {
    const userMessage = action.buildUserMessage(note, extraInput)
    const result = await runPrompt({
      system: action.systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    // Only refresh the modal if the user hasn't navigated away. If
    // they closed it / opened a different modal, drop the result —
    // popping it back unexpectedly would be confusing.
    const stillOpen = useUIStore.getState().modal.type === 'ai-result'
      && (useUIStore.getState().modal.data as { noteId?: string } | undefined)?.noteId === noteId
    if (stillOpen) {
      useUIStore.getState().openModal({
        type: 'ai-result',
        data: {
          actionId: action.id,
          actionLabel: action.label,
          display: action.display,
          noteId: note.id,
          originalContent: note.content ?? '',
          resultText: result,
        },
      })
    }
  } catch (err) {
    const message = err instanceof AIClientError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'AI action failed'
    // Close the running modal before surfacing the error so the alert
    // doesn't render on top of it.
    if (useUIStore.getState().modal.type === 'ai-result') {
      useUIStore.getState().closeModal()
    }
    alert(message)
  } finally {
    inflight.delete(key)
  }
}
