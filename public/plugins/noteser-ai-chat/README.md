# noteser-ai-chat

Chat with an OpenAI or Anthropic model over your vault, from inside
Noteser. Built as a plugin on top of the v1.2 plugin API (issue #70).

## What it does

- Opens a fullscreen chat panel via the command palette
  (`Open AI chat`).
- Bring your own key — OpenAI or Anthropic. The plugin sends requests
  directly from your browser to the provider; the noteser app never
  proxies them.
- Streams the response token-by-token so you see the answer as it
  arrives.
- Optionally injects context from your vault using a keyword-based
  retrieval pass (V1 — see "What's next" below). The top 5 matching
  notes get truncated to about 500 characters each and added to the
  system prompt.
- Save any conversation back into your vault as a new note (`Save chat
  as note` in the toolbar).

## Setup

1. Install the plugin (Settings → Plugins → Add plugin from URL, paste
   the path to `manifest.json`).
2. Grant the three permissions the plugin asks for:
   - `vault.read.all` — needed for the RAG context pass.
   - `vault.write` — needed for "Save chat as note".
   - `file-save` — reserved for a later "export chat as markdown
     file" entry; safe to grant.
3. Open the chat (command palette → `Open AI chat`).
4. Click `Settings` and paste your API key. Pick a provider and model.

## Provider notes

| Provider | Default model | Other models | Endpoint |
| --- | --- | --- | --- |
| OpenAI | `gpt-4o-mini` | `gpt-4o` | `POST https://api.openai.com/v1/chat/completions` |
| Anthropic | `claude-sonnet-4-6` | `claude-haiku-4-5` | `POST https://api.anthropic.com/v1/messages` |

Streaming uses Server-Sent Events; both providers speak the same
`data: {...}\n\n` shape. The plugin decodes either provider's deltas.

## RAG approach (V1)

V1 ranks notes by **BM25-lite keyword scoring**. No embeddings, no
vector DB, no external retrieval service.

1. Extract a bag-of-words from your prompt. Lowercase, strip
   punctuation, drop a small inline list of ~50 stopwords.
2. Snapshot every note via `ctx.vault.read.getAllNotes()` (cached for
   30 seconds per session).
3. Score each note: `Σ idf(term) × tf / (tf + 1)`. Title hits weigh
   2× body hits. Sorted descending.
4. Top 5 notes' bodies (truncated to about 500 chars) are stitched
   into a system message that asks the model to cite them by title.

If you flip "Include vault context" off in Settings, none of the above
runs — the chat is just a plain LLM call.

## Privacy

- Your API key lives **unencrypted in localStorage** via the plugin's
  per-plugin settings namespace. Do not paste a key on a shared
  machine. Use the `Clear saved key` button in Settings when you are
  done.
- Nothing leaves your browser until you click `Send`. The plugin's
  audit trail (Settings → Plugins → Audit log) records `vault.write`
  operations only — never your prompts, never the responses, never
  the key.
- Noteser core does not see your prompts. The browser talks straight
  to the provider.

## What's next (V2 roadmap)

- **Embeddings-based retrieval.** Noteser already ships
  `src/utils/embeddings.ts` + `src/utils/aiClient.ts` in core. A V2
  pass would use those for semantic recall instead of keyword
  scoring. Lands when the plugin platform exposes a `compute.embed`
  capability (or when the plugin grows its own bundled embedding
  model — both options are open).
- **Citations as wikilinks.** Today the assistant is asked to cite by
  title; V2 will rewrite `[Title]` runs into clickable VNode `link`
  nodes that jump to the source note.
- **Per-conversation system prompt customisation.** V1 ships a single
  built-in system prompt; V2 will let the user override it from
  Settings.
- **Network-permission gate.** v1.2 has no `network.fetch` permission,
  so today the plugin reaches the providers via the worker's ambient
  `fetch` global. A future v1.3 `network.fetch` permission with an
  explicit allowlist (`api.openai.com`, `api.anthropic.com`) will
  make the network surface explicit in the install modal.

## Limits

- Vault snapshot for RAG is capped by the host at 4 MiB; very large
  vaults need the stream API (deferred to V2).
- Streaming response size is capped at ~2 MiB.
- Tested with `gpt-4o-mini` and `claude-sonnet-4-6`. Other models in
  the same families should work as long as their streaming shape
  matches.
