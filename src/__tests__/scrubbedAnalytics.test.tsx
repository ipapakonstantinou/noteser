/**
 * @jest-environment jsdom
 *
 * The Vercel Analytics beacon posts location.href, fragment included. Every
 * event the component hands it (page views and custom events) must pass
 * through scrubShareSecrets first.
 */
import { render } from '@testing-library/react'

type BeforeSend = (event: { type: 'pageview' | 'event'; url: string }) => unknown
let mockBeforeSend: BeforeSend | undefined
jest.mock('@vercel/analytics/next', () => ({
  Analytics: (props: { beforeSend?: BeforeSend }) => {
    mockBeforeSend = props.beforeSend
    return null
  },
}))

import { ScrubbedAnalytics } from '../components/ScrubbedAnalytics'

test('page views and custom events leave without fragments or share params', () => {
  render(<ScrubbedAnalytics />)
  expect(mockBeforeSend).toBeDefined()
  expect(mockBeforeSend!({ type: 'pageview', url: 'https://noteser.app/share#eyJ0aXRsZSI6InNlY3JldCJ9' }))
    .toEqual({ type: 'pageview', url: 'https://noteser.app/share' })
  expect(mockBeforeSend!({ type: 'event', url: 'https://noteser.app/?import=eyJ0&collab=x&utm_source=hn#collab=y' }))
    .toEqual({ type: 'event', url: 'https://noteser.app/?utm_source=hn' })
})
