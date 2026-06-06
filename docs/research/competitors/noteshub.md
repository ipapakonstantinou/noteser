# NotesHub

## What it is

NotesHub is a cross-platform markdown note app that markets itself on "the
power of markdown and GitHub together." It is the single closest head-to-head
with noteser: browser-first, git-as-storage, no subscription.

## Storage model

Users link a GitHub account and clone one or more repositories as
"notebooks." Local edits sync automatically to the remote. Generic remote
Git (self-hosted GitLab, Gitea, Bitbucket) is also supported, plus local
file system and iCloud Drive. The user owns the storage; NotesHub holds no
server-side copy of note content.

## Killer features

- Native apps on every major platform: Web, iOS, Android, Windows, macOS,
  Linux, with presence in the relevant app stores.
- Offline mode in the native apps. The PWA also caches for short sessions.
- Kanban boards as a first-class note type.
- Whiteboarding / freeform canvas surface.
- Mermaid diagrams, LaTeX math, callouts, YouTube and tweet embeds.
- Automatic conflict resolution on sync. The mechanism is not exposed to
  the user.
- Real-time collaboration with invite-based access control.
- One-time price of $3.99 for the native apps. Browser is free. The brand
  is explicitly anti-subscription.

## What noteser cannot do that they can

- Native binaries in every app store. noteser is browser-only today.
- Offline-first usage. NotesHub keeps working with no network; noteser
  degrades without GitHub reachability.
- Kanban as a built-in note type. noteser only has Obsidian-Tasks lists.
- Whiteboard / freeform canvas.
- Tweet, YouTube, and richer embeds out of the box.
- Real-time multi-user collaboration with first-party invite flow.
- Established presence in the iOS, Android, Mac, and Windows stores, which
  is a discovery and trust advantage that a web app cannot match without
  effort.

## What they cannot do that noteser can

- Transparent per-hunk three-way merge. NotesHub resolves conflicts
  "automatically" without surfacing the diff or letting the user pick
  hunks. Power users who care about losing keystrokes do not trust this.
- Obsidian Tasks compatibility (`- [ ]` plus `done` emoji plus `YYYY-MM-DD`)
  with live `tasks` query blocks. NotesHub does not ride that ecosystem.
- File-compatibility with an Obsidian vault that is also stored in Git.

## Lessons for noteser

- Lean into the merge UX as the wedge. NotesHub's "automatic" resolution
  is the exact reason a transparent per-hunk diff is defensible. See
  competitive-analysis.md priority 5 and Vinzent03/obsidian-git #803.
- Offline-first is table stakes against this rival. Land #68 (IndexedDB
  cache plus installable PWA) before claiming "browser anywhere."
- Steal the one-time-price anti-subscription stance for positioning copy
  (#75). It works against Notion, Obsidian Sync, and HackMD Prime.
- Kanban can be derived from existing task syntax. A `kanban` view over
  `- [ ]` lines with status tags is a cheap parity move; do not build a
  separate Kanban data model.

## Sources

- https://about.noteshub.app/ - visited 2026-06-06.
- https://github.com/NotesHubApp - visited 2026-06-06.
- https://productivity.directory/noteshub - referenced from issue #82.
- https://github.com/Vinzent03/obsidian-git/issues/803 - referenced for
  the merge-UX demand signal.
