/* Console-direction accent palette. Sourced from `Machina Console.html`
 * (Claude Design handoff bundle). Each preset is a coherent harmony chosen
 * for the cool blue-slate base — pick a vibe, not just a hex.
 *
 * Currently used as data only. The settings refactor (Phase 9.6) will wire
 * a picker that calls `applyAccentCssVars(hex)` from `design/Theme.tsx`. */

export const ACCENT_PRESETS = [
  {
    id: 'phosphor',
    hex: '#41e0d4',
    label: 'Phosphor',
    note: 'Electric cyan, oscilloscope green-blue'
  },
  { id: 'ember', hex: '#ff8c5a', label: 'Ember', note: 'Warm coral, campfire on cold steel' },
  { id: 'signal', hex: '#ffb454', label: 'Signal', note: 'Sodium amber, radio dial glow' },
  { id: 'prism', hex: '#9d8df7', label: 'Prism', note: 'Cool violet, refracted light' },
  { id: 'ion', hex: '#5cb8ff', label: 'Ion', note: 'Cold blue, ozone, plasma' },
  { id: 'acid', hex: '#a3e635', label: 'Acid', note: 'Lime, phosphorescent moss' },
  { id: 'rose', hex: '#f472b6', label: 'Rose', note: 'Magenta, hot wire' },
  { id: 'mercury', hex: '#cbd5e1', label: 'Mercury', note: 'Pale silver, ascetic, inkless' }
] as const

export type AccentPresetId = (typeof ACCENT_PRESETS)[number]['id']
export type AccentId = AccentPresetId | 'custom'

const VALID_ACCENT_IDS: ReadonlySet<string> = new Set<string>([
  ...ACCENT_PRESETS.map((p) => p.id),
  'custom'
])

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && VALID_ACCENT_IDS.has(value)
}

export const DEFAULT_ACCENT_ID: AccentId = 'ember'
