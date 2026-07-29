# Orchestrator state

Working state for the agent orchestrator.

- `queue.json` — task queue. Schema below. Managed by the `/queue` slash
  command (`.claude/skills/queue/SKILL.md`) and the orchestrator session.
  **Local-only and gitignored** — it is one machine's in-flight work, it
  publishes the whole dev workflow of a public repo, and it churned the diff on
  every session. It was tracked until 2026-07-29; nothing recreates it, so a
  fresh clone simply starts with an empty queue.

Everything else under `.claude/` (agents, skills, settings) stays tracked: that
is shared configuration worth having in a clone.

## Queue schema (v1)

```jsonc
{
  "version": 1,
  "items": [
    {
      "id": "20260519T050000-a3f9",         // sortable timestamp + 4-char suffix
      "brief": "write docs for the tags feature",
      "status": "pending",                   // pending | in_progress | done | failed
      "created_at": "2026-05-19T05:00:00Z",
      "started_at": null,                    // ISO 8601 when picked up
      "completed_at": null,                  // ISO 8601 when terminal
      "result": null,                        // short prose summary when done
      "error": null,                         // string when failed
      "source": "telegram"                   // telegram | terminal | other
    }
  ]
}
```

### Status transitions

```
pending → in_progress → done
                     ↘ failed → (retried) → in_progress → done
```

A `failed` item may be retried by flipping it back to `pending`; the
orchestrator decides retry policy (default: one auto-retry then surface).

## Design notes

See `docs/agent-orchestration-research.md` for the full rationale. Short
version: queue lives here (not in `~/.claude/`) so it travels with the repo
and is the same on any machine. Adds happen via `/queue add "..."` from the
terminal, or via the orchestrator session picking up Telegram messages and
appending on the user's behalf. **Dispatch is not part of v1** — the
orchestrator session reads the queue manually for now.
