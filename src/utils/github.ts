import type { GitHubUser } from '@/types'

export interface DeviceFlowStart {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export class DeviceFlowError extends Error {
  constructor(public code: 'expired' | 'denied' | 'config' | 'network' | 'aborted' | 'unknown', message: string) {
    super(message)
    this.name = 'DeviceFlowError'
  }
}

// ── Step 1: ask the proxy to request a device code from GitHub ──────────────
export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch('/api/github/device-code', { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    if (json.error === 'missing_client_id') {
      throw new DeviceFlowError('config', json.error_description ?? 'GitHub Client ID not configured')
    }
    throw new DeviceFlowError('network', json.error_description ?? `Device-code request failed (${res.status})`)
  }
  return json
}

interface PollOptions {
  deviceCode: string
  interval: number       // seconds (from GitHub)
  expiresIn: number      // seconds (from GitHub)
  signal: AbortSignal    // so the caller can cancel the loop
}

// ── Step 2: poll the proxy until the user authorizes or the code expires ────
export async function pollForToken({ deviceCode, interval, expiresIn, signal }: PollOptions): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000
  let currentInterval = interval

  while (Date.now() < deadline) {
    if (signal.aborted) throw new DeviceFlowError('aborted', 'Polling aborted')
    await sleep(currentInterval * 1000, signal)

    const res = await fetch('/api/github/access-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    })
    const json = await res.json().catch(() => ({}))

    if (json.access_token) return json.access_token as string

    switch (json.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        currentInterval += 5
        continue
      case 'expired_token':
        throw new DeviceFlowError('expired', 'The device code expired. Please try again.')
      case 'access_denied':
        throw new DeviceFlowError('denied', 'Authorization was denied.')
      case 'missing_client_id':
        throw new DeviceFlowError('config', 'GitHub Client ID not configured.')
      default:
        throw new DeviceFlowError('unknown', json.error_description ?? json.error ?? 'Unexpected error')
    }
  }
  throw new DeviceFlowError('expired', 'Device code expired before authorization completed.')
}

// ── Step 3: use the token to fetch identifying info ─────────────────────────
export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`)
  const data = await res.json()
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url,
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DeviceFlowError('aborted', 'Aborted'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DeviceFlowError('aborted', 'Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
