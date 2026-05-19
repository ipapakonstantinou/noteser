---
name: queue
description: Manage the orchestrator's task queue at `.claude/orchestrator/queue.json` — add, list, mark done, remove, clear. Invoke when the user types `/queue ...` from the terminal or asks you to "queue" / "enqueue" a task. Does NOT dispatch work; that's the orchestrator session's job.
---

# /queue — task queue management

You manage the orchestrator's task queue stored at
`.claude/orchestrator/queue.json` (relative to the repo root).

## Subcommands

The argument string after `/queue` determines the action.

| Form | Action |
|---|---|
| `/queue add "<brief>"` | Append a new `pending` item. Brief is the quoted string. |
| `/queue list` | Show items with `status` in {`pending`, `in_progress`}. Default. |
| `/queue list --all` | Show every item including `done` and `failed`. |
| `/queue done <id>` | Set item `<id>` to `done`, fill `completed_at`. |
| `/queue fail <id> "<reason>"` | Set item `<id>` to `failed`, fill `error` and `completed_at`. |
| `/queue start <id>` | Set item `<id>` to `in_progress`, fill `started_at`. |
| `/queue remove <id>` | Delete item `<id>` entirely. |
| `/queue clear` | Remove all `done` and `failed` items (keep `pending` + `in_progress`). |
| `/queue` (no args) | Same as `/queue list`. |

`<id>` accepts a unique prefix — if the user passes `a3f9` and only one id
starts with that, use it.

## Item schema (must match)

```jsonc
{
  "id": "<sortable-timestamp>-<4char-suffix>",   // e.g. "20260519T050000-a3f9"
  "brief": "<one-line description>",
  "status": "pending",                            // pending | in_progress | done | failed
  "created_at": "<ISO 8601 UTC>",
  "started_at": null,
  "completed_at": null,
  "result": null,
  "error": null,
  "source": "terminal"                            // or "telegram" / "other"
}
```

Generate `id` as `YYYYMMDDTHHMMSS` (UTC, no separators) + `-` + 4 random
lowercase hex chars. Use the current real time for `created_at` —
ISO 8601 UTC, e.g. `2026-05-19T05:00:00Z`.

## How to do the work

1. **Read** `.claude/orchestrator/queue.json` first. If it doesn't exist or is
   malformed, create a fresh `{ "version": 1, "items": [] }` and tell the user.
2. **Mutate** the in-memory object per the subcommand.
3. **Write** the file back as pretty-printed JSON (2-space indent), trailing
   newline. Preserve the `version` field exactly as read (currently `1`).
4. **Report** back in a short message:
   - For `add`: confirm the new id and brief.
   - For `list`: a compact table of `id (last 4 chars) · status · brief` —
     newest first. If empty, say so explicitly.
   - For `done` / `fail` / `start` / `remove`: confirm by id + brief.
   - For `clear`: say how many items were removed.

## Source detection

If the calling session was triggered by a Telegram message (you'll see a
`<channel source="plugin:telegram:telegram" ...>` block earlier in the
conversation that prompted this `/queue add`), set `source: "telegram"`.
Otherwise default to `source: "terminal"`.

## Things NOT to do

- Don't dispatch any work. `/queue` is for state management only — the
  orchestrator session decides when and how to run items.
- Don't invent fields. Stick to the schema above.
- Don't sort the items array by anything other than insertion order. Listing
  is presented newest-first but storage stays in insertion order.
- Don't commit or push. The user reviews `git diff` themselves.

## Reporting style

Match the rest of the repo's terseness — one short paragraph or a small list,
not an essay. Show ids truncated to the last 4 chars in messages (e.g.
`a3f9`); the full id is in the file if the user needs it.
