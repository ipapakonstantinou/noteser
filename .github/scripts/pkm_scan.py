#!/usr/bin/env python3
"""
Weekly PKM community scan.

Runs on cron 0 9 * * 1 (Mondays 09:00 UTC) via GitHub Actions.
Finds new unmet needs in the PKM / markdown-notes community, deduplicates
against noteser's existing features and open issues, and files GitHub issues
for genuinely new gaps only.

Requires env vars: ANTHROPIC_API_KEY, GITHUB_TOKEN.
"""

import json
import os
import re
import sys

import anthropic
import requests

OWNER = "ipapakonstantinou"
REPO = "noteser"

# ---- Existing noteser features -------------------------------------------- #
# Keep this list current. The more accurate it is, the less Claude re-files
# things that are already built.
EXISTING_FEATURES = """\
- GitHub as storage backend: every note is a plain .md file in a user-owned repo
- Three-way merge with VS Code-style inline diff, per-hunk accept yours / theirs / both
- Live task query blocks (- [ ] syntax; Obsidian Tasks-compatible, completion stamps)
- Wikilinks with autocomplete
- Daily notes calendar view
- Fuzzy full-text search (title, content, tags via Fuse.js)
- Split pane editor: 2 horizontal panes, drag-and-drop tabs, cross-pane tab moves
- Soft-delete trash with restore
- Export to Markdown / JSON / HTML (per-note or ZIP bulk)
- CodeMirror live markdown preview (Obsidian Live Preview-style)
- Hashtag (#tag) support derived from note body
- Folder tree with drag-and-drop note reordering
- GitHub OAuth device-flow, pull-then-push sync
- Merge conflict resolution UI (VS Code-style merge tabs)
- Note templates
- Dark / light theme (Obsidian-inspired)
- Installable PWA with offline read cache (IndexedDB)
- Gist publishing: shareable public URL per note
- Keyboard shortcuts
"""

# ---- GitHub helpers -------------------------------------------------------- #

