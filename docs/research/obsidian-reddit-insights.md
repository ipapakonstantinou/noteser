# Obsidian community research — Reddit, HN, Obsidian forum

Researcher pass on what Obsidian users on Reddit, Hacker News, and the Obsidian
forum love, complain about, and ask for most. Compiled 2026-05-19.

**TL;DR:** Sustained pain points cluster around three themes: no
browser/web access, steep setup complexity, and weak collaboration. Features
users will not give up are local-first markdown, bidirectional linking, and
a Dataview/Bases-style query layer. For a browser-first competitor like
Noteser, the structural advantage to play is removing the access-anywhere
problem, plus layering in a no-code database view and AI assistance on top.

---

## 1. Top 5 Features Users LOVE (lock-in drivers)

1. **Local-first plain Markdown files** — "avoiding vendor lock-in through
   markdown notes synced via git, dropbox, or syncthing" (HN, Jan 2024). The
   single reason power users reject Notion. Sustained.
2. **Bidirectional linking + backlinks panel** — "The killer feature of
   Obsidian was the wikilinks." Every Zettelkasten workflow depends on it.
3. **Dataview (now Bases)** — "the single most recommended plugin on the
   subreddit." Bases (launched 2025) is now called "a game-changer" for being
   the no-code successor. Community shift from Dataview to Bases is active
   and enthusiastic.
4. **Graph view** — Praised more for emotional/motivational value than
   analytical utility. "You feel like your brain is growing." The 3D graph
   plugin exists because people want more of this.
5. **Plugin ecosystem depth (Templater, Tasks, QuickAdd)** — Non-negotiable
   for serious users. The risk: "outdated and abandoned plugins that broke
   with new Obsidian versions" is a real churn driver.

## 2. Top 5 Missing Features / Complaints

1. **No web/browser version** — "there's no web version of Obsidian by
   default." XDA-Developers wrote in 2025: "This Obsidian alternative works
   inside a web browser, and I can't stop using it." Noteser's entire
   premise addresses this gap directly.
2. **Real-time collaboration is absent** — Obsidian Forum thread "Live team
   collaborative editing" open since 2021, still unresolved. Third-party
   plugins (Relay, Peerdraft) exist as workarounds.
3. **Mobile experience is poor** — 2026 community report: desktop 4.5/5,
   mobile 3.1/5. Sync doesn't update in background; core plugins need
   mobile-specific work.
4. **Steep onboarding / blank canvas problem** — "Obsidian only gives you
   an empty vault and a blank canvas with no guidance, no ready-to-use
   templates." Drives top-of-funnel churn.
5. **No native PDF annotation** — relevant to academic/research users.

## 3. Top 3 Must-Have Plugins (de-facto core features)

1. **Dataview / Bases** — Query your vault as a database; no-code table/card
   views of notes filtered by frontmatter properties.
2. **Templater** — Dynamic templates with JS execution, date variables,
   complex logic. Direct complement to Noteser's existing static Templates.
3. **Tasks** — Task tracking with due/scheduled dates, recurring rules,
   priority, cross-note queries. **Noteser already implements this syntax.**

## 4. Recurring Workflow Patterns

- **Daily Notes + Periodic Notes system** — Every power user has a daily
  note as their inbox. Weekly/monthly review notes are near-universal.
- **Zettelkasten / Second Brain** — Capture → process → link → revisit.
  Relies on backlinks, tags, and querying connected notes.
- **Project management inside the vault** — Tasks + Dataview/Bases creates
  Kanban-like boards and project dashboards. Deeply invested users.
- **AI-assisted note discovery and writing** — Smart Composer and Copilot
  have strong 2025 uptake. Pattern: ask a question across the whole vault,
  get an answer with citations to your own notes. Fastest-growing segment.

## 5. Mobile / Browser pain points (Noteser's structural advantage)

- Mobile satisfaction is 3.1/5 vs 4.5/5 desktop — the largest gap in the
  ecosystem.
