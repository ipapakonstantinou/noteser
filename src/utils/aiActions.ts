// Note-level AI actions (z0e6).
//
// Each action runs a single round-trip via aiClient.runPrompt with a
// purpose-specific system prompt. The note's full content is passed as
// the user message. Results land in the shared AIResultModal where the
// user picks how to apply them.
//
// Selection-aware actions (rewrite-the-selected-paragraph etc.) would
// require pulling the current CodeMirror selection out of the editor —
// out of scope for v1. The whole-note variant covers ~all the
// real-world use cases we tested.

import type { Note } from '@/types'

export type AIActionId =
  | 'summarize'
  | 'extractTasks'
  | 'suggestTags'
  | 'rewriteClarity'
  | 'translate'

export interface AIAction {
  id: AIActionId
  label: string
  description: string
  systemPrompt: string
  // Build the user-side prompt. `extra` carries action-specific input
  // collected ahead of time (target language for translate, etc.).
  buildUserMessage: (note: Note, extra?: string) => string
  // True when the action requires extra input before it can run. The
  // UI prompts for it once (a simple modal text input).
  needsExtraInput?: boolean
  extraInputLabel?: string
  extraInputPlaceholder?: string
  // 'compare' shows a side-by-side; 'output' is a single text panel.
  display: 'compare' | 'output'
}

// Each prompt is intentionally terse: every extra word in the system
// prompt eats into the user's quota. The result must be markdown so
// it round-trips into a noteser note cleanly.
const SYS_BASE = 'You are a helpful writing assistant embedded in a markdown notes app called noteser. Reply with markdown only. No preamble, no closing remarks, no fenced code wrapping the answer.'

export const AI_ACTIONS: readonly AIAction[] = [
  {
    id: 'summarize',
    label: 'Summarize note',
    description: 'A concise 3-5 sentence summary of the note.',
    systemPrompt: `${SYS_BASE} Summarize the note in 3-5 short sentences. Capture the main points only — do not invent details. Return plain prose, no headings.`,
    buildUserMessage: (note) => `Summarize this note:\n\n${noteBody(note)}`,
    display: 'output',
  },
  {
    id: 'extractTasks',
    label: 'Extract tasks',
    description: 'Pulls actionable items as a markdown checklist.',
    systemPrompt: `${SYS_BASE} Extract every actionable item from the note as a markdown task list. Use the GFM checkbox syntax \`- [ ] task\`. One task per line. Be literal — only include items that are clearly tasks; do not invent any. If there are no tasks, reply with a single line: "No tasks found."`,
    buildUserMessage: (note) => `Extract tasks from this note:\n\n${noteBody(note)}`,
    display: 'output',
  },
  {
    id: 'suggestTags',
    label: 'Suggest tags',
    description: 'Generates 3-7 inline #tags that match the note.',
    systemPrompt: `${SYS_BASE} Suggest 3 to 7 tags that capture the note's topics. Reply with the tags on a single line, separated by spaces, each prefixed with #. No quotes, no explanation. Examples: "#meeting #q3-planning #budget". Lowercase, hyphenate multi-word tags.`,
    buildUserMessage: (note) => `Suggest tags for this note:\n\n${noteBody(note)}`,
    display: 'output',
  },
  {
    id: 'rewriteClarity',
    label: 'Rewrite for clarity',
    description: "Rewrites the note's prose to be clearer and more concise without changing the meaning.",
    systemPrompt: `${SYS_BASE} Rewrite the note for clarity and concision. Preserve every fact, list item, and code block — do not change technical content or meaning. Keep the markdown structure (headings, lists, links). Return the full rewritten note.`,
    buildUserMessage: (note) => `Rewrite this note for clarity:\n\n${noteBody(note)}`,
    display: 'compare',
  },
  {
    id: 'translate',
    label: 'Translate',
    description: "Translates the note's prose into the target language.",
    systemPrompt: `${SYS_BASE} Translate the note into the requested language. Preserve markdown structure (headings, lists, links, code blocks). Do not translate code blocks, file paths, or technical identifiers. Return the full translated note.`,
    buildUserMessage: (note, target) => `Translate this note into ${target || 'English'}:\n\n${noteBody(note)}`,
    needsExtraInput: true,
    extraInputLabel: 'Target language',
    extraInputPlaceholder: 'e.g. Spanish, French, Japanese',
    display: 'compare',
  },
]

// Lookup by id. Returns undefined for unknown ids so the caller can
// noop a stale command-palette invocation gracefully.
export function getAIAction(id: string): AIAction | undefined {
  return AI_ACTIONS.find(a => a.id === id)
}

// The note body sent to the model is just `content`. Title isn't
// included automatically — for most actions the title is duplicated
// in the body, and skipping it keeps the prompt small.
function noteBody(note: Note): string {
  return (note.content ?? '').trim()
}
