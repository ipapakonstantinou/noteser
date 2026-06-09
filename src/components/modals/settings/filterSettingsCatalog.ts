import type { SettingsCatalogEntry } from './settingsCatalog'

export function filterSettingsCatalog(
  entries: readonly SettingsCatalogEntry[],
  query: string,
): SettingsCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return entries.filter(entry => {
    if (entry.label.toLowerCase().includes(q)) return true
    if (entry.description.toLowerCase().includes(q)) return true
    if (entry.categoryLabel.toLowerCase().includes(q)) return true
    if (entry.keywords && entry.keywords.some(k => k.toLowerCase().includes(q))) return true
    return false
  })
}

export function groupByCategory(
  entries: readonly SettingsCatalogEntry[],
): { categoryId: SettingsCatalogEntry['categoryId']; categoryLabel: string; items: SettingsCatalogEntry[] }[] {
  const buckets = new Map<string, { categoryId: SettingsCatalogEntry['categoryId']; categoryLabel: string; items: SettingsCatalogEntry[] }>()
  for (const entry of entries) {
    const bucket = buckets.get(entry.categoryId)
    if (bucket) {
      bucket.items.push(entry)
    } else {
      buckets.set(entry.categoryId, {
        categoryId: entry.categoryId,
        categoryLabel: entry.categoryLabel,
        items: [entry],
      })
    }
  }
  return Array.from(buckets.values())
}
