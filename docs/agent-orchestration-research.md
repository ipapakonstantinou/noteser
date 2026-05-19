# Agent orchestration — research notes

Working notes for designing an orchestrator that queues incoming requests and
dispatches them to subagents in parallel. Not a spec — a reference for the
design conversation.

## TL;DR — recommended shape

For our case (one user, Telegram + terminal entry points, work happens inside
this `noteser` repo), the lightest path that matches the state of the art is:

1. **Orchestrator-worker pattern** (Anthropic's canonical recommendation for
   open-ended, dynamically-decomposed work).
2. **Built on Claude Code subagents** — markdown configs in `.claude/agents/`,
   invoked via the `Agent` tool. Zero new infra.
3. **Queue lives in a JSON file** under `.claude/orchestrator/queue.json`
   (project-local, checked into git so it survives machine swaps). Read/written
   by a `/queue` slash command and a `UserPromptSubmit` hook.
4. **Telegram is just another entry point** — the existing MCP server already
   delivers messages into the running session; the orchestrator treats those
   messages the same as terminal slash commands.

Build it incrementally — start with the queue + dispatch loop, layer hooks
later. **Do not** start with agent teams (experimental, ~15× token cost) or a
standalone Agent SDK service (overkill for a single user).

## The five canonical workflow patterns

From [Anthropic — Building Effective Agents][bea]. Use these as a vocabulary:

| Pattern | What it is | When to use | When NOT to use |
|---|---|---|---|
| **Prompt chaining** | Fixed sequence of LLM calls, output of N feeds N+1, validation gates between | Tasks with clear, known substeps | Steps depend on unpredictable outcomes |
| **Routing** | Classifier LLM picks one of N downstream handlers | Distinct categories, each benefits from its own prompt/model/tools | Homogeneous tasks; or classifier itself is unreliable |
| **Parallelization** | Same task in parallel (voting) or split work into pieces (sectioning), aggregate | Speed gain from independence, OR confidence gain from multiple perspectives | When focused sequential reasoning beats aggregation |
| **Orchestrator-workers** | Central LLM dynamically decomposes the task, spawns workers, synthesises results | Open-ended problems where subtasks emerge from the input | Well-structured tasks with known decomposition (use chaining) |
| **Evaluator-optimizer** | One LLM generates, another critiques in a loop until criteria met | Clear evaluation criteria, iteration demonstrably improves output | Vague criteria; or feedback doesn't move the needle |

