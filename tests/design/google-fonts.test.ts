import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isLocalFont,
  parseGoogleFontCss,
  isLatinFace,
  loadRemoteFont,
  buildGoogleFontUrl,
  buildFontFamilyValue,
  GOOGLE_FONTS
} from '../../src/renderer/src/design/google-fonts'

// Real (truncated) Google Fonts css2 response shape.
const CSS2_FIXTURE = `
/* cyrillic */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lora/v36/cyrillic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* latin-ext */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lora/v36/latin-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+1E00-1E9F, U+2020, U+2113;
}
/* latin */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lora/v36/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+FFFD;
}
`

describe('isLocalFont', () => {
  it('treats bundled defaults and System as local', () => {
    expect(isLocalFont('Manrope')).toBe(true)
    expect(isLocalFont('Space Mono')).toBe(true)
    expect(isLocalFont('System')).toBe(true)
  })

  it('treats other catalog fonts as remote', () => {
    expect(isLocalFont('Inter')).toBe(false)
    expect(isLocalFont('Lora')).toBe(false)
  })
})

describe('parseGoogleFontCss', () => {
  it('extracts style, weight, url, and unicode-range from each @font-face block', () => {
    const faces = parseGoogleFontCss(CSS2_FIXTURE)
    expect(faces).toHaveLength(3)
    expect(faces[2]).toEqual({
      style: 'normal',
      weight: '200 800',
      url: 'https://fonts.gstatic.com/s/lora/v36/latin.woff2',
      unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+FFFD'
    })
  })

  it('returns empty for css without font faces', () => {
    expect(parseGoogleFontCss('body { color: red }')).toEqual([])
  })
})

describe('isLatinFace', () => {
  it('keeps latin and latin-ext subsets, drops others', () => {
    const [cyrillic, latinExt, latin] = parseGoogleFontCss(CSS2_FIXTURE)
    expect(isLatinFace(cyrillic)).toBe(false)
    expect(isLatinFace(latinExt)).toBe(true)
    expect(isLatinFace(latin)).toBe(true)
  })

  it('keeps faces without a unicode-range', () => {
    expect(isLatinFace({ style: 'normal', weight: '400', url: 'x' })).toBe(true)
  })
})

describe('buildGoogleFontUrl / buildFontFamilyValue', () => {
  it('still builds css2 URLs for remote fonts and null for System', () => {
    const lora = GOOGLE_FONTS.find((f) => f.name === 'Lora')
    expect(lora && buildGoogleFontUrl(lora)).toContain(
      'https://fonts.googleapis.com/css2?family=Lora'
    )
    expect(
      buildGoogleFontUrl({ name: 'System', category: 'sans-serif', weights: [400] })
    ).toBeNull()
  })

  it('quotes bundled defaults with category fallbacks', () => {
    expect(buildFontFamilyValue('Space Mono')).toBe('"Space Mono", "Courier New", monospace')
  })
})

describe('loadRemoteFont', () => {
  const addedFaces: Array<{ family: string; descriptors?: FontFaceDescriptors }> = []

  class FakeFontFace {
    readonly family: string
    readonly status = 'loaded'
    constructor(family: string, _source: ArrayBuffer, descriptors?: FontFaceDescriptors) {
      this.family = family
      addedFaces.push({ family, descriptors })
    }
  }

  beforeEach(() => {
    addedFaces.length = 0
    vi.stubGlobal('FontFace', FakeFontFace)
    Object.defineProperty(document, 'fonts', {
      value: { add: vi.fn() },
      configurable: true
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves true without fetching for local fonts', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(loadRemoteFont('Manrope')).resolves.toBe(true)
    await expect(loadRemoteFont('System')).resolves.toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('registers latin faces only and resolves true on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('https://fonts.googleapis.com/')) {
          return { ok: true, text: async () => CSS2_FIXTURE }
        }
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }
      })
    )

    await expect(loadRemoteFont('Lora')).resolves.toBe(true)
    expect(addedFaces).toHaveLength(2) // latin + latin-ext, no cyrillic
    expect(addedFaces.every((f) => f.family === 'Lora')).toBe(true)
    expect(document.fonts.add).toHaveBeenCalledTimes(2)
  })

  it('resolves false on network failure and retries on the next call', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', failing)
    await expect(loadRemoteFont('Spectral')).resolves.toBe(false)

    // Network comes back: the failure must not be cached.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('https://fonts.googleapis.com/')) {
          return { ok: true, text: async () => CSS2_FIXTURE }
        }
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }
      })
    )
    await expect(loadRemoteFont('Spectral')).resolves.toBe(true)
  })

  it('resolves false on a non-OK stylesheet response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, text: async () => '' }))
    )
    await expect(loadRemoteFont('Bitter')).resolves.toBe(false)
  })

  it('resolves false for fonts outside the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(loadRemoteFont('Comic Sans MS')).resolves.toBe(false)
  })
})