def _gh_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def get_all_open_issues(token: str) -> list[dict]:
    issues: list[dict] = []
    page = 1
    while True:
        r = requests.get(
            f"https://api.github.com/repos/{OWNER}/{REPO}/issues",
            headers=_gh_headers(token),
            params={"state": "open", "per_page": 100, "page": page},
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        issues.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return issues


def create_issue(token: str, title: str, body: str) -> dict:
    r = requests.post(
        f"https://api.github.com/repos/{OWNER}/{REPO}/issues",
        headers=_gh_headers(token),
        json={"title": title, "body": body},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


# ---- Claude research ------------------------------------------------------- #

def research_gaps(client: anthropic.Anthropic, issue_list: str) -> str:
    """
    Ask Claude (with web_search) to find new PKM community gaps.
    Returns the raw text response (expected to be a JSON array).
    """
    user_prompt = f"""\
Scan the PKM and markdown-notes community to find NEW unmet needs and feature requests
that noteser does not already cover.

## noteser existing features (already built -- do not suggest these):
{EXISTING_FEATURES}
## Already-tracked open issues (do not re-file -- skip anything semantically similar):
{issue_list}

## Sources to search:
- Reddit: r/ObsidianMD, r/logseq, r/PKMS, r/Zettelkasten
  (search recent top posts about pain points, "I wish", "missing", "why I left", feature requests)
- forum.obsidian.md -- top-voted feature requests not yet shipped by Obsidian
- GitHub issues / discussions on:
    obsidianmd/obsidian-releases, logseq/logseq, silverbulletmd/silverbullet,
    siyuan-note/siyuan, streetwriters/notesnook, laurent22/joplin
- Hacker News: "tools for thought", "note taking", "PKM" threads from the last 6 months

## Instructions:
1. Search systematically across all those sources.
2. Identify gaps that are GENUINELY NEW -- not covered by existing features or open
   issues above. Apply semantic matching, not just exact-string matching. For example,
   "better table editing" is the same as an existing "WYSIWYG table editing" issue -- skip it.
3. For each genuinely new gap collect:
   - A real verbatim user quote with an actual source URL you verified.
   - The communities where this need surfaces and rough frequency.
   - An honest assessment of how well it fits noteser's GitHub-as-storage + browser model.
   - A one-line implementation idea.

Return a JSON array of AT MOST 5 high-signal new gaps. Each item must follow this shape:
{{
  "title": "Short imperative verb phrase -- the feature name",
  "what_users_want": "Plain one-to-two sentence description of the unmet need",
  "quote": "Exact verbatim user quote",
  "quote_source_url": "https://...",
  "demand_signal": "Which communities flagged this and rough volume / recurrence",
  "noteser_fit": "High|Med|Low",
  "noteser_fit_reasoning": "One sentence why, given GitHub-as-storage + browser model",
  "how_noteser_could_do_it": "One-line implementation idea"
}}

If nothing is genuinely new, return an empty array: []
Return ONLY valid JSON -- no markdown fences, no prose, no other text."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8000,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 12}],
        messages=[{"role": "user", "content": user_prompt}],
    )

    # Collect all text blocks (web_search results are handled server-side;
    # the final answer is in the last text block).
    text_blocks = [
        block.text
        for block in response.content
        if getattr(block, "type", None) == "text"
    ]
    return text_blocks[-1] if text_blocks else "[]"


# ---- Parsing + formatting -------------------------------------------------- #

def parse_gaps(raw: str) -> list[dict]:
    cleaned = raw.strip()
    # Strip markdown code fences if the model added them
    cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n?```$", "", cleaned, flags=re.MULTILINE)
    cleaned = cleaned.strip()
    # Extract outermost JSON array
    m = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if m:
        cleaned = m.group()
    return json.loads(cleaned)


def format_issue_body(gap: dict) -> str:
    return (
        f"**Community gap.** Source: weekly PKM community scan.\n\n"
        f"**What users want:** {gap['what_users_want']}\n\n"
        f"**Evidence:**\n"
        f"> \"{gap['quote']}\"\n"
        f"> --- {gap['quote_source_url']}\n\n"
        f"**Demand:** {gap['demand_signal']}\n\n"
        f"**noteser fit:** {gap['noteser_fit']} --- {gap['noteser_fit_reasoning']}\n\n"
        f"**How noteser could do it:** {gap['how_noteser_could_do_it']}"
    )


# ---- Entry point ----------------------------------------------------------- #

def main() -> None:
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    github_token = os.environ.get("GITHUB_TOKEN", "")

    if not anthropic_key or not github_token:
        print("ERROR: ANTHROPIC_API_KEY and GITHUB_TOKEN must be set.", file=sys.stderr)
        sys.exit(1)

    # 1. Fetch current open issues for live dedup
    print("Fetching open issues from GitHub...")
    open_issues = get_all_open_issues(github_token)
    issue_titles = [i["title"] for i in open_issues]
    issue_list = "\n".join(f"- {t}" for t in issue_titles)
    print(f"  {len(issue_titles)} open issues found.")

    # 2. Research communities via Claude + web search
    print("Researching PKM communities via Claude + web search...")
    client = anthropic.Anthropic(api_key=anthropic_key)
    raw = research_gaps(client, issue_list)
    print(f"  Raw response ({len(raw)} chars):")
    print(raw[:800] + ("..." if len(raw) > 800 else ""))

    # 3. Parse
    try:
        gaps = parse_gaps(raw)
    except (json.JSONDecodeError, AttributeError) as exc:
        print(f"ERROR: Could not parse JSON response: {exc}", file=sys.stderr)
        print(f"Full raw output:\n{raw}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsed {len(gaps)} new gap(s).")

    if not gaps:
        print("Nothing new to file. Exiting cleanly.")
        return

    # 4. Create issues for genuine new gaps
    for gap in gaps:
        title = gap.get("title", "").strip()
        if not title:
            print("  Skipping item with empty title.")
            continue

        # Last-resort local dedup guard (semantic dedup is done by Claude,
        # this catches trivially identical titles in case of prompt drift).
        title_lower = title.lower()
        if any(
            title_lower in existing.lower() or existing.lower() in title_lower
            for existing in issue_titles
        ):
            print(f"  Skipping (near-duplicate detected locally): {title}")
            continue

        body = format_issue_body(gap)
        issue = create_issue(github_token, title, body)
        print(f"  Created issue #{issue['number']}: {title}")

    print("Done.")


if __name__ == "__main__":
    main()
