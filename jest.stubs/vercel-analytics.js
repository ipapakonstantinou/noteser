// Jest stub for @vercel/analytics. The real package ships ESM only and
// trips Jest's default CJS loader. We never want real network calls
// from unit tests anyway, so a no-op track() is what the test world
// actually needs.

module.exports = {
  track: () => {},
  Analytics: () => null,
}
