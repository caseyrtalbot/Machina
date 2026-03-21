import { describe, it, expect } from 'vitest'
import type { ArtifactType, Signal, Artifact } from '@shared/types'

describe('shared types', () => {
  it('creates a valid Artifact', () => {
    const artifact: Artifact = {
      id: 'g1',
      title: 'Test Gene',
      type: 'gene',
      created: '2026-03-12',
      modified: '2026-03-12',
      source: 'research',
      frame: 'market strategy',
      signal: 'untested',
      tags: ['test'],
      connections: ['g2'],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      related: [],
      bodyLinks: [],
      body: 'Test body content'
    }
    expect(artifact.id).toBe('g1')
    expect(artifact.type).toBe('gene')
  })

  it('enforces signal enum values', () => {
    const signals: Signal[] = ['untested', 'emerging', 'validated', 'core']
    expect(signals).toHaveLength(4)
  })

  it('enforces artifact type enum values', () => {
    const types: ArtifactType[] = ['gene', 'constraint', 'research', 'output', 'note', 'index']
    expect(types).toHaveLength(6)
  })
})
