# Beta features & in-app bug reporting

Design notes + best practices for two related capabilities you asked about:

1. A **beta toggle** in Settings that gates experimental features.
2. A **"Report a bug"** button in Settings that creates a GitHub issue on
   the user's behalf (using their existing GitHub OAuth token).

Not built yet — this doc captures the design so it's queue-ready.

---

## 1. Beta features — recommended pattern

### Single switch + named flags

In `settingsStore.ts`, add:

```ts
betaEnabled: boolean        // master switch
betaFlags: Record<string, boolean>   // per-feature opt-ins (only matters when betaEnabled is true)
```

UI: one "Enable beta features" toggle in Settings, plus a collapsible list
of individual flags shown only when the master switch is on. This avoids
the "I clicked one flag and forgot how to find them again" UX trap.

### Reading flags in code

Wrap the experimental feature behind a guard:

```ts
function useFlag(name: string): boolean {
  return useSettingsStore(s => s.betaEnabled && s.betaFlags[name] === true)
}

// In a component:
const showBases = useFlag('bases-view')
if (showBases) return <BasesView />
```

Keep the flag string as a constant in a `featureFlags.ts` file so renames
don't silently disable features:

```ts
export const FLAGS = {
  basesView: 'bases-view',
  aiVaultChat: 'ai-vault-chat',
  realtimeCollab: 'realtime-collab',
} as const
```

### When to remove a flag

A flag is debt. Two states are healthy:
- **Behind a flag** — actively shipping to beta users for feedback.
- **Default-on, flag removed** — feature is GA, code path is unconditional.

The third state ("shipped behind a flag forever") is what kills codebases.
Set a calendar reminder for every flag you add — 4 weeks max in beta, then
either promote or revert.

### Best practices

- **Don't gate bug fixes** — fixes ship without a flag.
- **Don't gate API surface changes** — if the data shape changes,
  everybody gets the new shape; the flag only controls UI.
- **Flag name in commit messages** — `feat(bases): list view behind FLAGS.basesView` makes it greppable later.
- **One flag, one feature** — resist the urge to combine. "beta v2" or "experimental enabled" becomes meaningless after the third add.
- **Persist the flag list per repo + per device** — if a user enables Bases on desktop, you probably want it on mobile too. The current `settingsStore` (localStorage) gives you per-device. Use the GitHub-backed settings file (when we ship one) for cross-device.

---

## 2. In-app "Report a bug" → GitHub issue

### Why GitHub issues (vs. a separate bug tracker)

- The user is already authenticated against GitHub (existing OAuth token).
- Repo maintainers see every report alongside code; no second tool to triage.
- Public issues are searchable, which deduplicates reports naturally.
- Free, unlimited, no infra to run.

### Required OAuth scopes

The current Noteser OAuth flow requests the `repo` scope, which already
covers `repo:issues` (create + read + write on private and public repos).
**No scope changes needed** — verify by checking
`src/app/api/github/device-code/route.ts` for `scope=` in the request.

### Flow

1. User clicks "Report a bug" in Settings.
2. Modal opens with:
   - **Title** input (required)
   - **What happened** textarea (required)
   - **Steps to reproduce** textarea (optional)
   - **Attach diagnostics** checkbox (default on) — includes:
     - Noteser version (git SHA from build-time env var)
     - Browser + OS user-agent string
     - Active settings (sanitized: no API keys, no token)
     - Last 50 console messages (if we capture them)
     - Note count, folder count, sync state, last sync time
   - **Make public** checkbox: file in `ipapakonstantinou/noteser` (this repo) if checked, otherwise file in the user's connected vault repo.
3. On submit:
   - Build a markdown body from the form + diagnostics.
   - `POST https://api.github.com/repos/{owner}/{repo}/issues` with the user's token.
   - On success, show a success toast with a link to the new issue.
   - On error, show the error + a "Copy to clipboard" fallback so the user can paste the report manually.

### Defaults that matter

- **Default repo for "make public"** = `ipapakonstantinou/noteser` (hard-coded).
- **Default repo for private** = the user's current `syncRepo` from the GitHub store.
- **Labels** = automatically add `bug` + `from-app` + `v<git-sha>`. The `from-app` label lets you filter issues that came through the in-app flow separately from manually-filed ones.

### Best practices

- **Show the body BEFORE submission** — collapsible "Preview report" section. Users are nervous about sending diagnostic data; letting them see exactly what goes makes the experience trustworthy and reduces support back-and-forth.
- **Strip secrets aggressively.** Even if `aiApiKey` is in settings, the diagnostic dump should `'***'` it out. Same for the OAuth token. Build a sanitizer that runs on every value before stringification.
- **Rate-limit client-side.** One submission per 60s. Otherwise a user holding Enter spams your issue list.
- **Don't auto-attach the active note's content.** Privacy. Optionally let the user "Include current note" via a checkbox.
- **Always offer the copy-to-clipboard fallback.** If GitHub's API returns 401 (token revoked), the user shouldn't lose the report they just typed.
- **Provide an "Other channels" link** — for users who don't want to use GitHub, link to a contact form or email. Some bug reporters refuse to make accounts.

### Database / persistence side

A reported bug is just an HTTP call — no local persistence required. The
"draft state" while the user is typing should live in React state, not in
a store. Reload = lost draft, which is acceptable for a bug-report flow.

### Issue template

Something like:

```markdown
## What happened
{user_input}

## Steps to reproduce
{user_input}

## Diagnostics
- Noteser version: `{git_sha}` ({build_date})
- Browser: {ua}
- Repo connected: {yes/no}
- Last sync: {timestamp or "never"}
- Notes: {count}, folders: {count}, attachments: {count}
- Settings (sanitized):
  ```json
  {sanitized_settings}
  ```

<!-- Filed via in-app bug reporter -->
```

---

## Effort estimate (rough)

| Capability | Effort |
|---|---|
| `betaEnabled` + `betaFlags` in settings store | ~1h |
| `useFlag` hook + first usage site | ~30min |
| Settings UI section ("Beta features") | ~1h |
| Bug-report modal (form + preview) | ~2h |
| Bug-report submit (call + error handling + clipboard fallback) | ~2h |
| Diagnostic sanitizer + tests | ~1h |
| **Total** | **~7-8h** |

When you want to ship this, queue it as `beta-and-bug-report` and we can
tackle it as a single PR.
