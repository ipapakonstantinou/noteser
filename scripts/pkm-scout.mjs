#!/usr/bin/env node
/**
 * pkm-scout.mjs
 *
 * Weekly scout: searches PKM/markdown-notes communities for unmet feature needs,
 * deduplicates against noteser's current features and open GitHub issues,
 * then files GitHub issues for genuine gaps.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY  — Anthropic API key with web_search access
 *   GITHUB_TOKEN       — GitHub token with issues:write on the target repo
 *
 * Optional env vars:
 *   GITHUB_REPO        — owner/repo (default: ipapakonstantinou/noteser)
 */

import Anthropic from "@anthropic-ai/sdk";

const REPO = process.env.GITHUB_REPO ?? "ipapakonstantinou/noteser";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function githubRequest(path, options = {}) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchOpenIssues() {
  const issues = [];
  let page = 1;
  while (true) {
    const batch = await githubRequest(
      `/repos/${REPO}/issues?state=open&per_page=100&page=${page}`
    );
    if (!batch || batch.length === 0) break;
    for (const issue of batch) {
      // GitHub returns PRs in the issues endpoint; skip them
      if (!issue.pull_request) {
        issues.push({ number: issue.number, title: issue.title });
      }
    }
    if (batch.length < 100) break;
    page++;
  }
  return issues;
}

