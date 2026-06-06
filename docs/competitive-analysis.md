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
| **NotesHub** | GitHub / generic git / FS / iCloud | Yes + native apps everywhere | Single closest rival. $3.99 one-time. Offline, Kanban, whiteboard, Mermaid/LaTeX, real-time collab. Conflict resolution is *opaque "automatic"* — transparent per-hunk merge is the only durable edge. See `docs/research/competitors/noteshub.md`. |
| **SilverBullet** | Files on your server | PWA (self-host) | Programmable (Space Lua), Objects/Queries DSL, true offline PWA. Needs a server; no git-as-storage; no merge UX. Reference design for the properties/DB-views work (#72). See `silverbullet.md`. |
| **GitJournal** | Any git over SSH | Mobile-only | Owns mobile-git. Complementary, not overlapping — but a weak PWA cedes phones to it (#68). Reported "failed to save" / crashes argue for #69 retry + queued-state UI. See `gitjournal.md`. |
| **StackEdit / HackMD / CodiMD** | GitHub/Drive/Dropbox; or hosted DB | Yes | StackEdit is the closest "browser + GitHub" precedent (single-doc, no offline, opaque sync — stackedit #1176). HackMD/CodiMD are team real-time collab over a hosted DB. None is a vault/PKM. See `stackedit-hackmd.md`. |
| **Obsidian** | Local files | **No official web** | The gravity well. Core wedge is exactly Obsidian's persistent gap. Shipped Bases, official Web Clipper (with AI Interpreter), Canvas (JSON Canvas), Claude/AI Skills in 2025-26. obsidian-git #803 is the demand signal for noteser's merge UX. See `obsidian.md`. |
| **Logseq** | Local md/org + sync | Limited | Cautionary tale: DB-migration limbo since 2022, stalled development, data-loss reports. Disaffected-user pool addressable via a clean import (#73) + stability positioning (#75). See `logseq.md`. |
| **Privacy/E2E cluster** (Anytype, Standard Notes, Notesnook, Joplin) | E2E hosted / P2P / self-host | Varies | Defines the encrypted pole. Do not compete on privacy (#75). Joplin's "sync broke and lost data" thread *reinforces* the merge UX wedge. See `privacy-e2e-cluster.md`. |
| **Notion alternatives** (AFFiNE, SiYuan, Trilium) | CRDT / md+sidecars / SQLite | Mostly self-host | "DB-in-notes + blocks + graph" pole. SiYuan sets the bar for thousands-of-notes performance (#79); AFFiNE for canvas; Trilium warns against in-app scripting. See `notion-alternatives.md`. |

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

## Lessons surfaced by deeper research

Findings from the 2026-06-06 sweep of `docs/research/competitors/` that
were not in the original analysis. Each ties back to a priority or
backlog issue.

- **NotesHub still resolves conflicts opaquely.** The 2026 review of
  about.noteshub.app and the GitHub org found no sign of a transparent
  per-hunk merge UI. The wedge (#75) is intact; lead with it in copy.
- **Joplin's "sync that constantly broke" thread is a positive signal
  for noteser, not a warning.** It is direct evidence that
  trustworthy sync + merge is an unmet need at the file-storage tier,
  which is exactly the axis #69 (rate-limit / retry hardening) +
  per-hunk merge address.
- **SiYuan markets explicitly on thousands-of-notes performance.**
  This sets a concrete bar for #79: 5,000 notes load under a second,
  search under 200 ms, sync does not refetch the full tree (ETag from
  #69 + incremental Fuse.js index updates).
- **Obsidian Bases is now the de facto frontmatter-properties standard.**
  #72 must stay file-compatible with Bases' frontmatter shape; do not
  invent a parallel schema. This also opens the Obsidian-import path
  in #73 for free.
- **JSON Canvas (Obsidian) is the open canvas format to target.** If
  a canvas surface ever ships (low priority today), prefer JSON Canvas
  over a CRDT-shaped format. AFFiNE's edgeless canvas is not the
  interop target.
- **Kanban does not need a separate data model.** NotesHub bundles it
  as a feature, but a `kanban` view derived from `- [ ]` lines plus
  status tags maps onto existing Obsidian Tasks data — a cheap parity
  move that reinforces the tasks-interop wedge.
- **A "noteser + GitJournal" pairing is the right mobile story until
  the PWA lands.** GitJournal owns mobile-git; the messaging "use
  GitJournal on your phone, noteser in the browser, same repo" buys
  time on #68 without ceding the mobile narrative.
- **Standard Notes' "your data will outlive the app" framing maps
  cleanly onto noteser's pitch** ("the files are in your repo, a
  plain markdown editor can open them"). Reuse the longevity framing
  in #75 positioning copy without claiming E2E.
- **Trilium's in-app scripting is a cautionary tale for any
  programmability work.** Avoid a user-script runtime. A scoped
  templater is safer than a Space-Lua-style surface, and far easier
  to migrate later (relevant if #72 grows toward derived views).
- **The "browser anywhere" pitch reads as hollow without an
  installable PWA.** Every serious rival except StackEdit and the
  HackMD family has offline-first. #68 is the single highest-leverage
  unblocker; it also de-risks the GitHub rate-limit story (#69).

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
