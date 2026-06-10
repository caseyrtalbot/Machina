import { useEffect } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { buildFontFamilyValue, loadRemoteFont } from '../design/google-fonts'
// Bundled default fonts (Manrope, Space Mono) — local-first, no network.
import '../assets/fonts/fonts.css'

/**
 * Applies CSS custom properties for the three font slots and loads
 * user-chosen non-default fonts from Google Fonts (defaults are bundled).
 * Reacts to settings changes so font swaps are instant.
 */
export function GoogleFontLoader() {
  const displayFont = useSettingsStore((s) => s.displayFont)
  const bodyFont = useSettingsStore((s) => s.bodyFont)
  const monoFont = useSettingsStore((s) => s.monoFont)

  useEffect(() => {
    for (const name of new Set([displayFont, bodyFont, monoFont])) {
      void loadRemoteFont(name).then((ok) => {
        // Warning (not toast): CSS fallback fonts keep the UI readable, and
        // console warnings are forwarded into main.log for bug reports.
        if (!ok) console.warn(`[fonts] failed to load "${name}" from Google Fonts (offline?)`)
      })
    }

    const root = document.documentElement
    root.style.setProperty('--font-display', buildFontFamilyValue(displayFont))
    root.style.setProperty('--font-body', buildFontFamilyValue(bodyFont))
    root.style.setProperty('--font-mono', buildFontFamilyValue(monoFont))
  }, [displayFont, bodyFont, monoFont])

  return null
}
