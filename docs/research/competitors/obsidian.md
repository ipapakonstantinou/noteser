# Obsidian

## What it is

Obsidian is the dominant local-first markdown PKM. It is the gravity
well in this category: the default thing a power user opens, and the
file format every other tool tries to be compatible with. noteser
deliberately stays interoperable: same `.md` files, same Obsidian Tasks
syntax, the same wikilink shape.

## Storage model

Local markdown files on disk, in a folder the user controls (the
"vault"). Sync is either paid Obsidian Sync (a hosted, end-to-end
encrypted service) or a community plugin such as obsidian-git, Syncthing,
or iCloud. There is no first-party browser version; the desktop and
mobile apps are the only official clients.

## Killer features

- Plugin ecosystem. Roughly 2,000 community plugins, including
  Dataview, Templater, Smart Connections (around 786,000 downloads),
  Obsidian Tasks, and the official Web Clipper.
- **Bases** (shipped 2025). A vault-as-database feature: typed
  frontmatter properties surfaced as filterable, sortable table views.
  Stays file-compatible because properties live in frontmatter.
- **Canvas** with the JSON Canvas open file format. An infinite
  whiteboard with cards that can embed notes.
- Official **Web Clipper** browser extension (2025) with an AI
  Interpreter that summarizes pages before saving.
- Claude and AI Skills integrations announced for 2025-26.
- Graph view and backlinks panel as first-class navigation surfaces.
- Live preview that toggles between source and rendered seamlessly
  per-line.

## What noteser cannot do that they can

- A graph view or backlinks panel. noteser has wikilinks but no graph
  and no unlinked-mentions surface.
- Frontmatter properties as a typed UI, plus Bases table views.
- An infinite canvas with the JSON Canvas format.
- A browser-extension web clipper.
- A plugin marketplace of any kind.
- Mobile apps in the relevant app stores.
- An AI surface integrated into the editor, whether first-party or via
  the Smart Connections ecosystem.

## What they cannot do that noteser can

- Run in a browser at all. There is no official web build. This is
  Obsidian's most persistent structural gap and noteser's core wedge.
- Use GitHub as a first-class storage backend with a real merge UI.
  obsidian-git exists as a community plugin and its conflict handling
  is the top-requested improvement (issue #803 on Vinzent03/obsidian-git).
  noteser's transparent per-hunk three-way merge is exactly that gap
  closed.
- Sync without either paying for Obsidian Sync ($5/mo), running a
  separate sync tool, or accepting the obsidian-git plugin's rough
  edges.

## Lessons for noteser

- Stay file-compatible with Bases (#72). Frontmatter properties are
  now a real standard; do not invent a competing schema. A Bases-style
  table view over the existing tag and frontmatter data is a high-ROI
  parity move that also opens an import path for Obsidian users.
- Graph view plus backlinks (#71) is the single most-expected PKM
  feature. Without it noteser reads as "not a real PKM" to anyone
  evaluating against Obsidian.
- A web clipper (#74) pairs naturally with git storage: clip a page,
  commit a `.md` file. Manifest V3 plus a "send to noteser" endpoint
  is small surface area for a meaningful capture flow.
- The merge-UX win against obsidian-git is real and demonstrable.
  Lead with it in copy (#75): "the obsidian-git conflict story you
  always wanted." Tie back to obsidian-git #803 in marketing.
- Do not chase the plugin ecosystem. That is a multi-year project and
  the wrong axis. Compete on the wedge (#75) and pick off one or two
  marquee plugin behaviors (Tasks, eventually Dataview-lite).

## Sources

- https://obsidian.md/pricing - visited 2026-06-06.
- https://obsidian.md/roadmap/ - visited 2026-06-06.
- https://github.com/Vinzent03/obsidian-git/issues/803 - the merge-UX
  demand signal, referenced from #86.
- https://github.com/obsidianmd/obsidian-clipper - official Web Clipper
  source, referenced from #86.
