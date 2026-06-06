# Competitive analysis

Compact market benchmark for noteser. Full sourcing lives in the research
notes; this is the distilled, decision-oriented version. Last refresh:
2026-06-06.

## Where noteser sits

noteser occupies a small, real niche: **100% browser-based + Git-as-storage +
transparent three-way merge**. The combination is uncommon — the only direct
head-to-head is NotesHub. Everything else is browser-but-not-git (StackEdit,
HackMD), git-but-not-browser (GitJournal, Obsidian + git plugin, Foam in VS
Code), or self-hosted-server-not-git (SilverBullet, Flatnotes, CodiMD).

**The real moat is the merge UX, not "git."** Git-as-storage is common.
VS Code-style per-hunk three-way merge (accept yours / theirs / both), keyed on
the last-pushed SHA per file, is not — and conflict handling is the single
most-requested improvement in the Obsidian-git community
([obsidian-git #803](https://github.com/Vinzent03/obsidian-git/issues/803)).
Second pillar: **Obsidian Tasks compatibility** (`- [ ]` + `✅ YYYY-MM-DD`,
live `tasks` query blocks). No browser/git rival pairs both.

## Closest competitors

| Tool | Storage | Browser? | Why it matters |
|---|---|---|---|
| **NotesHub** | GitHub / generic git / FS | Yes + native apps | The single closest rival. $3.99 one-time. Has offline, Kanban, whiteboard, Mermaid/LaTeX. Its conflict resolution is *opaque "automatic"* — noteser's transparent per-hunk merge is the edge. |
| **SilverBullet** | Files on your server | PWA (self-host) | Programmable (Lua), offline PWA. Needs a server; no git-as-storage, no merge UX. |
| **GitJournal** | Any git over SSH | Mobile-only | Owns mobile-git. A mobile-weak noteser loses to it on phones. |
| **StackEdit** | GitHub/Drive/Dropbox | Yes | Closest "browser + GitHub" precedent, but a single-document editor, not a vault/PKM. |
| **Obsidian** | Local files | **No official web** | The gravity well. noteser's core wedge is exactly Obsidian's most persistent gap: no browser version. Shipped Bases, official Web Clipper, Canvas, and AI in 2025. |

Disaffected-user pools worth targeting: **Logseq** (multi-year DB-migration
limbo, reports of data loss), **Notion** (restrictive offline + lock-in).

## Gaps vs the field (priority-ordered)

| Gap | Priority | Evidence |
|---|---|---|
| Offline-first / IndexedDB cache (PWA) | **High** | Every serious rival has it. Also de-risks GitHub rate limits. The "anywhere" pitch is fragile without it. |
| Mobile-grade responsive UI / installable PWA | **High** | "Browser anywhere" is hollow on a phone today. |
| AI: chat / RAG over the vault | **High** | The defining 2025-26 trend; Smart Connections has ~786K downloads. noteser has no AI story. |
| Graph view + backlinks / unlinked-mentions panel | **High** | The single most-expected PKM feature; absence reads as "not a real PKM." |
| GitHub rate-limit hardening (ETags / GraphQL / batching) | Med-High | 5,000 req/hr authenticated + secondary limits; large vaults will hit it. |
| Frontmatter/properties UI + lightweight DB/table views | Med-High | Obsidian Bases reset expectations in 2025; stay file-compatible. |
| Web clipper (browser extension) | Med | Pairs naturally with git storage (clip → commit). |
| Import from Obsidian / Notion / Logseq export | Med | Lowers switching cost from exactly the disaffected pools above. |
| Large-vault search/perf pass (beyond Fuse.js) | Med | Quality/speed degrade at thousands of notes. |
| Canvas / whiteboard | Low-Med | Increasingly expected; NotesHub bundles it. |

## Differentiation & risks

**Differentiated:** browser + GitHub-as-storage + *transparent* merge (only
NotesHub also occupies this, with worse merge UX); zero infrastructure (just a
repo you already trust); Obsidian Tasks interop (ride the ecosystem, don't
fight it).

**Risks:**
- **No offline = fragility at the worst moment** — the exact axis where
  Joplin/Notion get hammered.
- **GitHub API rate limits** on large-vault recursive tree + per-blob reads.
- **Muddy "local-first" positioning** — data lives in GitHub (a third party),
  not on-device-first or E2E by default. Against Anytype/Standard
  Notes/Notesnook this is a weak *privacy* story. **Position on ownership +
  version control + portability, not privacy.**
- **Breadth is a losing game** vs NotesHub/Obsidian. Double down on the
  merge + tasks + interop wedge.

## Top recommendations

1. Offline-first IndexedDB cache + installable PWA (fixes the biggest
   structural weakness and de-risks rate limits).
2. GitHub rate-limit hardening (ETags/conditional requests, batched reads).
3. AI "chat with your notes" (RAG, bring-your-own-key — fits the zero-infra ethos).
4. Graph view + backlinks panel.
5. Lead marketing/onboarding with the merge UX — it is the proven, defensible win.
6. Frontmatter/properties UI + Bases-compatible table views.
7. Import from Obsidian/Notion/Logseq; web clipper for capture inflow.

These are tracked as actionable, agent-pickup-ready GitHub issues
(noteser #68–#79): offline/PWA (#68), rate-limit hardening (#69), AI RAG
(#70), graph view + backlinks (#71), properties UI + Bases views (#72),
imports (#73), web clipper (#74), positioning (#75), plus the tech-debt
items: split SettingsModal (#76), split githubSync (#77), accessibility
pass (#78), Zustand selector/perf audit (#79).
