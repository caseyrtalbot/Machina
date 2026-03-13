import { describe, it, expect } from 'vitest'
import { fuzzyMatch, filterItems, type CommandItem } from '../CommandPalette'

describe('fuzzyMatch', () => {
  it('returns exact prefix match with score 100', () => {
    const result = fuzzyMatch('GraphPanel', 'graph')
    expect(result.match).toBe(true)
    expect(result.score).toBe(100)
  })

  it('returns substring match with score 50', () => {
    const result = fuzzyMatch('MyGraphPanel', 'graph')
    expect(result.match).toBe(true)
    expect(result.score).toBe(50)
  })

  it('returns fuzzy character match with score 10 and matched indices', () => {
    const result = fuzzyMatch('GraphPanel', 'gpl')
    expect(result.match).toBe(true)
    expect(result.score).toBe(10)
    expect(result.indices).toEqual([0, 3, 9])
  })

  it('returns no match when characters are missing', () => {
    const result = fuzzyMatch('GraphPanel', 'xyz')
    expect(result.match).toBe(false)
    expect(result.score).toBe(0)
  })

  it('is case-insensitive', () => {
    const result = fuzzyMatch('GraphPanel', 'GRAPH')
    expect(result.match).toBe(true)
  })
})

describe('filterItems', () => {
  const items: CommandItem[] = [
    { id: 'note:a', label: 'Architecture Notes', category: 'note' },
    { id: 'note:b', label: 'Bug Tracker', category: 'note' },
    { id: 'cmd:toggle', label: 'Toggle Sidebar', category: 'command' },
    { id: 'cmd:settings', label: 'Open Settings', category: 'command' }
  ]

  it('returns all items for empty query', () => {
    expect(filterItems(items, '')).toEqual(items)
  })

  it('filters by fuzzy match on label', () => {
    const result = filterItems(items, 'arch')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('note:a')
  })

  it('> prefix filters to commands only', () => {
    const result = filterItems(items, '>')
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.category === 'command')).toBe(true)
  })

  it('> prefix with query filters commands by fuzzy match', () => {
    const result = filterItems(items, '>toggle')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('cmd:toggle')
  })

  it('/ prefix filters to commands only', () => {
    const result = filterItems(items, '/')
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.category === 'command')).toBe(true)
  })
})
