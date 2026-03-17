import { useEffect } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { GOOGLE_FONTS, buildGoogleFontUrl, buildFontFamilyValue } from '../design/google-fonts'

const MONO_FONT = GOOGLE_FONTS.find((f) => f.name === 'JetBrains Mono')!
const MONO_FONT_URL = buildGoogleFontUrl(MONO_FONT)!
const BODY_FONT = GOOGLE_FONTS.find((f) => f.name === 'Inter')!
const BODY_FONT_URL = buildGoogleFontUrl(BODY_FONT)!

/**
 * Injects Google Fonts <link> tags into <head>:
 * - Always loads JetBrains Mono (terminal, source editor, code blocks)
 * - Loads the user's selected display font reactively from settings-store
 *
 * Mount this once at the app root.
 */
export function GoogleFontLoader() {
  const fontFamily = useSettingsStore((s) => s.fontFamily)

  // Always load JetBrains Mono (code) and DM Sans (default body)
  useEffect(() => {
    if (!document.getElementById('te-mono-font')) {
      const link = document.createElement('link')
      link.id = 'te-mono-font'
      link.rel = 'stylesheet'
      link.href = MONO_FONT_URL
      document.head.appendChild(link)
    }
    if (!document.getElementById('te-body-font')) {
      const link = document.createElement('link')
      link.id = 'te-body-font'
      link.rel = 'stylesheet'
      link.href = BODY_FONT_URL
      document.head.appendChild(link)
    }
  }, [])

  // Load the user's selected display font
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
