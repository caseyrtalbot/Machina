// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import matter from 'gray-matter'
import { ArtifactMaterializer } from '../../src/main/services/artifact-materializer'
import { parseArtifact } from '../../src/shared/engine/parser'
import type { ClusterDraft } from '../../src/shared/cluster-types'

describe('cluster capture end-to-end', () => {
  let vault: string

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'te-cluster-e2e-'))
  })

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true })
  })

  it('captures a cluster, parses it, and round-trips frontmatter sources', async () => {
    await mkdir(join(vault, 'src'), { recursive: true })
    await writeFile(
      join(vault, 'src', 'a.md'),
      '---\nid: src-a\ntitle: Source A\n---\nbody a',
      'utf-8'
    )
    await writeFile(
      join(vault, 'src', 'b.md'),
      '---\nid: src-b\ntitle: Source B\n---\nbody b',
      'utf-8'
    )

    const draft: ClusterDraft = {
      kind: 'cluster',
      title: 'Compare A vs B',
      prompt: 'Compare them',
      origin: 'agent',
      sources: ['src-a', 'src-b'],
      sections: [
        { cardId: 's1', heading: 'Take on A', body: 'take-a body' },
        { cardId: 's2', heading: 'Take on B', body: 'take-b body' },
        { cardId: 'syn', heading: 'Synthesis', body: 'syn body' }
      ]
    }

    const mat = new ArtifactMaterializer({ registerExternalWrite: () => {} })
    const res = await mat.materialize(draft, vault, 'clusters/')

    const raw = await readFile(res.absolutePath, 'utf-8')
    const parsed = matter(raw)
    expect(parsed.data.sources).toEqual(['src-a', 'src-b'])
    expect(Object.keys(parsed.data.sections as Record<string, string>)).toHaveLength(3)

    // Assert prompt appears as intro exactly once (not duplicated as a ## heading)
    expect(parsed.content.startsWith('Compare them\n\n## Take on A')).toBe(true)
    expect(parsed.content.match(/Compare them/g)?.length).toBe(1)

    const artifactResult = parseArtifact(raw, res.vaultRelativePath)
    expect(artifactResult.ok).toBe(true)
    if (!artifactResult.ok) return
    expect(artifactResult.value.sources).toEqual(['src-a', 'src-b'])
    expect(artifactResult.value.origin).toBe('agent')
    expect(artifactResult.value.title).toBe('Compare A vs B')
  })
})
