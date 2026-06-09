# Positioning

The one-page reference for how noteser describes itself. Use this when
writing landing copy, README intros, social posts, or feature-launch blurbs.
Source of record for the moat lives in [`competitive-analysis.md`](./competitive-analysis.md);
this document distills it into ready-to-paste lines. Last refresh: 2026-06-06.

## The moat

The transparent, per-hunk three-way merge.

Browser-based Markdown editors exist. Git-as-storage exists. Browser + Git
storage exists in exactly two products: noteser and NotesHub. NotesHub
resolves conflicts with an opaque "automatic" merge. noteser shows every
conflict line by line and lets the user accept yours, theirs, or both, file
by file, keyed on the last-pushed SHA per note.

That is the only axis where noteser is alone in the market, and conflict
handling is the single most-requested improvement in the Obsidian-git
community ([obsidian-git #803](https://github.com/Vinzent03/obsidian-git/issues/803)).
Everything else (browser, GitHub storage, wikilinks, tasks, calendar) is
table stakes or parity. Lead with the merge.

The second pillar, used in supporting copy, is Obsidian Tasks compatibility:
the same `- [ ]` plus `✅ YYYY-MM-DD` syntax and live `tasks` query blocks.
This pairs cleanly with the merge story because both are about ownership of
plain Markdown files, not about a proprietary container.

## One-sentence pitch

> noteser is a browser-based Markdown editor that syncs to a GitHub repo
> you own and resolves every merge conflict line by line, the way VS Code
> does, so two devices can edit the same vault without losing edits.

Shorter variants for tight slots:

- Twitter or OG description: "Browser-based Markdown notes on top of your
  GitHub repo, with the line-by-line merge UX from VS Code."
- Hero subtitle on `noteser.app`: "Edit Markdown in your browser, on top
  of a GitHub repo you own. See every conflict line by line and accept
  yours, theirs, or both."

## Elevator (about 80 words)

noteser is a Markdown notes app that runs in the browser and stores every
note as a `.md` file in a GitHub repository the user already owns. When the
same note changed on two devices, noteser opens a per-hunk three-way merge
in the editor and the user accepts yours, theirs, or both, one conflict at
a time. There is no separate server, no account to create, and no
proprietary file format. The vault opens in any text editor, in Obsidian,
or directly on github.com.

## Wedge audience

Two pools, ranked by sharpness of the pain:

### 1. Obsidian-git frustrated users

Obsidian on the desktop is a single-user, local-files app. The community
plugin "Obsidian Git" bolts on a git workflow, and the
[#1 open complaint on that repo](https://github.com/Vinzent03/obsidian-git/issues/803)
is conflict handling. These users already think in Markdown, already use a
GitHub repo, and already accept "merge conflicts can happen" as the price
of multi-device sync. They have nowhere good to land when a conflict
opens. noteser opens the conflict as a per-hunk three-way merge in the
same window where they were just typing.

Acquisition channels: the obsidian-git issue tracker, the Obsidian forum
thread on sync, r/ObsidianMD threads about multi-device sync, and direct
mention in noteser's "Coming from Obsidian?" onboarding card.

### 2. NotesHub-curious users

NotesHub is the closest direct rival: browser + GitHub or generic git +
native apps, $3.99 one-time. Its conflict resolution is described as
automatic. For a user who treats their notes as source of truth and wants
to see and approve every change, "automatic" reads as risk. noteser's
positioning to this pool is one line: "Same browser-plus-Git model. You
see every conflict before it merges."

Acquisition channels: NotesHub comparison reviews, "NotesHub vs" search
intent, side-by-side feature pages, and a focused comparison card on the
landing page.

A weaker third pool worth a mention but not a campaign: Logseq refugees
(database migration limbo, data-loss reports) and Notion-frustrated users
(lock-in, restrictive offline). For these users the lead is portability of
plain `.md` files in their own repo, with the merge UX as the second beat.

## What NOT to lead with

### Privacy

Notes live in a GitHub repository owned by Microsoft. That is a third party
holding the data. Against Anytype, Standard Notes, or Notesnook, the privacy
story is structurally weak. Leading with "private" or "your data stays with
you" invites the obvious comeback ("you mean with Microsoft") and burns
credibility.

Position on **ownership, version control, and portability**, not privacy:

- Ownership: the repo belongs to the user, on an account they already pay
  for or use for free; no separate noteser account exists.
- Version control: every save is a commit, and every commit is reversible
  on github.com or with any git client.
- Portability: the vault is a folder of plain `.md` files; it opens in
  Obsidian, in any text editor, or on github.com directly.

### Hype adjectives

Avoid: revolutionary, powerful, modern, beautiful, seamless, magical,
intelligent, AI-powered (unless documenting a specific AI feature).

Prefer: numbers, names of competitors, concrete file formats, concrete
keystrokes. "Per-hunk three-way merge" beats "powerful merge." "Plain
`.md` files in your repo" beats "modern storage."

### Feature-list openings

Do not lead with a comma-separated list of features ("wikilinks, tags,
tasks, live preview, panes, templates"). That copy reads as parity with
Obsidian and gives the visitor no reason to switch. Feature lists belong
below the merge framing, not in place of it.

### "Browser-based Markdown notes" alone

This was the prior framing. It is true but it is also the framing every
single browser-Markdown editor uses, including StackEdit, HackMD, Dillinger,
and SilverBullet. It does not carry the moat. Use it only as a setup line
before the merge claim, never as the standalone hook.

## Copy patterns to reuse

### Hero, long form

> Edit Markdown notes in your browser, on top of a GitHub repo you own.
> When the same note changed in two places, you see every conflict line by
> line and pick yours, theirs, or both. The merge UX from VS Code, in the
> browser, on your repo.

### Hero, short form (under 140 chars)

> Browser-based Markdown notes, on a GitHub repo you own, with the
> line-by-line merge UX from VS Code.

### README opener

> A browser-based notes app with a transparent per-hunk Git merge, on top
> of a GitHub repo you own.

### Comparison line (vs NotesHub)

> Same browser-plus-Git model as NotesHub. The difference is conflict
> resolution: NotesHub merges automatically; noteser shows every conflict
> line by line and lets you accept yours, theirs, or both.

### Comparison line (vs Obsidian-git)

> The merge UX the Obsidian-git plugin does not have. Same vault, same
> `.md` files, same `[[wikilinks]]`. When two devices change the same
> note, noteser opens a per-hunk three-way merge instead of stopping the
> sync.

## Voice rules

These apply to every marketing surface: landing, README opener, hero
subtitles, OG descriptions, comparison cards, launch posts.

- No em dashes. Use commas, periods, or hyphens.
- No contractions in formal copy (use "do not", "is not", "cannot").
- No hype adjectives (see the list above).
- Prefer numbers over adjectives ("two devices" beats "multiple devices";
  "five seconds" beats "fast").
- Lead with the merge UX. Feature lists come after.
- Position on ownership, version control, and portability. Do not lead
  with privacy.

## Related documents

- [`competitive-analysis.md`](./competitive-analysis.md): the full
  market benchmark and gap list, with priorities.
- [`roadmap.md`](./roadmap.md): the Now / Next / Later plan that follows
  from those gaps.
- [`demo.md`](./demo.md): assets and scripts for the demo clips that
  back the marketing surfaces.
