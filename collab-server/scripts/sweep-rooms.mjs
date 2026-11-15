#!/usr/bin/env node
// One-off sweep: rooms stored before the idle alarm existed have no alarm and
// never wake by themselves. This lists the YRoom objects through the
// Cloudflare API with the wrangler login and arms the idle clock on every one
// that holds data, so each is deleted ROOM_IDLE_DAYS later unless someone
// joins it first. Nothing is deleted now, so no usage data is needed.
//
//   node scripts/sweep-rooms.mjs                          # dry run: counts
//   COLLAB_ADMIN_TOKEN=... node scripts/sweep-rooms.mjs --apply
//
// Options: --base https://collab.noteser.app, CF_ACCOUNT_ID env when the
// login sees more than one account. Never prints a token.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const API = 'https://api.cloudflare.com/client/v4'

// Errors this script raises carry safe text. Anything else (e.g. fetch
// rejecting a header value) may echo a token, so only its name is printed.
class SweepError extends Error {}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}

// `label` names the call in errors, so no id or token reaches the console.
async function cf(token, label, path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.success === false) {
    throw new SweepError(`Cloudflare API ${label} -> ${res.status} ${JSON.stringify(body?.errors ?? '')}`)
  }
  return body
}

async function main() {
  const base = arg('base', 'https://collab.noteser.app').replace(/\/+$/, '')
  const apply = process.argv.includes('--apply')
  const toml = readFileSync(homedir() + '/.config/.wrangler/config/default.toml', 'utf8')
  const token = (toml.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1]
  if (!token) throw new SweepError('no wrangler oauth_token: run `npx wrangler login`')

  const accounts = (await cf(token, 'accounts', '/accounts?per_page=50')).result
  const account = process.env.CF_ACCOUNT_ID ?? (accounts.length === 1 ? accounts[0].id : null)
  if (!account) throw new SweepError('several accounts visible: set CF_ACCOUNT_ID')
  const ns = (await cf(token, 'namespaces', `/accounts/${account}/workers/durable_objects/namespaces`)).result
    .find(n => n.script === 'noteser-collab' && n.class === 'YRoom')
  if (!ns) throw new SweepError('YRoom namespace of noteser-collab not found')

  const stored = []
  let total = 0
  let cursor = ''
  do {
    const page = await cf(token, 'objects', `/accounts/${account}/workers/durable_objects/namespaces/${ns.id}/objects?limit=10000${cursor ? `&cursor=${cursor}` : ''}`)
    for (const o of page.result) {
      total++
      if (o.hasStoredData) stored.push(o.id)
    }
    cursor = page.result_info?.cursor ?? ''
  } while (cursor)
  console.log(`objects=${total} with data=${stored.length}: arm the idle clock on each`)
  if (!apply) return console.log('dry run: pass --apply with COLLAB_ADMIN_TOKEN set to do it')

  const admin = process.env.COLLAB_ADMIN_TOKEN
  if (!admin) throw new SweepError('COLLAB_ADMIN_TOKEN is not set')
  const tally = {}
  for (const id of stored) {
    const res = await fetch(`${base}/admin/rooms/${id}/arm`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` } })
    const outcome = res.ok ? await res.text() : `HTTP ${res.status}`
    tally[outcome] = (tally[outcome] ?? 0) + 1
    if (!res.ok) console.log(`arm ${id} -> ${outcome}`)
  }
  console.log(JSON.stringify(tally))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err instanceof SweepError ? err.message : `failed: ${err?.name ?? 'error'} (message withheld, it may contain a token)`)
    process.exit(1)
  })
}
