/**
 * Curated Google Fonts catalog for Thought Engine.
 *
 * Each entry includes the font name (as used in the Google Fonts API),
 * its category for filtering, and the weights we load.
 *
 * To add a font: append to the appropriate category section.
 * The Google Fonts CSS2 API URL is built dynamically from this list.
 */

export interface GoogleFontEntry {
  readonly name: string
  readonly category: 'sans-serif' | 'serif' | 'monospace' | 'display'
  readonly weights: readonly number[]
}

export const GOOGLE_FONTS: readonly GoogleFontEntry[] = [
  // ── Sans-Serif ──
  { name: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Roboto', category: 'sans-serif', weights: [400, 500, 700] },
  { name: 'Open Sans', category: 'sans-serif', weights: [400, 600, 700] },
  { name: 'Lato', category: 'sans-serif', weights: [400, 700] },
  { name: 'Montserrat', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Poppins', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Nunito', category: 'sans-serif', weights: [400, 600, 700] },
  { name: 'Raleway', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Work Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'DM Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Manrope', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Plus Jakarta Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Source Sans 3', category: 'sans-serif', weights: [400, 600, 700] },
  { name: 'Outfit', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Sora', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Figtree', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Geist', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Noto Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Rubik', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Karla', category: 'sans-serif', weights: [400, 500, 700] },
  { name: 'Cabin', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Barlow', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Mulish', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Quicksand', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Space Grotesk', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Albert Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Lexend', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Red Hat Display', category: 'sans-serif', weights: [400, 500, 700] },
  { name: 'IBM Plex Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Overpass', category: 'sans-serif', weights: [400, 600, 700] },

  // ── Serif ──
  { name: 'Merriweather', category: 'serif', weights: [400, 700] },
  { name: 'Playfair Display', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Lora', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Source Serif 4', category: 'serif', weights: [400, 600, 700] },
  { name: 'Crimson Text', category: 'serif', weights: [400, 600, 700] },
  { name: 'EB Garamond', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Libre Baskerville', category: 'serif', weights: [400, 700] },
  { name: 'DM Serif Display', category: 'serif', weights: [400] },
  { name: 'Bitter', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Cormorant Garamond', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Spectral', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Noto Serif', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'IBM Plex Serif', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Cardo', category: 'serif', weights: [400, 700] },
  { name: 'Newsreader', category: 'serif', weights: [400, 500, 600, 700] },

  // ── Monospace ──
  { name: 'JetBrains Mono', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Fira Code', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Source Code Pro', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'IBM Plex Mono', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Roboto Mono', category: 'monospace', weights: [400, 500, 700] },
  { name: 'Inconsolata', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Space Mono', category: 'monospace', weights: [400, 700] },
  { name: 'Ubuntu Mono', category: 'monospace', weights: [400, 700] },
  { name: 'DM Mono', category: 'monospace', weights: [400, 500] },
  { name: 'Geist Mono', category: 'monospace', weights: [400, 500, 600, 700] },

  // ── Display ──
  { name: 'Bebas Neue', category: 'display', weights: [400] },
  { name: 'Oswald', category: 'display', weights: [400, 500, 600, 700] },
  { name: 'Archivo', category: 'display', weights: [400, 500, 600, 700] },
  { name: 'Fjalla One', category: 'display', weights: [400] },
  { name: 'Righteous', category: 'display', weights: [400] },
  { name: 'Permanent Marker', category: 'display', weights: [400] },
  { name: 'Abril Fatface', category: 'display', weights: [400] },
  { name: 'Passion One', category: 'display', weights: [400, 700] },
  { name: 'Russo One', category: 'display', weights: [400] },
  { name: 'Cinzel', category: 'display', weights: [400, 500, 600, 700] }
] as const

/** The built-in system font option (not from Google Fonts) */
export const SYSTEM_FONT_ENTRY: GoogleFontEntry = {
  name: 'System',
  category: 'sans-serif',
  weights: [400, 500, 600, 700]
}

/** All font options including the system font */
export const ALL_FONT_OPTIONS: readonly GoogleFontEntry[] = [SYSTEM_FONT_ENTRY, ...GOOGLE_FONTS]

/**
 * Build a Google Fonts CSS2 API URL for a given font entry.
 * Returns null for the "System" font since it doesn't need loading.
 */
export function buildGoogleFontUrl(font: GoogleFontEntry): string | null {
  if (font.name === 'System') return null

  const family = font.name.replace(/ /g, '+')
  const weights = font.weights.join(';')
  return `https://fonts.googleapis.com/css2?family=${family}:wght@${weights}&display=swap`
}

/**
 * Build a CSS font-family value with appropriate fallbacks.
 */
export function buildFontFamilyValue(fontName: string): string {
  if (fontName === 'System') {
    return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  }

  const entry = GOOGLE_FONTS.find((f) => f.name === fontName)
  const fallback =
    entry?.category === 'serif'
      ? 'Georgia, serif'
      : entry?.category === 'monospace'
        ? '"Courier New", monospace'
        : 'system-ui, sans-serif'

  return `"${fontName}", ${fallback}`
}

/** All unique categories for filtering */
export const FONT_CATEGORIES = ['all', 'sans-serif', 'serif', 'monospace', 'display'] as const
export type FontCategory = (typeof FONT_CATEGORIES)[number]
