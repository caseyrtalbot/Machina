import { describe, it, expect } from 'vitest'
import { groupByFrequency } from '../../../../src/renderer/src/panels/ghosts/ghost-sections'
import type { GhostEntry } from '@shared/engine/ghost-index'

function ghost(id: string, referenceCount: number): GhostEntry {
  return { id, referenceCount, references: [] }
}

describe('groupByFrequency', () => {
  it('returns empty array for no ghosts', () => {
    expect(groupByFrequency([])).toEqual([])
  })

  it('groups ghosts into frequency bands', () => {
    const ghosts = [
      ghost('A', 24),
      ghost('B', 18),
      ghost('C', 16),
      ghost('D', 10),
      ghost('E', 5),
      ghost('F', 2)
    ]
    const sections = groupByFrequency(ghosts)

    expect(sections.map((s) => s.label)).toEqual(['Frequently Referenced', 'Moderate', 'Sparse'])
    expect(sections[0].ghosts.map((g) => g.id)).toEqual(['A', 'B', 'C'])
    expect(sections[1].ghosts.map((g) => g.id)).toEqual(['D'])
    expect(sections[2].ghosts.map((g) => g.id)).toEqual(['E', 'F'])
  })

  it('omits empty sections', () => {
    const ghosts = [ghost('A', 24), ghost('B', 20)]
    const sections = groupByFrequency(ghosts)
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBe('Frequently Referenced')
  })

  it('handles single ghost', () => {
    const sections = groupByFrequency([ghost('X', 3)])
    expect(sections).toHaveLength(1)
    expect(sections[0].ghosts).toHaveLength(1)
  })
})
