# SilverBullet

## What it is

SilverBullet is an open-source (MIT) self-hosted "personal productivity
platform" that combines a live-preview markdown editor with a built-in
query language and a Lua-based scripting layer called Space Lua. It is
the reference design for "notes as a programmable database."

## Storage model

Plain markdown files in a folder on the user's own server. The server is
a single Go binary (or a Docker image). There is no git layer baked in;
users who want versioning add it on the host. There is no managed cloud
tier; the project is self-host only.

## Killer features

- Installable PWA. It works fully offline once installed, with a service
  worker and a local cache.
- Space Lua. Users embed Lua snippets inside notes to script behavior,
  templates, and queries.
- Objects and Queries: notes act as records with frontmatter properties,
  and a query DSL surfaces them as tables, lists, or task views.
- Plugin system ("plugs") with a clear extension API.
- Single-binary deploy. Zero npm or build chain at install time.

## What noteser cannot do that they can

- True PWA offline. noteser today degrades to a stale-data error when
  GitHub is unreachable.
- A programmable query language over note metadata. noteser has only
  Fuse.js search and an Obsidian-Tasks subset.
- User-authored scripting inside notes. noteser has no in-note runtime.
- A plugin system with a documented surface area. noteser has none.

## What they cannot do that noteser can

- Zero-infrastructure onboarding. SilverBullet requires a server,
  Docker, and a reverse proxy with TLS for any non-localhost use.
  noteser is a browser tab.
- Git-as-storage with a remote that the user already trusts. Versioning
  on SilverBullet is whatever the host filesystem provides.
- Per-hunk merge UX for collaborative edits. There is no concept of a
  remote-side conflict in SilverBullet's model.
- Direct file-compatibility with an Obsidian vault hosted in GitHub.

## Lessons for noteser

- Study the Objects/Queries DSL as a reference for the properties UI and
  the lightweight DB views called for in #72. Stay file-compatible with
  Obsidian Bases frontmatter; do not invent a parallel schema.
- The Space Lua direction is too big to copy directly, but the lesson is
  that power users want one programmable surface. A scoped "templater +
  query" path is a smaller step in that direction.
- The PWA story (#68) is non-negotiable. SilverBullet proves that a
  one-process self-host can deliver a credible offline experience; a
  browser-only app has fewer excuses.
- Avoid the self-host trap. noteser's wedge in zero-infra setup is
  exactly the friction SilverBullet imposes; emphasize that in copy.

## Sources

- https://silverbullet.md/ - visited 2026-06-06.
- https://github.com/silverbulletmd/silverbullet - visited 2026-06-06.
- https://lwn.net/Articles/1030941/ - LWN write-up referenced from #83.
