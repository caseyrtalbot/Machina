/**
 * Curated Google Fonts catalog for Machina.
 *
 * Each entry includes the font name (as used in the Google Fonts API),
 * its category for filtering, and the weights we load.
 *
 * Curated for: dark-theme readability, variable weight support,
 * and the refined technical aesthetic of tools like Linear, Raycast, Arc.
 */

export interface GoogleFontEntry {
  readonly name: string
  readonly category: 'sans-serif' | 'serif' | 'monospace' | 'display'
  readonly weights: readonly number[]
}

export const GOOGLE_FONTS: readonly GoogleFontEntry[] = [
  // ── Sans-Serif ──
  // Geometric, technical, excellent at small sizes on dark backgrounds
  { name: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Geist', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'DM Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Plus Jakarta Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Manrope', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Space Grotesk', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Outfit', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Sora', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Albert Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'IBM Plex Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Figtree', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { name: 'Work Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },

  // ── Serif ──
  // Editorial character, gorgeous on dark backgrounds for headings or long-form
  { name: 'Source Serif 4', category: 'serif', weights: [400, 600, 700] },
  { name: 'Newsreader', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Lora', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'EB Garamond', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Spectral', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'IBM Plex Serif', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Cormorant Garamond', category: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Bitter', category: 'serif', weights: [400, 500, 600, 700] },

  // ── Monospace ──
  // Crisp at 12-14px, ligature support, designed for code
  { name: 'JetBrains Mono', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Geist Mono', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Fira Code', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'IBM Plex Mono', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'Source Code Pro', category: 'monospace', weights: [400, 500, 600, 700] },
  { name: 'DM Mono', category: 'monospace', weights: [400, 500] },
  { name: 'Space Mono', category: 'monospace', weights: [400, 700] },

  // ── Display ──
  // Distinctive heading faces that pair with the sans/serif body options
  { name: 'Archivo', category: 'display', weights: [400, 500, 600, 700] },
  { name: 'Red Hat Display', category: 'display', weights: [400, 500, 700] },
  { name: 'Lexend', category: 'display', weights: [400, 500, 600, 700] },
  { name: 'Cinzel', category: 'display', weights: [400, 500, 600, 700] },
  { name: 'Playfair Display', category: 'display', weights: [400, 500, 600, 700] }
] as const

/**
 * Default fonts bundled as local woff2 (assets/fonts/fonts.css) so the
 * out-of-the-box UI never depends on Google Fonts at runtime (plan 2.14).
 */
export const LOCAL_FONT_NAMES = ['Manrope', 'Space Mono'] as const

/** True when a font needs no network load (bundled @font-face or system). */
export function isLocalFont(name: string): boolean {
  return name === 'System' || (LOCAL_FONT_NAMES as readonly string[]).includes(name)
}

/** The built-in system font option (not from Google Fonts) */
const SYSTEM_FONT_ENTRY: GoogleFontEntry = {
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

// ── Remote loading (user-chosen non-default fonts) ──
//
// Non-default fonts load via fetch() + FontFace instead of injected
// <link rel="stylesheet"> tags. This keeps style-src/font-src CSP local-only
// (network access is confined to connect-src) and gives an explicit
// success/failure signal for offline detection in FontPicker.

/** One @font-face block parsed out of a Google Fonts css2 response. */
export interface RemoteFontFace {
  readonly style: string
  readonly weight: string
  readonly url: string
  readonly unicodeRange?: string
}

/** Parse @font-face blocks from a Google Fonts css2 stylesheet. Pure. */
export function parseGoogleFontCss(css: string): RemoteFontFace[] {
  const faces: RemoteFontFace[] = []
  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const block = match[1]
    const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1]
    if (!url) continue
    faces.push({
      style: /font-style:\s*([^;]+);/.exec(block)?.[1].trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(block)?.[1].trim() ?? '400',
      url,
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(block)?.[1].trim()
    })
  }
  return faces
}

/** Keep only latin + latin-ext subsets — the app UI is English-first. */
export function isLatinFace(face: RemoteFontFace): boolean {
  if (!face.unicodeRange) return true
  return face.unicodeRange.includes('U+0000-00FF') || face.unicodeRange.includes('U+0100-')
}

async function fetchAndRegister(fontName: string): Promise<boolean> {
  const entry = GOOGLE_FONTS.find((f) => f.name === fontName)
  if (!entry) return false
  const url = buildGoogleFontUrl(entry)
  if (!url) return true

  const res = await fetch(url)
  if (!res.ok) return false
  const faces = parseGoogleFontCss(await res.text()).filter(isLatinFace)
  if (faces.length === 0) return false

  await Promise.all(
    faces.map(async (face) => {
      const fontRes = await fetch(face.url)
      if (!fontRes.ok) throw new Error(`font fetch failed: ${fontRes.status}`)
      const fontFace = new FontFace(fontName, await fontRes.arrayBuffer(), {
        style: face.style,
        weight: face.weight,
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {})
      })
      if (fontFace.status === 'error') throw new Error(`font parse failed: ${face.url}`)
      document.fonts.add(fontFace)
    })
  )
  return true
}

const remoteFontLoads = new Map<string, Promise<boolean>>()

/**
 * Load a user-chosen Google Font into document.fonts.
 * Resolves true on success (or for local/system fonts which need no load),
 * false on any failure — callers surface offline state from this signal.
 * Failures are not cached, so a later attempt retries the network.
 */
export function loadRemoteFont(fontName: string): Promise<boolean> {
  if (isLocalFont(fontName)) return Promise.resolve(true)
  const inFlight = remoteFontLoads.get(fontName)
  if (inFlight) return inFlight

  const load = fetchAndRegister(fontName)
    .catch(() => false)
    .then((ok) => {
      if (!ok) remoteFontLoads.delete(fontName)
      return ok
    })
  remoteFontLoads.set(fontName, load)
  return load
}
