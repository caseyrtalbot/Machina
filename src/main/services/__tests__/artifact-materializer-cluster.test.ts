// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import matter from 'gray-matter'
import { ArtifactMaterializer } from '../artifact-materializer'
import type { ClusterDraft } from '@shared/cluster-types'

function makeCluster(overrides: Partial<ClusterDraft> = {}): ClusterDraft {
  return {
    kind: 'cluster',
    title: 'Striking Thoughts vs Tao Te Ching',
    prompt: 'Compare these books on ego and action.',
    origin: 'agent',
    sources: ['src-a', 'src-b'],
    sections: [
      { cardId: 'card1', heading: 'Striking Thoughts', body: 'body 1' },
      { cardId: 'card2', heading: 'Tao Te Ching', body: 'body 2' },
      { cardId: 'card3', heading: 'Synthesis', body: 'body 3' }
    ],
    tags: ['books'],
    ...overrides
  }
}

describe('ArtifactMaterializer (cluster)', () => {
  let vaultRoot: string
  let mat: ArtifactMaterializer

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'te-cluster-test-'))
    mat = new ArtifactMaterializer({ registerExternalWrite: () => {} })
  })

  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true })
  })

  it('writes a cluster file with correct frontmatter + prompt intro + sections', async () => {
    const res = await mat.materialize(makeCluster(), vaultRoot, 'clusters/')
    const raw = await readFile(res.absolutePath, 'utf-8')
    const parsed = matter(raw)

    expect(parsed.data.kind).toBe('cluster')
    expect(parsed.data.cluster_id).toBeTruthy()
    expect(parsed.data.cluster_prompt).toBe('Compare these books on ego and action.')
    expect(parsed.data.sources).toEqual(['src-a', 'src-b'])
    expect(parsed.data.sections).toEqual({
      card1: 'Striking Thoughts',
      card2: 'Tao Te Ching',
      card3: 'Synthesis'
    })

    expect(parsed.content).toContain('Compare these books on ego and action.')
    expect(parsed.content).toContain('## Striking Thoughts\nbody 1')
    expect(parsed.content).toContain('## Tao Te Ching\nbody 2')
    expect(parsed.content).toContain('## Synthesis\nbody 3')
  })

  it('de-duplicates colliding section headings and records the resolved name in sections map', async () => {
    const draft = makeCluster({
      sections: [
        { cardId: 'a', heading: 'Same', body: 'first' },
        { cardId: 'b', heading: 'Same', body: 'second' }
      ]
    })
    const res = await mat.materialize(draft, vaultRoot, 'clusters/')
    const parsed = matter(await readFile(res.absolutePath, 'utf-8'))
    expect(parsed.data.sections).toEqual({ a: 'Same', b: 'Same (2)' })
    expect(parsed.content).toContain('## Same\nfirst')
    expect(parsed.content).toContain('## Same (2)\nsecond')
  })

  it('routes output to the configured cluster directory', async () => {
    const res = await mat.materialize(makeCluster(), vaultRoot, 'myclusters/')
    expect(res.vaultRelativePath.startsWith('myclusters/')).toBe(true)
  })
})
