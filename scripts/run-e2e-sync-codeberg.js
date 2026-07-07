// Runner for the live Codeberg/Forgejo-sync E2E harness
// (src/__tests__/e2eSyncLiveCodeberg.test.ts).
//
// Loads the test token from ~/.config/noteser/codeberg-test-token.env into the
// environment, then execs jest on ONLY that test file. The token value is
// never printed, echoed, or passed on the command line — it is read from the
// file and handed to the child process via its environment.
//
// Usage: npm run e2e:sync:codeberg

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const TOKEN_FILE = path.join(
  os.homedir(),
  '.config',
  'noteser',
  'codeberg-test-token.env'
)
const TOKEN_KEY = 'CODEBERG_TEST_TOKEN'

function loadTokenEnv() {
  let raw
  try {
    raw = fs.readFileSync(TOKEN_FILE, 'utf8')
  } catch {
    console.error(`[e2e:sync:codeberg] Token file not found at ${TOKEN_FILE}.`)
    console.error(
      '[e2e:sync:codeberg] The live harness needs CODEBERG_TEST_TOKEN to run.'
    )
    process.exit(1)
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    // Strip surrounding quotes if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key) process.env[key] = val
  }
  if (!process.env[TOKEN_KEY]) {
    console.error(
      `[e2e:sync:codeberg] ${TOKEN_KEY} not present in ${TOKEN_FILE}.`
    )
    process.exit(1)
  }
}

loadTokenEnv()

// Run jest on just the Codeberg harness file, runInBand to respect Codeberg's
// burst rate-limit, verbose so each scenario's per-test log lines are visible.
const result = spawnSync(
  process.execPath,
  [
    path.join('node_modules', '.bin', 'jest'),
    'e2eSyncLiveCodeberg',
    '--verbose',
    '--runInBand'
  ],
  { stdio: 'inherit', env: process.env }
)

process.exit(result.status ?? 1)
