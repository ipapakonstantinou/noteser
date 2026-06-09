# Logseq

## What it is

Logseq is an outliner-style, local-first PKM with a strong
journal-and-blocks model. It is free, open-source, and has a passionate
user base. As of 2026 it is also a cautionary tale: stuck in a
multi-year database migration with reports of stalled development and
data-loss risk.

## Storage model

Local markdown or Org-mode files on disk, organized around a daily
journal page and a graph of block references. Sync is via git, Syncthing,
iCloud, or the optional Logseq Sync service. The on-disk format is
human-readable but encodes a block tree, so round-tripping to plain
markdown is lossy.

## Killer features

- Outliner-first editing: every line is a block with its own
  identifier, collapsible and embeddable anywhere else.
- Block references and block embeds, where any block can be transcluded
  into another note by ID.
- Daily journal pages as the default capture surface.
- Queries (a Datalog-style DSL over the block graph) for live, derived
  views.
- Whiteboards (in the stable build) and PDF annotation.
- Flashcards with spaced-repetition tied to blocks.
- Free and self-hostable. No subscription is required for the core.

## What noteser cannot do that they can

- Outliner-style block editing as the default. noteser is a flat-text
  markdown editor.
- Block references and embeds. noteser has wikilinks at the file level
  only.
- A graph view and a backlinks panel.
- A Datalog-style query layer over note metadata.
- Built-in flashcards and PDF annotation.
- A daily-journal flow with a one-click "today" capture.

## What they cannot do that noteser can

- Ship a stable database backend. The DB migration has been in limbo
  since 2022; as of early 2026 the DB version still has not landed and
  development looks stalled. Users in the community discuss "sync
  hiccups and random data loss."
- Round-trip cleanly to plain markdown. The on-disk file is shaped by
  the block model and is awkward to edit outside Logseq.
- Run in a browser. The web demo exists but is not the supported path.
- Offer a merge UI for the git workflow many users adopt; conflicts
  are resolved by hand.

## Lessons for noteser

- The migration-refugee pool is real and addressable. Ship a clean
  Logseq import path (#73) that reads the journal hierarchy and the
  page graph into plain markdown plus wikilinks. Position copy (#75)
  around "boring, file-on-disk, version-controlled markdown that will
  outlive the app."
- The stability story matters more than feature parity for this
  audience. Stability claims have to be earnable: invest in the merge
  UX, the sync robustness items in #69, and a no-data-loss test
  harness before marketing on it.
- Block references are nice but not the wedge. A wikilink-level model
  plus Bases-style frontmatter (#72) is closer to where the broader
  market is settling. Do not adopt Logseq's block-tree on-disk format;
  it is exactly the lock-in users are escaping.
- Daily-journal capture is cheap to add and meaningful to migrators.
  The calendar view already exists; a one-key "open today's note" is
  a small step from there.

## Sources

- https://discuss.logseq.com/t/concerns-on-db-version-and-future-state-from-a-3-year-user/29225
  - community thread referenced from #87.
- https://www.solanky.dev/p/logseq-migration-journey-challenges-delays-and-hopes
  - migration retrospective referenced from #87.
