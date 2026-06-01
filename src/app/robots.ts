import type { MetadataRoute } from 'next'

// robots.txt — allow everything, point crawlers at the sitemap.
//
// `/api/*` is rejected so search engines do not try to index server
// routes; everything else (the landing, /help, /changelog) is fair
// game.

const BASE_URL = 'https://noteser.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