- No web version at all — blocker for shared/managed devices and
  Chromebooks.
- Sync doesn't run in background on mobile (on Obsidian's own roadmap).
- Markdown editing on a small screen is poor; live preview ergonomics not
  designed for touch.
- **Noteser's edge:** browser-first means zero install friction, any
  device, sync always-on.

## 6. "Wow Factor" Features Consistently Praised

1. `[[wikilink]]` autocomplete with hover preview — "makes Obsidian feel
   alive." Every HN thread mentions it as the hook.
2. Graph view — emotional/motivational anchor.
3. Inline editing in Bases/table views — new in 2025: "Each cell in the
   table is editable, and making a change automatically updates the YAML
   frontmatter." Called "the missing link between notes and databases."

---

## Ship-next recommendations for Noteser (impact-per-effort)

| Pri | Feature | Rationale |
|---|---|---|
| 1 | **No-code database / table view (Bases equivalent)** | Highest community excitement in 2025-26. Bases replaces Dataview (#1 plugin). Noteser already has frontmatter — only the rendering layer is missing. |
| 2 | **Periodic Notes (weekly / monthly / quarterly)** | Daily notes exist; community says weekly/monthly periodic notes "should be core." Low effort relative to daily notes already implemented. |
| 3 | **One-click share / publish via secret URL** | No web version is Obsidian's biggest gap. Noteser is browser-first — add read-only secret URLs and leapfrog Obsidian on collaboration. |
| 4 | **AI vault chat (RAG over your notes)** | Fastest-growing workflow segment. Notes are already structured via GitHub sync — RAG-over-vault is the logical next layer. |
| 5 | **Guided onboarding / starter templates** | Obsidian's blank-canvas problem causes churn. Ship 3-4 starter vaults (Zettelkasten, Daily Notes, Project tracker, Research). |

## Sources

- [2025 Obsidian Report Card — Practical PKM](https://practicalpkm.com/2025-obsidian-report-card/)
- [The 2026 Obsidian Report Card — Practical PKM](https://practicalpkm.com/2026-obsidian-report-card/)
- [Obsidian Roadmap](https://obsidian.md/roadmap/)
- [HN: The killer feature of Obsidian was wikilinks](https://news.ycombinator.com/item?id=39028792)
- [HN: Be Careful with Obsidian](https://news.ycombinator.com/item?id=45678941)
- [Forum: Obsidian Sync: Live team collaborative editing](https://forum.obsidian.md/t/obsidian-sync-live-team-collaborative-editing/6058)
- [Dataview vs Datacore vs Obsidian Bases — Obsidian Rocks](https://obsidian.rocks/dataview-vs-datacore-vs-obsidian-bases/)
- [Obsidian Bases Overview — Practical PKM](https://practicalpkm.com/bases-plugin-overview/)
- [The Best Obsidian Plugins for 2026 — Sébastien Dubois](https://www.dsebastien.net/the-must-have-obsidian-plugins-for-2026/)
- [6 Reasons People Switch Away From Obsidian — Medium](https://medium.com/side-hustle-progress/6-reasons-people-switch-away-from-obsidian-ca62ec8140db)
- [Obsidian alternative works in a browser — XDA](https://www.xda-developers.com/this-obsidian-alternative-works-inside-a-web-browser-i-cant-stop-using-it/)
- [obsidian-smart-composer (GitHub)](https://github.com/glowingjade/obsidian-smart-composer)
- [Relay — Real-time multiplayer plugin](https://relay.md/)
- [Goodbye Dataview! Hello Obsidian Bases! — Daniel Lyons](https://dandylyons.net/posts/goodbye-dataview-hello-obsidian-bases/)
- [Absolute Killer Feature: Backlinks — Obsidian Portal Forums](https://forums.obsidianportal.com/discussion/5459/absolute-killer-feature-backlinks-what-links-here)
