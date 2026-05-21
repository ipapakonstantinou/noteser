# `e2e/parity/` — qa-tester scratch dir

Per-scenario Playwright specs written by the `qa-tester` subagent (defined
in `.claude/agents/qa-tester.md`).

**This is not the main e2e suite.** Specs here are exploratory — they
encode scenarios from `../obsidian-parity.md` and may be flaky or
incomplete while the agent iterates. Specs that prove stable can be
**graduated** to the parent `e2e/` directory (manual decision; the agent
should propose, not move).

Run all parity specs with:

```bash
npx playwright test e2e/parity/
```

To clear the scratch dir between sweeps:

```bash
rm e2e/parity/*.spec.ts   # README stays
```

## Naming

One file per scenario, slug-cased to match the scenario heading in
`obsidian-parity.md`:

```
e2e/parity/create-note-via-button.spec.ts
e2e/parity/live-preview-headings.spec.ts
...
```
