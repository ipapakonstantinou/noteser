// Starter-vault catalog for the first-run onboarding modal. Each vault
// is a flat list of folders + notes that gets seeded into the stores
// when the user picks one. The structures are intentionally small (3–7
// notes each) — they're a starting point, not a finished workflow.
//
// Researcher's note: Obsidian's blank-canvas problem is a documented
// churn driver. Even a tiny starter that shows the user where to put
// things converts dramatically better than the empty state.

export interface StarterFolderSpec {
  /** Path segments. ['Notes', 'Daily'] becomes Notes → Daily. */
  path: string[]
}

export interface StarterNoteSpec {
  /** Path of the parent folder, or [] for root. */
  folderPath: string[]
  title: string
  content: string
}

export interface StarterVault {
  id: 'zettelkasten' | 'daily-system' | 'project-tracker' | 'research'
  label: string
  description: string
  /** Short pitch shown beneath the title on the picker card. */
  tagline: string
  folders: StarterFolderSpec[]
  notes: StarterNoteSpec[]
}

const ZETTELKASTEN: StarterVault = {
  id: 'zettelkasten',
  label: 'Zettelkasten',
  description: 'Atomic notes linked together. Niklas Luhmann\'s "second brain" system.',
  tagline: 'Atomic notes · bidirectional links',
  folders: [
    { path: ['Inbox'] },
    { path: ['Notes'] },
    { path: ['Notes', 'Concepts'] },
    { path: ['Notes', 'Sources'] },
  ],
  notes: [
    {
      folderPath: [],
      title: 'README',
      content: `# Zettelkasten starter

Welcome to your **Zettelkasten** — Niklas Luhmann's note system.

The idea: every note captures ONE atomic thought. Notes link to each other to form a web you can mine for ideas later.

## Workflow
1. Capture raw thoughts in **Inbox** (don't worry about polish).
2. Promote useful ones to **Notes/Concepts** — give each note a single clear idea + link to related notes via [[Wikilinks]].
3. Capture source quotes in **Notes/Sources** so claims have a backing reference.

Try [[Concept · Atomic notes]] to see a fleshed-out example.
`,
    },
    {
      folderPath: ['Notes', 'Concepts'],
      title: 'Concept · Atomic notes',
      content: `# Atomic notes

One idea per note. The atomic-note principle is why a Zettelkasten works.

- Easier to link (small targets, focused meaning).
- Easier to compose (combine atoms into longer pieces later).
- Easier to revisit (each note has ONE thing to remember).

Related: [[Concept · Bidirectional linking]]

#zettelkasten
`,
    },
    {
      folderPath: ['Notes', 'Concepts'],
      title: 'Concept · Bidirectional linking',
      content: `# Bidirectional linking

A link from A → B implicitly creates a backlink B → A in your knowledge graph. The Backlinks sidebar shows you everything that points HERE.

This is the difference between a folder hierarchy (rigid) and a Zettelkasten (web-shaped).

Try: open [[Concept · Atomic notes]] then check the Backlinks panel.

#zettelkasten
`,
    },
    {
      folderPath: ['Notes', 'Sources'],
      title: 'Source · How to Take Smart Notes (Ahrens)',
      content: `# How to Take Smart Notes — Sönke Ahrens

> The slip-box is not a personal library. It's a thinking partner.

Core insight: notes you re-write in your own words stick. Quotes alone don't.

Linked from: [[Concept · Atomic notes]]
`,
    },
    {
      folderPath: ['Inbox'],
      title: 'Inbox · ideas to triage',
      content: `# Inbox

Drop raw thoughts here. Triage weekly.

- [ ] First raw idea
- [ ] Quote I want to remember
- [ ] Question to research
`,
    },
  ],
}

const DAILY_SYSTEM: StarterVault = {
  id: 'daily-system',
  label: 'Daily Notes system',
  description: 'Daily journal + weekly + monthly review. Inbox-as-a-day.',
  tagline: 'Daily · Weekly · Monthly review',
  folders: [
    { path: ['Notes'] },
    { path: ['Notes', 'Daily'] },
    { path: ['Notes', 'Weekly'] },
    { path: ['Notes', 'Monthly'] },
  ],
  notes: [
    {
      folderPath: [],
      title: 'README',
      content: `# Daily Notes system

Your inbox is the day. Every morning open today's daily note (Command Palette → "Open today's note"). Capture everything there.

## Cadence
- **Daily** (Notes/Daily): tasks, meeting notes, random thoughts.
- **Weekly** (Notes/Weekly): review last week, plan next. "Open this week" in the palette.
- **Monthly** (Notes/Monthly): bigger-picture themes. "Open this month".

Tasks rolled into a daily note carry forward — the Tasks query block aggregates open ones across every note.

Try the example: [[2026-05-20]]
`,
    },
    {
      folderPath: ['Notes', 'Daily'],
      title: '2026-05-20',
      content: `# 2026-05-20

## Today
- [ ] Read mail
- [ ] Finish daily-notes example 📅 2026-05-20

## Notes
A scratchpad for everything that doesn't have a home yet.

## Highlights
What went well today?

`,
    },
    {
      folderPath: ['Notes', 'Weekly'],
      title: '2026-21',
      content: `# Week 21 · 2026

## Last week
- [ ] What did I get done?
- [ ] What didn't I finish?

## This week
- [ ] Top 3 priorities

## Open from daily notes
\`\`\`tasks
not done
path includes Notes/Daily
group by status
\`\`\`
`,
    },
  ],
}

