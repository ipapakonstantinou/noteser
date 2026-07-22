# Using noteser with Codeberg (or self-hosted Forgejo/Gitea)

noteser can sync your vault to a Codeberg repository instead of GitHub. Codeberg
runs [Forgejo](https://forgejo.org/), so everything here applies equally to any
self-hosted Forgejo or Gitea instance — Codeberg is just the built-in preset.

## What you need

- A [Codeberg](https://codeberg.org) account.
- A running noteser instance (locally via `npm run dev`, or your own deployment).
  For a **Codeberg-only** setup you do **not** need `NEXT_PUBLIC_GITHUB_CLIENT_ID`
  — that env var only powers the GitHub OAuth device flow.

## 1. Create an access token

Codeberg → **Settings → Applications →
[Manage Access Tokens](https://codeberg.org/user/settings/applications)** →
_Generate New Token_ with these scopes:

| Scope                             | Why                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `read:user`                       | The connect flow verifies the token and shows who is signed in (`GET /user`); the repo picker lists your repositories (`GET /user/repos`). |
| `repository` — **Read and Write** | Pull and push the vault contents.                                                                                                          |

Copy the token — Codeberg shows it only once.

## 2. Connect the vault

1. In noteser, open the sync panel (Source control icon in the sidebar) and
   click **Connect** — the "Connect a vault" dialog opens with the host picker.
2. Pick **Codeberg**.
3. Paste your access token and press <kbd>Enter</kbd> (or _Connect with token_).
4. The repo picker opens with your Codeberg repositories:
   - pick an existing repo to use as the vault, **or**
   - _New repo_ creates one (auto-initialized with a README) and connects it.

From here on, sync works exactly like the GitHub flow: **Commit & Sync** pulls
remote changes first (conflicts open as merge tabs), then pushes your local
notes as a single commit. Notes are plain `.md` files at the repo root, so the
repo stays readable in the Codeberg web UI and clones fine with plain git.

## Migrating an existing Obsidian vault

Have a local Obsidian vault already? Push it to Codeberg with plain git and let
noteser clone it — do **not** use the in-app local-folder import for this (it
only reads `.md` files; the git route also brings your attachments and keeps
the full folder structure).

1. Turn the vault into a repo and push it:

   ```bash
   cd /path/to/your/vault

   # Keep Obsidian's internals out of the shared repo. noteser honours this
   # .gitignore on both pull and push.
   cat > .gitignore <<'EOF'
   .obsidian/
   .trash/
   .DS_Store
   EOF

   git init
   git add -A
   git commit -m "Initial vault import"
   # Create an empty PRIVATE repo on codeberg.org first (no README), then:
   git remote add origin https://codeberg.org/YOU/my-vault.git
   git push -u origin main
   ```

2. Connect noteser to that repo (see [Connect the vault](#2-connect-the-vault)
   above). With an empty noteser vault the first sync clones everything —
   nested folders, notes, and attachments included.

What to expect with Obsidian content:

- **Frontmatter survives byte-identically** — notes round-trip without churn.
- **Attachments** (`![[image.png]]` embeds) are mapped to their stored paths
  and render inline.
- **Foreign files** (`.canvas`, PDFs, anything non-markdown) show up in the
  file tree but are never modified or deleted by noteser — the repo stays
  fully usable from Obsidian.
- **Keep using Obsidian in parallel** if you like (e.g. via the Obsidian Git
  plugin on the same repo). noteser picks up outside commits on the next sync;
  concurrent edits to the same note open as three-way merge tabs.
- **Sharing with others:** add them as collaborators on the Codeberg repo;
  each person connects with their **own** access token.

## Self-hosted Forgejo / Gitea

Two differences from the Codeberg preset:

1. In the host picker choose **Forgejo / Gitea (self-hosted)** and enter your
   server's base URL (e.g. `https://git.example.com`) alongside the token.
   Create the token on _your_ instance under Settings → Applications, with the
   same scopes as above.
2. **Allow-list your instance in the Content-Security-Policy.** The browser
   talks to the Forgejo API directly, and noteser's strict CSP only permits
   origins known at deploy time. Codeberg is built in; for your own instance
   set:

   ```ini
   NEXT_PUBLIC_FORGEJO_BASE_URL=https://git.example.com
   ```

   in `.env.local` (or your hosting platform's environment settings) and
   restart/redeploy. Exactly one origin is allow-listed — never a wildcard —
   so an XSS payload still cannot exfiltrate your token to arbitrary hosts.

## Feature differences vs. GitHub

The sync core (pull, three-way merge, push, first-clone fast path) is fully
supported on Forgejo hosts. A few extras use GitHub-exclusive APIs and are
hidden while a Forgejo vault is connected:

- **Publish as gist** (GitHub Gist API)
- **View history** per note and **Revert vault to a commit** (GitHub commits API)

Porting these to Forgejo's API is a possible future enhancement.

## Troubleshooting

| Symptom                                                        | Likely cause                                                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| "That token is missing a scope …" when connecting              | The token lacks `read:user`. Generate a new token with both scopes — Codeberg tokens can't be edited after creation.    |
| "That token did not work …" on a self-hosted instance          | Base URL wrong (must start with `http(s)://` and point at the instance root, not `/api/v1`), or the token lacks scopes. |
| Browser console shows _"violates the Content Security Policy"_ | Self-hosted instance not allow-listed — set `NEXT_PUBLIC_FORGEJO_BASE_URL` (see above) and redeploy.                    |
| Repo list is empty                                             | The token's repository scope is read-less, or the account genuinely has no repos — create one via _New repo_.           |

## Security notes

- The token is stored in the browser's `localStorage`, same trust model as the
  GitHub token (and as the Obsidian Git plugin). Anyone with access to your
  browser profile can read it — use a dedicated token, not your account password.
- Prefer a token scoped as narrowly as your Forgejo version allows; rotate it
  if you ever paste it anywhere outside the connect dialog.
