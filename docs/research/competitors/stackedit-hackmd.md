# StackEdit, HackMD, CodiMD

These three are grouped because they share a "browser-based markdown
editor with cloud sync" shape. None is a vault-style PKM; each is the
closest non-PKM precedent for one slice of noteser's UX.

## What they are

- **StackEdit.** An in-browser single-document markdown editor with
  cloud sync to GitHub, Google Drive, and Dropbox. The closest "browser
  plus GitHub sync" precedent that predates noteser.
- **HackMD.** A hosted real-time collaborative markdown workspace aimed
  at teams. Bidirectional GitHub sync exists as a side feature; the
  primary store is HackMD's database.
- **CodiMD.** The free, self-hosted, open-source fork of HackMD's old
  codebase. Same collaboration model, no managed tier.

## Storage model

- **StackEdit:** files live in the connected provider (GitHub repo or
  cloud drive). Background sync runs roughly every minute and does a
  download / merge / upload cycle.
- **HackMD:** notes live in HackMD's hosted database. GitHub sync is a
  pull-and-push integration, not the store.
- **CodiMD:** notes live in the self-hosted server's database (Postgres
  or sqlite). Same model as HackMD.

## Killer features

- **StackEdit:** zero install; works on a Chromebook; the original
  "open and start typing markdown in a browser" experience.
- **HackMD:** live multi-cursor, comments, presentation mode, version
  history, Mermaid, PlantUML, and a slide mode. Free tier exists; Prime
  is around $5 per user per month.
- **CodiMD:** the above, free, self-hosted, with no per-seat fee.

## What noteser cannot do that they can

- **StackEdit:** none meaningful. StackEdit's only edges are name
  recognition and a slimmer, single-document mental model.
- **HackMD / CodiMD:** real-time multi-cursor editing as the default,
  not an opt-in. Comments threaded on a document. Slide mode. A
  full-featured presentation surface.

## What they cannot do that noteser can

- Function as a vault or PKM. StackEdit is one document at a time. No
  wikilinks, no backlinks, no tag aggregation, no calendar view.
- Work offline. StackEdit explicitly requires internet; opening it
  without network shows an error.
- Transparent merge UX. StackEdit's "background merge" is opaque and
  has accumulated complaints (see benweet/stackedit #1176).
- Treat git as the source of truth. HackMD and CodiMD treat git as a
  side channel; the real store is their server.
- Run with no hosting at all. CodiMD needs a server, a database, and an
  ops surface that a browser-only tool avoids.

## Lessons for noteser

- StackEdit's complaint pattern (opaque sync, no manual control, no
  offline) is exactly the gap noteser already closes on merge and
  intends to close on offline (#68). Use it in onboarding copy: "the
  StackEdit you wanted, with a real vault and a real merge view."
- HackMD's real-time-collab depth is not a target. noteser already has
  opt-in collaboration via Yjs (`NEXT_PUBLIC_YJS_WS_URL`). Do not chase
  presentation mode or threaded comments; they are not the wedge.
- CodiMD is a useful reference for an eventual self-host story, but
  only if a hosted SaaS appears. Today the "just a browser tab plus
  a repo" pitch is stronger than any self-host path.

## Sources

- https://stackedit.io/ - visited 2026-06-06.
- https://github.com/benweet/stackedit/issues/1176 - long-standing
  opaque-sync complaint, referenced from #85.
- https://hackmd.io/ - visited 2026-06-06.
- https://github.com/hackmdio/codimd - visited 2026-06-06.
