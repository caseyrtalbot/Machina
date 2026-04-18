import { describe, it, expect } from 'vitest'
import { ClusterDraftSchema } from '../cluster-types'

describe('ClusterDraftSchema', () => {
  it('accepts a minimal valid cluster', () => {
    const result = ClusterDraftSchema.safeParse({
      kind: 'cluster',
      title: 'My cluster',
      prompt: 'Compare A and B',
      origin: 'agent',
      sources: ['src-1'],
      sections: [
        { cardId: 'c1', heading: 'A', body: 'a body' },
        { cardId: 'c2', heading: 'B', body: 'b body' }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('rejects a cluster with fewer than 2 sections', () => {
    const result = ClusterDraftSchema.safeParse({
      kind: 'cluster',
      title: 't',
      prompt: '',
      origin: 'human',
      sources: [],
      sections: [{ cardId: 'c1', heading: 'only', body: '' }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate cardIds', () => {
    const result = ClusterDraftSchema.safeParse({
      kind: 'cluster',
      title: 't',
      prompt: '',
      origin: 'human',
      sources: [],
      sections: [
        { cardId: 'dup', heading: 'A', body: '' },
        { cardId: 'dup', heading: 'B', body: '' }
      ]
    })
    expect(result.success).toBe(false)
  })
})
