import '@testing-library/jest-dom'

// jsdom doesn't ship TextEncoder/TextDecoder globally — code that uses
// them (shareLink, embeds, etc) needs them present in the test env.
import { TextEncoder, TextDecoder } from 'util'
if (!global.TextEncoder) global.TextEncoder = TextEncoder
if (!global.TextDecoder) global.TextDecoder = TextDecoder
