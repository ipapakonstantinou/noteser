/*
 * Noteser service worker — minimal, offline-capable app shell.
 *
 * Strategy
 *   install : pre-cache a tiny app shell (start URL + manifest + icons) so a
 *             cold launch works offline. Next.js fingerprints its JS/CSS, so
 *             those URLs are not known at install time — they are cached
 *             lazily on first fetch instead (see the fetch handler).
 *   activate: delete every cache that is not the current version, then claim
 *             open clients so the new SW controls them immediately.
 *   fetch   : cache-first for same-origin GET static assets (Next build
 *             output, icons, fonts, images) with a network fallback that
 *             populates the cache. Navigations fall back to the cached shell
 *             when the network is unavailable.
 *
 * CRITICAL: never cache API traffic. GitHub sync, the OAuth proxy routes and
 * any AI calls MUST always hit the network — a stale cached sync response
 * would corrupt the vault's merge state. We bypass the SW entirely for
 * /api/*, cross-origin requests (api.github.com, github.com, *.anthropic.com,
 * *.openai.com) and anything that is not a GET.
 */

// CACHE_VERSION is derived from this SW's own registration URL query
// (`/sw.js?v=<buildId>`). The page registers the worker with a per-build id
// (next.config.mjs -> NEXT_PUBLIC_BUILD_ID), so each deploy installs under a
// distinct CACHE_NAME and the activate handler purges every older cache. The
// committed bytes of this file never need to change to ship a new version.
// Falls back to 'v1' when registered without a query (e.g. legacy clients).
const CACHE_VERSION = new URL(self.location.href).searchParams.get('v') || 'v1'
const CACHE_NAME = `noteser-shell-${CACHE_VERSION}`

// The minimal shell pre-cached at install. Keep this small and stable —
// fingerprinted build assets are added lazily by the fetch handler.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Best-effort: a single 404 in addAll() would reject the whole install,
      // so cache entries individually and ignore the misses.
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              /* ignore assets that 404 at install time */
            })
          )
        )
      )
    // NOTE: deliberately NO self.skipWaiting() here. A freshly-installed SW
    // must WAIT (state 'installed') instead of activating immediately, so the
    // page can detect the update and surface a controlled "New version
    // available — Reload" prompt. Activation happens only when the page posts
    // {type:'SKIP_WAITING'} (see the message handler below).
  )
})

// The page asks the waiting worker to take over after the user accepts the
// update prompt. skipWaiting() promotes this SW to active; that fires
// 'controllerchange' in the page, which reloads exactly once.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      // Take control of already-open pages so updates roll out without a
      // second reload.
      .then(() => self.clients.claim())
  )
})

// URLs we must never serve from cache — sync correctness depends on the
// network. Same-origin API + Next data routes.
function isNetworkOnly(url) {
  return url.pathname.startsWith('/api/')
}

// Same-origin static assets we are happy to serve cache-first.
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/feature-tour/') ||
    url.pathname === '/manifest.json' ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$/.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only GET is cacheable; everything else (POST/PUT/PATCH...) goes straight
  // to the network — this also covers GitHub write traffic via API routes.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Leave cross-origin requests (api.github.com, github.com, AI providers)
  // entirely to the browser — never intercept or cache them.
  if (url.origin !== self.location.origin) return

  // Never cache API / sync traffic.
  if (isNetworkOnly(url)) return

  // App navigations: try network first (fresh HTML), fall back to the cached
  // shell ('/') when offline so the SPA still boots.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/'))
      )
    )
    return
  }

  // Static assets: cache-first, populate on miss.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          // Only cache successful, basic (same-origin) responses.
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
      })
    )
  }
  // Anything else: default browser handling (network).
})
