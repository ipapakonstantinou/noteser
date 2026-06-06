# Privacy / E2E cluster: Anytype, Standard Notes, Notesnook, Joplin

This cluster defines the encrypted local-first pole of the market. It
is the axis where noteser is structurally weakest: notes live in a
GitHub repository, which is a third party, not on-device-first or
end-to-end-encrypted by default. The strategic conclusion in
`docs/competitive-analysis.md` is to **not** compete on privacy, but
the cluster is worth understanding because the Joplin sub-thread
reinforces noteser's strongest card (trustworthy sync and merge).

## What they are

- **Anytype.** Local-first, end-to-end-encrypted, peer-to-peer sync,
  with a typed-object data model (not files). Free self-host;
  managed tier $5/mo with 1 GB of included storage.
- **Standard Notes.** A long-running encrypted note app whose pitch is
  "bulletproof E2E and longevity." Plain notes are free; rich editors,
  themes, and extra features sit behind a subscription.
- **Notesnook.** Encrypted-by-default, zero-knowledge architecture.
  Native apps on every platform; free tier covers most personal use.
- **Joplin.** Free and open-source, with self-hosted sync over Dropbox,
  WebDAV, OneDrive, Nextcloud, S3, and others. Optional client-side E2E.

## Storage model

- **Anytype.** A typed-object store synced peer-to-peer. Not files.
  Export to markdown exists but the live model is not on-disk markdown.
- **Standard Notes.** Encrypted blobs in Standard Notes' hosted
  service. Self-host is supported via Standard Notes Server.
- **Notesnook.** Encrypted blobs in Notesnook's hosted service. Local
  caches exist for offline use.
- **Joplin.** Plain files in a sync-folder backend (Dropbox, WebDAV,
  Nextcloud, S3, Joplin Cloud). Optional E2E wraps the files.

## Killer features

- E2E by default in three of the four (Anytype, Standard Notes,
  Notesnook). The provider cannot read note content.
- Anytype's typed objects: a note can be a "task" or a "person" or a
  custom type with a schema, and views are derived from the type.
- Standard Notes' longevity stance: the project explicitly designs for
  a decade-plus lifetime of the encrypted data format.
- Notesnook's polished mobile and desktop parity, plus public
  third-party audit cadence.
- Joplin's plugin ecosystem and broad sync-backend list.

## What noteser cannot do that they can

- End-to-end encryption of note content at rest. Anyone with the
  user's GitHub credentials can read the vault.
- A typed-object data model with derived views (Anytype).
- A documented threat model and an audit track record (Standard Notes,
  Notesnook).
- A managed sync service that the user does not have to set up.

## What they cannot do that noteser can

- Edit notes as plain markdown files in a git repository the user
  already trusts and can clone from any other tool. Anytype's data is
  not files; Standard Notes' and Notesnook's data is encrypted blobs
  in a vendor service.
- Hand a user a Git history, a diff, and a per-hunk merge view.
- Be opened by any other markdown editor in the world. The encrypted
  backends are deliberately closed-format.
- In Joplin's specific case: avoid the recurring "sync constantly broke
  and lost data" complaint pattern. noteser's transparent merge is the
  positive counterpoint to that.

## Lessons for noteser

- Do not chase the E2E pole. The honest positioning is **ownership +
  version control + portability**, not privacy (#75). Vault encryption
  for the GitHub repo is a separate feature track and should be
  documented as such (the trust model: data lives in your GitHub repo,
  the same trust model as Obsidian Git plugin, plus the XSS exfil note
  for the token).
- The Joplin data-loss thread reinforces #69. Trustworthy sync and
  merge is a real unmet need at the file-storage tier; noteser's
  per-hunk merge plus better rate-limit / retry behavior is on the
  exactly correct axis.
- Steal Anytype's typed-object framing for the properties UI (#72) at
  the documentation level only. Do not store typed objects; let
  frontmatter properties be the type, and let views filter on them.
- Watch Standard Notes' longevity claims for marketing patterns. The
  "your data will outlive the app" stance maps cleanly onto noteser's
  "the files are in your repo and a plain markdown editor can open
  them" pitch (#75).

## Sources

- https://www.toolworthy.ai/blog/obsidian-alternatives - referenced
  from #88.
- https://lock.pub/en/blog/secure-note-taking-apps-comparison -
  referenced from #88.
- https://openalternative.co/compare/joplin/vs/notesnook - referenced
  from #88.
- https://anytype.io/ - visited 2026-06-06.
- https://standardnotes.com/ - visited 2026-06-06.
- https://notesnook.com/ - visited 2026-06-06.
- https://joplinapp.org/ - visited 2026-06-06.