[Anthropic's headline guidance][bea]: *"The most successful implementations
use simple, composable patterns rather than complex frameworks. Find the
simplest solution possible, and only increase complexity when needed. This
might mean not building agentic systems at all."*

## Agents vs workflows

A **workflow** = LLMs orchestrated through predefined code paths. A **workflow
agent** = LLMs dynamically directing their own process and tool use, looping
until done.

| Choose **agents** when | Choose **workflows** when |
|---|---|
| Open-ended problems, unpredictable solution path | Known decision points and shape |
| Can't hardcode the path | Predictability and consistency matter more than flexibility |
| Trusted environment with sandboxing and guardrails | Need cost / behaviour determinism |

For *our* queue→dispatch case, the orchestrator itself is an agent (it
decides what to spawn), but each spawned worker is closer to a workflow (we
hand it a specific brief).

## Lessons from Anthropic's own multi-agent research system

The deep reference is [How we built our multi-agent research system][mars].
The lead agent (Opus 4) + subagent (Sonnet 4) version beat single-agent Opus
4 by **+90.2%** on internal research evals. Production lessons that
generalise:

1. **Token cost is real.** Agents use ~4× tokens of chat; multi-agent systems
   use ~15×. *"Multi-agent systems require tasks where the value is high
   enough to pay for the increased performance."* Reserve for high-value work.

2. **Subagent briefs must be explicit** — objective, output format, tool
   preferences, task boundaries. Vague briefs cause workers to duplicate each
   other or wander off. *"One subagent explored the 2021 automotive chip
   crisis while 2 others duplicated work investigating 2025 supply chains."*

3. **Scale effort to query complexity.** Embed rules: simple → 1 worker, 3-10
   tool calls. Comparison → 2-4 workers, 10-15 calls. Complex → 10+ workers.
   Without this, the orchestrator over-spawns.

4. **Parallel tool calls cut wall time by up to 90%.** Lead agent spawns
   workers in parallel, workers fire 3+ tools in parallel. (Claude Code's
   `Agent` tool already supports this — multiple tool_use blocks in one
   message.)

5. **State must persist outside the context window.** Lead agent writes the
   plan to external memory before delegating, so it can recover when conversa-
   tion exceeds 200k tokens. For us, this is the queue file + a `state.json`
   under `.claude/orchestrator/`.

6. **Failures compound.** Build resume-from-checkpoint, not restart-from-
   scratch. Let workers adapt to tool failures. Combine LLM judgement with
   deterministic safeguards (retry logic, max-iteration caps).

7. **Synchronous-only dispatch is the current ceiling.** Lead waits for all
   workers before continuing. Async coordination is hard (result reconciliation,
   state consistency). Accept this limitation initially.

8. **Most coding tasks are a bad fit** — fewer truly parallelisable subtasks
   than research. *"Some domains require all agents to share the same context
   or involve many dependencies between agents."* Plan for individual *user
   requests* in parallel, not pieces of one request.

## Claude Code subagent mechanics

Concrete tooling for the orchestrator. See [Claude Code subagents docs][cca].

**Define a subagent** — `.claude/agents/<name>.md`:

```markdown
---
name: docs-writer
description: Writes user-facing documentation. Invoke for tasks like "document
  the sync flow" or "write a user guide for tags".
tools: Read, Grep, Glob, Write, Edit
model: sonnet
---

You write clear, scannable documentation aimed at end users (not engineers).
Lead with what the feature does, then how to use it. Avoid implementation
detail unless it affects usage.
```

**Invoke from the orchestrator session** — use the `Agent` tool with
`subagent_type: "docs-writer"`. Multiple invocations in one tool-use block
run in parallel. Returns a summary string back to the parent session.

**Context isolation** — subagent sees `CLAUDE.md` + spawn prompt only; not
the parent conversation. This is a feature (prevents pollution) but means the
brief must be self-contained.

**Worktree isolation** — pass `isolation: "worktree"` to spawn the agent in a
temporary git worktree. Useful when several workers might touch overlapping
files. Auto-cleaned if no changes; otherwise returns branch + path.

**Tool allowlist** — `tools:` frontmatter restricts what the subagent can do.
Tighten for safety (e.g. researcher gets no `Edit`/`Write`).

**Slash commands as entry points** — `~/.claude/skills/<name>/SKILL.md`
(personal) or `.claude/skills/<name>/SKILL.md` (project). Frontmatter accepts
`disable-model-invocation: true` to make the command user-only.

**Hooks for queue ingestion** — `~/.claude/settings.json` or
`.claude/settings.json` can register `UserPromptSubmit`, `SessionStart`, etc.
A `UserPromptSubmit` hook can intercept matching messages, write them to the
queue, and return.

## Where Claude Agent SDK fits

The [Claude Agent SDK][sdk] (TypeScript/Python) is for **production AI
services** — hosted, multi-user, with managed sessions and external state.
Wrong tool for a single-user orchestrator running locally; overkill on infra.
Revisit only if the orchestrator needs to be reachable from non-Claude-Code
clients (e.g. a public Slack bot, a web app).

## Recommended architecture for our case

```
┌───────────────────────────────────────────────────────────────┐
│  Entry points                                                  │
│  • Telegram MCP  →  arrives as <channel> messages              │
│  • /queue add "..."  (slash command from terminal)             │
│  • Direct prompts in the running session                       │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │  Queue (JSON file)    │   .claude/orchestrator/queue.json
            │  • status: pending /  │   • git-tracked → survives machine swap
            │    in_progress / done │   • appended by /queue add + hook
            │  • brief, priority,   │
            │    created_at, ...    │
            └───────────┬───────────┘
                        │
                        ▼
        ┌─────────────────────────────────┐
        │  Orchestrator (this session)    │
        │  Inspects queue, decides:       │
        │   • inline   (trivial)          │
        │   • subagent (researched/scoped)│
        │   • worktree subagent (risky)   │
        │   • parallel batch (independent)│
        │  Writes results back to queue   │
        └───────────┬─────────────────────┘
                    │  Agent tool, parallel where possible
                    ▼
       ┌────────────┬────────────┬────────────┐
       │ Subagent A │ Subagent B │ Subagent C │   each: own context,
       │ (docs)     │ (refactor) │ (research) │   own tool allowlist,
       │            │ + worktree │            │   optional worktree
       └────────────┴────────────┴────────────┘
```

**Build order:**

1. **Queue file + `/queue` skill.** Add/list/remove. No dispatch yet. Single
   commit, fully testable.
2. **Manual dispatch from the orchestrator session.** I read the queue, pick
   the next item, decide inline vs subagent vs parallel, do the work, mark
   done. This is the MVP — it works *today*, no hooks needed.
3. **Subagent definitions.** Codify the workers we keep reaching for:
   `docs-writer`, `code-reviewer` (already builtin?), `researcher`,
   `refactorer`, etc. Tight tool allowlists.
4. **Auto-ingest hook** (`UserPromptSubmit`). If the prompt matches a queue-
   pattern (e.g. starts with `>>` or contains `[queue]`), append to queue and
   ack. Otherwise pass through.
5. **Telegram echo on completion.** Subagent results stream back via the
   Telegram MCP reply tool. Already trivial since the MCP is wired up.
6. **(Optional, later)** Background sessions (`claude --bg`) for fire-and-
   forget tasks that should outlive the parent session. Use sparingly — each
   one consumes quota independently.

**Anti-patterns to avoid up front:**

- Spawning subagents for trivial tasks. Token overhead isn't free; the
  research said agents use ~4× chat tokens.
- Vague briefs. Every subagent invocation should include objective, expected
  output format, allowed tools, scope boundary.
- Cross-subagent messaging. Not supported in Claude Code; subagents return to
  parent only. If you need workers to talk, you're probably in agent-teams
  territory (experimental, expensive).
- Premature persistence layer. The queue file is enough. Don't reach for SQLite
  or Redis until file-based contention is a real problem.

## Open design questions (decide before building)

1. **Queue scope.** Project-local (`.claude/orchestrator/queue.json` in
   `noteser`) or global (`~/.claude/orchestrator/queue.json`)? Project-local
   is simpler for v1; global needed if the orchestrator serves multiple repos.
2. **Hook vs explicit slash command.** Hook is invisible (convenience); slash
   command is explicit (control). Recommend explicit only for v1 — add the hook
   later once we trust the queue.
3. **Failure UX.** If a subagent fails partway, what does the orchestrator do?
   Auto-retry once, then surface to the user via Telegram? Mark `failed` and
   move on? Document the policy.
4. **Budget caps.** Hard limit on parallel subagent count per dispatch (3?
   5?). Token-budget caps per item.
5. **Result format.** Worker returns prose vs structured JSON? For Telegram
   pipe-back, prose is fine; for queue-state machines, structured is
   necessary.

## Sources

- [Anthropic — Building Effective Agents][bea] (Dec 2024) — the canonical
  pattern catalogue
- [Anthropic — How we built our multi-agent research system][mars] — engineering
  lessons from a real production system
- [Claude Code — Subagents docs][cca] — concrete subagent mechanics
- [Claude Agent SDK overview][sdk] — when to graduate beyond Claude Code

[bea]: https://www.anthropic.com/research/building-effective-agents
[mars]: https://www.anthropic.com/engineering/built-multi-agent-research-system
[cca]: https://docs.claude.com/en/docs/claude-code/sub-agents
[sdk]: https://docs.claude.com/en/api/agent-sdk/overview
