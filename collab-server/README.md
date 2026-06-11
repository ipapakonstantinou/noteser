# noteser collab server

Live-collaboration backend for noteser: a y-websocket-compatible sync
server running on **Cloudflare Workers + Durable Objects**. One Durable
Object per room (= per note) holds the shared Yjs document, the cursor
presence, and the connected sockets.

**Vercel carries none of this.** Vercel cannot terminate WebSockets at
all — it keeps serving the static app and the two OAuth proxy routes
exactly as before. All collab traffic goes browser → this worker.

The noteser client side already exists (`src/components/editor/collabExtension.ts`,
`src/hooks/useCollaboration.ts`) and stays completely dormant unless
`NEXT_PUBLIC_YJS_WS_URL` is set.

## Deploy (once, ~5 minutes)

```bash
cd collab-server
npm install
npx wrangler login                  # opens browser, authorizes your Cloudflare account
npx wrangler secret put AUTH_TOKEN  # paste a long random string (optional but recommended)
npm run deploy
```

`wrangler deploy` prints the worker URL, e.g.
`https://noteser-collab.<account>.workers.dev`.

## Wire it to noteser

In Vercel → Project → Settings → Environment Variables, add:

```
NEXT_PUBLIC_YJS_WS_URL = wss://noteser-collab.<account>.workers.dev/<AUTH_TOKEN>
```

(without the `/<AUTH_TOKEN>` suffix if you skipped the secret), then
redeploy. The CSP `connect-src` picks the origin up automatically at
build time (`deriveCollabWsOrigin`). The status bar shows a green
"Live: on" pill once connected; open the same note in two browsers and
you will see each other's cursors.

## Costs and limits

- Workers **free plan** is enough: the config uses SQLite-backed Durable
  Objects (`new_sqlite_classes`), which the free tier includes.
  100k requests/day and 5 GB storage — a personal vault does not get
  anywhere near either.
- Rooms persist their document to Durable Object storage (debounced
  3 s, flushed when the last client leaves), so state survives object
  eviction. GitHub sync remains the source of truth for note bodies;
  this store only keeps live sessions converging.

## Security notes

- `AUTH_TOKEN` is a *soft* gate: it ships inside the public client
  bundle (it is a `NEXT_PUBLIC_*` var), so it keeps strangers from
  connecting to your worker by guessing the URL — it is not real auth.
  Fine for a personal vault; rotate it by setting a new secret +
  updating the Vercel var.
- Room names are note collab ids, not note content. Document content
  does transit and rest on your Cloudflare account (encrypted at rest).
