'use client'

import { useEffect } from 'react'
import { useSettingsStore } from '@/stores'
import { applyFontOverrides } from '@/utils/fonts'

// Apply the user's font choices to :root whenever they change (fnt1).
// Mount once at app root alongside useApplyTheme. Each font is a CSS
// font-family value; an empty string clears the variable so the default
// declared in globals.css takes over (system default → no change).
export function useApplyFonts(): void {
  const fontText = useSettingsStore(s => s.fontText)
  const fontMono = useSettingsStore(s => s.fontMono)
  const fontInterface = useSettingsStore(s => s.fontInterface)
  useEffect(() => {
    applyFontOverrides({ fontText, fontMono, fontInterface })
  }, [fontText, fontMono, fontInterface])
}
