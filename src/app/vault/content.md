# How I use Noteser

Noteser is a markdown notes app I built for myself first. Files live as
plain `.md` in my own GitHub repo. The browser is the editor. There is
no account, no upload, and no other server holds my notes.

This page is how I actually use it. The rules below are ones that
survived a year of daily note-taking before noteser existed and got
carried over.

## Eight rules

1. **Files on disk, not in a database.** Every note is a real `.md`
   file. If noteser disappears tomorrow my notes still open in any
   text editor.
2. **Folders for browsing, links for finding.** Two top-level folders
   are enough. Everything else nests by intent, not by category.
3. **Capture first, organize later.** I write into a daily note. If a
   thought grows, it gets promoted into its own file. Most do not.
4. **Wikilink before tag.** A `[[Person]]` link is a real connection;
   a `#tag` is a query. I reach for links and only tag what I want to
   search across notes.
5. **One title field, no extra metadata.** Frontmatter only when I
   genuinely need it. Most notes carry zero properties.
6. **Daily note as the universal scratchpad.** Every day starts on
   `daily/2026-06-01.md`. Open work, things to check, things I read.
7. **Sync runs in the background.** Every change pushes to GitHub.
   The repo IS the backup. I do not export.
8. **Mobile is for read + capture.** I do not refactor notes on the
   phone. I drop a line into the daily note and revisit at the laptop.

## Folders

Two top-level folders only:

- `daily/` for daily notes, weekly notes, monthly review.
- `notes/` for everything else: people, projects, references, ideas.

Anything that wants a third top-level folder is usually a tag instead.

## Links

I use wikilinks the same way I use a search box: `[[Person]]`,
`[[Project]]`, `[[Concept]]`. Noteser autocompletes from existing
notes, so the link surfaces what is already there before I type.

When I cannot remember whether a note exists, I type the wikilink
anyway. If autocomplete shows it, it exists; if not, I create the
file from the link.

## Rhythm

- **Daily.** One note per day under `daily/`. Captures everything:
  tasks, notes, half-thoughts, links.
- **Weekly.** A Sunday review note that pulls forward what is
  unfinished, drops what is no longer relevant, sets focus for the
  coming week.
- **Monthly.** A short look back at goals, training, work, what
  shipped.

The weekly note has three fixed sections that never change. The format
does the thinking I do not want to redo every Sunday.

## Templates

A handful of templates I reuse:

- Daily note (date + open work + done today + notes)
- Weekly review (last week retro + this week + focus)
- Project note (goal + status + open questions + log)

Templates are markdown files in `notes/_templates/`. Noteser's template
picker reads from that folder.

## Publishing

The vault lives in a public GitHub repo, so anything I want to publish
I can render with a static-site generator. The plain `.md` files are a
Jekyll, Hugo, or Astro site by default.

I have not turned that on yet for this vault. The option is there.

## Why noteser exists

The system above is a direct lineage from kepano's
[How I use Obsidian](https://stephango.com/vault). I built noteser
because I wanted the same workflow without an Electron app and without
a sync subscription. The files are the same; only the editor is
different.

If you want to start, the [getting-started guide](/help/getting-started)
walks through the first ten minutes. The [changelog](/changelog) is
what has shipped recently.
