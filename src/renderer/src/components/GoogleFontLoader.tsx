import { useEffect } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { GOOGLE_FONTS, buildGoogleFontUrl, buildFontFamilyValue } from '../design/google-fonts'

/**
 * Injects a Google Fonts <link> into <head> when the selected font changes,
 * and applies the font-family to <body>.
 *
 * Mount this once at the app root. It reads from settings-store reactively.
 */
export function GoogleFontLoader() {
  const fontFamily = useSettingsStore((s) => s.fontFamily)

  useEffect(() => {
    const entry = GOOGLE_FONTS.find((f) => f.name === fontFamily)
    const url = entry ? buildGoogleFontUrl(entry) : null

    // Clean up previous font link
    const existingLink = document.getElementById('te-google-font') as HTMLLinkElement | null

    if (url) {
      if (existingLink) {
        existingLink.href = url
      } else {
        const link = document.createElement('link')
        link.id = 'te-google-font'
        link.rel = 'stylesheet'
        link.href = url
        document.head.appendChild(link)
      }
    } else if (existingLink) {
      existingLink.remove()
    }

    // Apply the font to the body
    document.body.style.fontFamily = buildFontFamilyValue(fontFamily)
  }, [fontFamily])

  return null
}
