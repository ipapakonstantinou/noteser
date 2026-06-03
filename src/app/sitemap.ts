import type { MetadataRoute } from 'next'
import { HELP_PAGES } from '@/help/content'

// XML sitemap so Google indexes every help page + the changelog
// alongside the landing page. Without this, the SPA-style landing
// at /
//
// `BASE_URL` is hard-coded to the prod domain because preview
// deployments should NOT be crawled.

const BASE_URL = 'https://noteser.app'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const helpRoutes = HELP_PAGES.map((p) => ({
    url: `${BASE_URL}/help/${p.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))
  return [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/changelog`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/vault`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/help`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...helpRoutes,
  ]
}
