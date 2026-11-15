'use client'

import { Analytics } from '@vercel/analytics/next'
import { scrubShareSecrets } from '@/utils/collabShare'

// Client wrapper: a server layout cannot hand Analytics a beforeSend function.
export function ScrubbedAnalytics() {
  return <Analytics beforeSend={event => ({ ...event, url: scrubShareSecrets(event.url) })} />
}
