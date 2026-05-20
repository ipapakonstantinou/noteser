'use client'

import { useEffect } from 'react'
import { useSettingsStore } from '@/stores'
import { applyThemeOverrides } from '@/utils/theme'

// Apply the user's theme overrides to :root whenever the
// settingsStore changes (th3m). Mount once at app root; subscribes
// to settingsStore directly so the dispatch is cheap.
export function useApplyTheme(): void {
  const overrides = useSettingsStore(s => s.themeOverrides)
  useEffect(() => {
    applyThemeOverrides(overrides || {})
  }, [overrides])
}
