# GitJournal

## What it is

GitJournal is a mobile-first markdown notes app that stores notes
directly in a git repository. It owns the "git on a phone" niche the way
NotesHub owns "git in a browser."

## Storage model

Any git repository reachable over SSH: GitHub, GitLab, Gitea, or a
self-hosted server. Notes are plain markdown with optional YAML
frontmatter. The app clones the repo to device storage, edits locally,
and pushes when the user triggers sync or when auto-sync fires.

## Killer features

- Offline-first. The clone lives on the device; no network is required
  to read or edit.
- No account is required at the GitJournal layer; the only credential is
  the user's git remote.
- Folder hierarchy with arbitrary depth.
- Backlinks (paid tier).
- Tag and metadata search.
- Free on Android, $3.99 one-time on iOS.

## What noteser cannot do that they can

- A real mobile experience built around the phone keyboard, swipe
  gestures, and lifecycle. noteser is a browser app that resizes; it
  was not designed for phone use.
- Offline-first sync. GitJournal works on a plane; noteser cannot
  reach GitHub there.
- Background sync that handles SSH key auth, push retries, and
  intermittent connectivity.
- Install via the Play Store and App Store; that is the channel where
  phone-first users discover note apps.

## What they cannot do that noteser can

- Run in a browser at all. GitJournal is mobile-only.
- Per-hunk three-way merge. GitJournal's conflict story is "the user
  resolves the file by hand."
- Multi-pane workspace, tab strip, and other desk-style ergonomics.
- Fast iteration from a desk: reload a tab, see the change.

## Lessons for noteser

- The mobile question is not optional. A weak PWA cedes phones to
  GitJournal and that is half the use case. Prioritize #68 (offline
  PWA) and treat the mobile layout as a launch-blocker, not polish.
- Reported pain points on GitJournal include "failed to save note" and
  occasional crashes during sync. The lesson is that git on a flaky
  network is hard. noteser's #69 (rate-limit and sync hardening) should
  include explicit retry, idempotency, and a user-visible "queued
  changes" state.
- GitJournal is complementary, not directly competitive. The right
  framing is "noteser is the desktop and browser side of the same
  git-storage workflow that GitJournal handles on your phone." A
  recommended-pairing note may even be worth keeping.

## Sources

- https://gitjournal.io/ - visited 2026-06-06.
- https://github.com/GitJournal/GitJournal - visited 2026-06-06.
- https://medevel.com/gitjournal/ - review referenced from #84.
