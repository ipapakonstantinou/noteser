import '@testing-library/jest-dom'

// jsdom doesn't ship TextEncoder/TextDecoder globally — code that uses
// them (shareLink, embeds, etc) needs them present in the test env.
import { TextEncoder, TextDecoder } from 'util'
if (!global.TextEncoder) global.TextEncoder = TextEncoder
if (!global.TextDecoder) global.TextDecoder = TextDecoder

// jsdom drops Response/Headers/Request — Node 18+ has them on globalThis
// natively (via undici, but as built-ins), so we restore them here. We
// intentionally do NOT polyfill global.fetch — tests that need it
// jest.fn() it explicitly so mocks are unambiguous.
if (typeof global.Response === 'undefined' && typeof globalThis.Response !== 'undefined') {
  global.Response = globalThis.Response
  global.Headers = globalThis.Headers
  global.Request = globalThis.Request
}
