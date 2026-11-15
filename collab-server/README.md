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

## Room lifecycle

When the last client leaves a room, the room's alarm is set for
`ROOM_IDLE_DAYS` later (default 30; set it under `[vars]` to change it,
fractions work for tests). If nobody has joined by then, the room's storage
is deleted and the next joiner finds an empty room, which its client seeds
from its own copy of the note (GitHub sync stays the source of truth). If
the last socket went without a close (deploy, runtime reset), the next
alarm sets the deadline instead. 30 days because the server copy only keeps
live sessions converging: a shorter period buys little privacy for a
personal vault and makes the one known doubling case (below) likelier.

- Known case: a tab that stayed open with its socket down for the whole
  idle period still holds the old CRDT history. If another page re-seeds
  the wiped room first, the merge can show the body twice. Nothing is
  lost; the user deletes the extra copy (`src/__tests__/collabExtension.test.ts`,
  "WIPED ROOM").
- A document over the 2 MB storage value cap still fails to persist (as
  before), now with a `[collab] persist failed` log line, and it still
  expires on time.

### One-off sweep of rooms from before the alarm

Rooms stored before this version have no alarm and never wake by
themselves. `scripts/sweep-rooms.mjs` lists the namespace's objects with
the wrangler login and arms the idle clock on every one that holds data,
through `POST /admin/rooms/<object id>/arm`. Nothing is deleted at sweep
time: each room goes `ROOM_IDLE_DAYS` later unless someone joins it, so no
usage data is needed. The route answers 404 unless the `ADMIN_TOKEN`
secret is set, and also when it equals `AUTH_TOKEN`. A room with someone
in it is left alone; its last leave arms it.

```bash
npx wrangler secret put ADMIN_TOKEN       # a new random value, not AUTH_TOKEN
node scripts/sweep-rooms.mjs              # dry run: how many rooms hold data
read -rs COLLAB_ADMIN_TOKEN && export COLLAB_ADMIN_TOKEN
node scripts/sweep-rooms.mjs --apply      # arms each, prints a tally
npx wrangler secret delete ADMIN_TOKEN    # close the route again
```

## Costs and limits

- Workers **free plan** is enough: the config uses SQLite-backed Durable
  Objects (`new_sqlite_classes`), which the free tier includes.
  100k requests/day and 5 GB storage — a personal vault does not get
  anywhere near either. Rooms use the WebSocket Hibernation API, so an
  idle open tab does not burn the daily Durable Object duration limit.
- Rooms persist their document to Durable Object storage (debounced
  3 s via a DO alarm, flushed when the last client leaves), so state survives object
  eviction, and delete it after `ROOM_IDLE_DAYS` with nobody connected
  (see "Room lifecycle"). GitHub sync remains the source of truth for note bodies;
  this store only keeps live sessions converging.
- Abuse limits (`src/limits.ts`) bound a single room: 1 MB max message
  size, 20 max connections, 200 messages/second per connection. Override
  with the `MAX_MESSAGE_BYTES` / `MAX_CONNECTIONS_PER_ROOM` /
  `MAX_MESSAGES_PER_WINDOW` / `WINDOW_MS` wrangler vars if a real
  workload needs different numbers.

## Origin allowlist

`ALLOWED_ORIGINS` (a `[vars]` entry in `wrangler.toml`) lists the browser
origins that may open a socket; anything else gets `403 Forbidden origin`
before a room is touched. Entries are full origins, space or comma
separated, and `*` matches one run of `[a-z0-9]` (no hyphen, no dot),
which is the shape of this project's Vercel deployment URLs. Unset or empty
= no check.

The list is every host that serves a noteser build whose CSP carries the
collab ws source, read from the public responses on 2026-11-15: the
production build on `noteser.app`, `noteser.vercel.app`,
`noteser-ipapakonstantinous-projects.vercel.app` and
`noteser-git-main-ipapakonstantinous-projects.vercel.app` (same build id),
the dev-branch build on `beta.`, `dev.` and
`noteser-git-dev-ipapakonstantinous-projects.vercel.app`, per-deployment URLs
`noteser-<hash>-ipapakonstantinous-projects.vercel.app`, and local dev.
Feature-branch aliases (`noteser-git-<branch>-…`) are refused: open a PR's
deployment URL instead. `www.` only redirects. A new domain or alias on the
Vercel project must be added here, or its live-collab tabs get 403 and retry.

- A handshake with **no** `Origin` header passes: browsers always send one
  on a WebSocket upgrade and a page cannot remove it, so a missing header
  means a non-browser client (a script, a test), which could put any value
  there anyway. The check stops foreign web pages, not determined clients.
- `Origin: null` (sandboxed iframe, `file:`, `data:`) is refused.
- The deployment wildcard admits `noteser-<letters/digits>-ipapakonstantinous-projects.vercel.app`.
  A stranger who gets a Vercel project domain of exactly that shape would
  pass; that only gives them what a non-browser client already has.
- Local `wrangler dev` reads the same list; override it in `.dev.vars`.

## Security notes

- `AUTH_TOKEN` is a *soft* gate: it ships inside the public client
  bundle (it is a `NEXT_PUBLIC_*` var), so it keeps strangers from
  connecting to your worker by guessing the URL — it is not real auth.
  Fine for a personal vault; rotate it by setting a new secret +
  updating the Vercel var.
- Room names are note collab ids, not note content. Document content
  does transit and rest on your Cloudflare account (encrypted at rest).