async function createIssue(title, body) {
  const issue = await githubRequest(`/repos/${REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels: ["pkm-scout"] }),
  });
  return issue.html_url;
}

// ── Anthropic agentic loop ────────────────────────────────────────────────────

const NOTESER_FEATURES = `
Current noteser features (do NOT file issues for things already supported):
- Markdown editing with CodeMirror 6, live preview (Obsidian-style)
- Wikilinks [[page]] with autocomplete and hover preview
- Obsidian-style #hashtag tags derived from note bodies
- Sidebar: folder tree, calendar (daily notes), tags view, trash
- GitHub sync: full three-way merge, conflict resolution with inline VS Code-style diff
- Split editor (up to 2 panes), tab bar with VS Code-style preview tabs
- Fuzzy full-text search (Fuse.js, Ctrl+K)
- Task management: checkboxes, completion stamps, live tasks query blocks aggregating across vault
- Export: Markdown, JSON, HTML (zip)
- Templates modal, keyboard shortcuts modal
- Soft-delete / trash with restore
- Real-time collaboration via Yjs (opt-in, requires self-hosted WS server)
- Dark mode by default, Tailwind/Obsidian-inspired palette
- PWA-ready (Next.js static export)
- Drag-and-drop: notes between folders, tabs between panes
`;

function buildPrompt(openIssues) {
  const issueList =
    openIssues.length === 0
      ? "  (none)"
      : openIssues.map((i) => `  #${i.number}: ${i.title}`).join("\n");

  return `You are a product researcher for noteser, a browser-based Obsidian-style markdown notes app that uses GitHub as its storage layer (every note is a .md file in a user-owned GitHub repo). Your job: scan PKM and markdown-notes communities RIGHT NOW for pain points and unmet feature needs that noteser doesn't already handle.

${NOTESER_FEATURES}

Already-open noteser GitHub issues (skip anything that overlaps):
${issueList}

Search the following sources for NEW unmet needs (published within the last ~6 months where possible):
- Reddit: r/ObsidianMD, r/logseq, r/PKMS, r/Zettelkasten — sort by top/hot, look for requests, frustrations, or "I wish" threads
- forum.obsidian.md — Feature requests category, top/most-voted
- GitHub Discussions/Issues: obsidianmd/obsidian-releases, logseq/logseq, silverbulletmd/silverbullet, siyuan-note/siyuan, streetwriters/notesnook, laurent22/joplin — filter for feature requests
- Hacker News: search "tools for thought", "PKM", "note-taking", "Obsidian" — look for "Ask HN" threads or comments describing friction

For each source, search for the most upvoted/discussed recent requests. Look for cross-community patterns: a need that appears in multiple communities is a stronger signal.

After researching, return a JSON object (no markdown, no code fences — raw JSON only) in this exact format:

{
  "items": [
    {
      "title": "Short feature name (5-8 words)",
      "what_users_want": "2-3 sentence description of the pain point and what they're asking for.",
      "quote": "Exact quote from a real user post",
      "quote_source_url": "https://...",
      "demand_signal": "Which communities/how many posts, e.g. '12 upvoted Reddit threads + 3 forum.obsidian.md requests'",
      "noteser_fit": "High|Med|Low",
      "noteser_fit_reason": "One sentence on why it fits or doesn't given GitHub-as-storage + browser model",
      "how_noteser_could_do_it": "One sentence implementation hint"
    }
  ]
}

Rules:
- Only include items that are GENUINELY NEW gaps — not covered by existing noteser features or open issues listed above.
- Limit to 3-5 high-signal items MAX. Quality over quantity. If nothing genuinely new is found, return {"items": []}.
- noteser_fit = High means the feature aligns naturally with a browser-based, GitHub-backed notes app.
- noteser_fit = Low means it would require native/desktop APIs or fundamentally conflicts with the browser/GitHub model.
- The quote must be real — from an actual post you found. Include the exact source URL.
- Do not invent quotes or URLs.`;
}

async function runScout(openIssues) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const messages = [
    {
      role: "user",
      content: buildPrompt(openIssues),
    },
  ];

  const tools = [
    {
      type: "web_search_20260209",
      name: "web_search",
    },
  ];

  let response;
  // Agentic loop: re-send on pause_turn (server hit iteration limit)
  while (true) {
    response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      tools,
      messages,
    });

    console.log(`stop_reason: ${response.stop_reason}`);

    if (response.stop_reason === "end_turn") break;

    if (response.stop_reason === "pause_turn") {
      // Server wants to continue; append assistant turn and re-send
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: "Please continue.",
      });
      continue;
    }

    if (response.stop_reason === "tool_use") {
      // Should not happen with server-side web_search — but handle defensively
      messages.push({ role: "assistant", content: response.content });
      const toolResults = response.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: "No result available for client-executed tool.",
        }));
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Unexpected stop reason — bail
    console.error(`Unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  return response;
}

// ── Parse Claude's JSON response ──────────────────────────────────────────────

function parseItems(response) {
  const textBlocks = response.content.filter((b) => b.type === "text");
  const raw = textBlocks.map((b) => b.text).join("");

  // Strip any accidental markdown code fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.items)) {
      console.error("Unexpected JSON shape:", cleaned.slice(0, 500));
      return [];
    }
    return parsed.items;
  } catch (err) {
    console.error("Failed to parse JSON:", err.message);
    console.error("Raw output:", cleaned.slice(0, 1000));
    return [];
  }
}

// ── Format GitHub issue body ──────────────────────────────────────────────────

function formatIssueBody(item) {
  return `## What users want

${item.what_users_want}

## User quote

> ${item.quote}

Source: ${item.quote_source_url}

## Demand signal

${item.demand_signal}

## noteser fit: ${item.noteser_fit}

${item.noteser_fit_reason}

## How noteser could do it

${item.how_noteser_could_do_it}

---
*Filed automatically by pkm-scout — weekly PKM community scan.*`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== pkm-scout starting ===");
  console.log(`Repo: ${REPO}`);
  console.log(`Date: ${new Date().toISOString()}`);

  console.log("\nFetching open issues from GitHub...");
  const openIssues = await fetchOpenIssues();
  console.log(`Found ${openIssues.length} open issue(s).`);

  console.log("\nRunning Claude web search scout...");
  const response = await runScout(openIssues);

  console.log("\nParsing results...");
  const items = parseItems(response);
  console.log(`Parsed ${items.length} new gap(s).`);

  if (items.length === 0) {
    console.log("Nothing genuinely new found — no issues will be filed.");
    return;
  }

  console.log("\nFiling GitHub issues...");
  for (const item of items) {
    const title = `[pkm-scout] ${item.title}`;
    const body = formatIssueBody(item);
    try {
      const url = await createIssue(title, body);
      console.log(`  Created: ${url}`);
    } catch (err) {
      console.error(`  Failed to create issue "${title}": ${err.message}`);
    }
  }

  console.log("\n=== pkm-scout done ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
