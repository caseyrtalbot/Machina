import type { GhostEntry } from '@shared/engine/ghost-index'

interface GhostSection {
  readonly label: string
  readonly ghosts: readonly GhostEntry[]
}

const BANDS: readonly { label: string; min: number }[] = [
  { label: 'Frequently Referenced', min: 0.6 },
  { label: 'Moderate', min: 0.25 },
  { label: 'Sparse', min: 0 }
]

export function groupByFrequency(ghosts: readonly GhostEntry[]): GhostSection[] {
  if (ghosts.length === 0) return []

  const maxCount = ghosts[0]?.referenceCount ?? 1

  return BANDS.map(({ label, min: _min }) => ({
    label,
    ghosts: ghosts.filter((g) => {
      const ratio = g.referenceCount / maxCount
      const band = BANDS.find((b) => ratio >= b.min)
      return band?.label === label
    })
  })).filter((s) => s.ghosts.length > 0)
}
