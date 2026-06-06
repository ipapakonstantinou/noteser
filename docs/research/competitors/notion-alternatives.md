# Self-hosted Notion alternatives: AFFiNE, SiYuan, Trilium

This cluster defines the "databases-in-notes plus blocks plus graph"
pole. It is the right reference set for noteser's properties / DB views
(#72), graph and backlinks (#71), and the eventual large-vault
performance pass (#79).

## What they are

- **AFFiNE.** Open-source workspace that combines docs, Kanban, and an
  infinite "edgeless" whiteboard. Self-host or managed cloud. Active
  development; still beta-rough on some flows.
- **SiYuan.** Block-WYSIWYG markdown editor with block references and
  embeds, database views, a graph, AI integrations, and flashcards.
  Local files plus optional paid cloud sync. Markets itself
  explicitly on handling thousands of notes efficiently.
- **Trilium.** Hierarchical note tree with end-to-end encryption, an
  in-app scripting layer, and a focus on handling thousands of notes.
  Active fork is now Trilium Notes Next.

## Storage model

- **AFFiNE.** Local-first via a CRDT (Yjs-based) document store, with
  sync via AFFiNE Cloud or self-host. Export to markdown is supported
  but not the live format.
- **SiYuan.** Local markdown-ish files on disk in a workspace
  directory, with extra metadata sidecars for block IDs and database
  rows. Cloud sync is a paid add-on.
- **Trilium.** A single SQLite database file as the canonical store.
  Markdown export exists; the live model is database rows.

## Killer features

- **AFFiNE:** the infinite-canvas whiteboard that lives next to docs in
  the same workspace, with block-level transclusion between them.
- **SiYuan:** block-level addressing across the whole workspace, with
  embeds, queries, and table views. Vault performance is a stated
  design goal; users report tens of thousands of notes working well.
- **Trilium:** the in-app scripting and "code notes" surface, plus
  attribute-based note relationships that act as a lightweight graph.

## What noteser cannot do that they can

- Block-level addressing and embeds (SiYuan).
- Database / table views over typed properties (SiYuan, AFFiNE).
- An infinite whiteboard / canvas (AFFiNE).
- Performance at thousands-of-notes scale (SiYuan, Trilium). noteser's
  current Fuse.js index plus full-tree GitHub fetch will degrade well
  before that scale.
- In-app scripting and code execution (Trilium).
- A graph view (all three have some form).

## What they cannot do that noteser can

- Run in a browser with no install and no server. AFFiNE has a web
  build but it is the same heavy app; SiYuan and Trilium are desktop
  or self-host.
- Use GitHub as the source of truth with a real merge UI. None of
  these treat git as the storage primitive.
- Round-trip cleanly to vanilla markdown that any other editor can
  open. SiYuan comes closest but still carries sidecar metadata; the
  others are database-shaped.
- Zero-infrastructure onboarding. AFFiNE Cloud and SiYuan Cloud are
  paid; Trilium is self-host.

## Lessons for noteser

- Reference SiYuan when scoping #72 (properties UI plus Bases-style
  table views). The bar is: typed frontmatter, filter, sort, save the
  view, render in the editor. Stay file-compatible; do not adopt block
  IDs as a storage primitive.
- The "thousands of notes" performance claim sets a bar for #79.
  Concrete acceptance: 5,000 notes load under a second, search returns
  in under 200 ms, sync does not refetch the whole tree on each pull.
  Use ETag conditional requests (already in #69) plus incremental
  search index updates instead of a Fuse.js rebuild.
- AFFiNE's edgeless canvas is a future bet, not a near-term one. If a
  canvas surface ships, prefer the JSON Canvas format (Obsidian) for
  interop rather than a CRDT-shaped one.
- Trilium's scripting layer is a useful warning: it accumulates
  user-written code that is hard to migrate. A scoped templater is
  safer than a programmable runtime.
- None of these compete on the merge axis. The wedge holds.

## Sources

- https://www.theinfinity.dev/articles/the-3-best-open-source-notion-alternatives
  - referenced from #89.
- https://affine.pro/ - visited 2026-06-06.
- https://b3log.org/siyuan/en/ - visited 2026-06-06.
- https://github.com/TriliumNext/Notes - visited 2026-06-06.