const PROJECT_TRACKER: StarterVault = {
  id: 'project-tracker',
  label: 'Project tracker',
  description: 'One folder per project. Tasks + status + dashboard.',
  tagline: 'Per-project notes + Bases dashboard',
  folders: [
    { path: ['Projects'] },
    { path: ['Projects', 'Example Project'] },
  ],
  notes: [
    {
      folderPath: [],
      title: 'README',
      content: `# Project tracker

Each project gets its own folder under \`Projects/\`. The README of each project tracks status + open tasks. The top-level [[Dashboard]] note shows every project at a glance via a Bases query.

To add a project:
1. Right-click \`Projects\` → New folder → name it.
2. Inside it, create a README with frontmatter \`status: active\`.
3. The dashboard picks it up automatically.
`,
    },
    {
      folderPath: [],
      title: 'Dashboard',
      content: `# Project dashboard

Pulls every README under \`Projects/\` and shows status + last modified.

\`\`\`bases
from Projects
where property kind=project
columns: title, status, modified
sort modified desc
\`\`\`

Open tasks across all projects:

\`\`\`tasks
not done
path includes Projects/
group by filename
\`\`\`
`,
    },
    {
      folderPath: ['Projects', 'Example Project'],
      title: 'README',
      content: `---
kind: project
status: active
owner: me
---

# Example project

Brief: replace this paragraph with what the project actually is.

## Open
- [ ] First milestone task 📅 2026-06-01 ⏫
- [ ] Second milestone task

## Done
- [x] Set up the project folder ✅ 2026-05-20
`,
    },
  ],
}

const RESEARCH: StarterVault = {
  id: 'research',
  label: 'Research vault',
  description: 'Literature notes + topics + reading list.',
  tagline: 'Papers · topics · reading queue',
  folders: [
    { path: ['Literature'] },
    { path: ['Topics'] },
    { path: ['Reading list'] },
  ],
  notes: [
    {
      folderPath: [],
      title: 'README',
      content: `# Research vault

A lightweight setup for capturing what you read + connecting it to topics you care about.

## Where things live
- **Literature** — one note per paper, book, or article. Title = author + year.
- **Topics** — concept notes you keep building over time. Link literature notes here.
- **Reading list** — the queue. Tick items off as you finish them.

Open the Backlinks panel on any Topics note to see every paper that cited it.
`,
    },
    {
      folderPath: ['Reading list'],
      title: 'Queue',
      content: `# Reading queue

- [ ] Paper to read 📅 2026-06-01
- [ ] Book chapter
- [ ] Blog post
- [x] Already read ✅ 2026-05-20

\`\`\`tasks
not done
path includes Reading list
\`\`\`
`,
    },
    {
      folderPath: ['Literature'],
      title: 'Ahrens 2017 · How to take smart notes',
      content: `---
authors: ["Sönke Ahrens"]
year: 2017
type: book
tags: [zettelkasten, knowledge-management]
---

# Ahrens 2017 — How to take smart notes

Notes:

- Atomic + linked notes outperform highlighting.
- Writing IS thinking. The slip-box forces you to think.

Topics: [[Knowledge management]]
`,
    },
    {
      folderPath: ['Topics'],
      title: 'Knowledge management',
      content: `# Knowledge management

Tools + workflows for organising what you know.

Related literature:
- [[Ahrens 2017 · How to take smart notes]]
`,
    },
  ],
}

export const STARTER_VAULTS: readonly StarterVault[] = [
  ZETTELKASTEN,
  DAILY_SYSTEM,
  PROJECT_TRACKER,
  RESEARCH,
]

// Apply a vault to the live stores. Pure-ish — caller passes in the
// store actions so this stays unit-testable.
export interface SeedDeps {
  ensureFolderPath: (segments: string[]) => string | null
  addNote: (input: { title: string; folderId: string | null; content: string }) => { id: string }
}

// Apply a starter vault. Folders are materialised via ensureFolderPath so
// the existing sanitization logic runs; notes are added in declaration
// order so the workspace lands on the README first (we open the first
// created note after seeding, in the modal handler).
export function seedStarterVault(vault: StarterVault, deps: SeedDeps): string | null {
  // 1. Materialise folders. ensureFolderPath is idempotent.
  for (const f of vault.folders) {
    deps.ensureFolderPath(f.path)
  }
  // 2. Add notes. Track the first id so the caller can open it.
  let firstNoteId: string | null = null
  for (const note of vault.notes) {
    const folderId = note.folderPath.length === 0
      ? null
      : deps.ensureFolderPath(note.folderPath)
    const created = deps.addNote({
      title: note.title,
      folderId,
      content: note.content,
    })
    if (firstNoteId == null) firstNoteId = created.id
  }
  return firstNoteId
}
