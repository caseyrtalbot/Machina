import { describe, expect, it } from 'vitest'
import { TE_DIR } from '@shared/constants'
import { enrichArtifactMetadata } from './workbench-artifact-placement'
import type { SystemArtifactKind } from '@shared/system-artifacts'

function baseFrontmatter(kind: SystemArtifactKind) {
  return {
    id: `${kind[0]}-20260320-test`,
    title: `Test ${kind}`,
    type: kind,
    created: '2026-03-20',
    modified: '2026-03-20',
    signal: 'emerging' as const,
    tags: [kind],
    connections: ['other-artifact'],
    tensions_with: ['tension-1']
  }
}

describe('enrichArtifactMetadata', () => {
  it('extracts session-specific fields', () => {
    const frontmatter = {
      ...baseFrontmatter('session'),
      status: 'completed',
      started_at: '2026-03-20T10:00:00Z',
      project_root: '/repo',
      claude_session_ids: ['sess-a', 'sess-b'],
      file_refs: ['src/app.tsx', 'src/index.ts', 'src/util.ts'],
      command_count: 12,
      file_touch_count: 7,
      summary: 'Implemented workbench artifact cards'
    }

    const meta = enrichArtifactMetadata(frontmatter, 'session', '/vault/artifact.md')

    expect(meta).toMatchObject({
      artifactKind: 'session',
      artifactId: 's-20260320-test',
      status: 'completed',
      signal: 'emerging',
      fileRefCount: 3,
      commandCount: 12,
      fileTouchCount: 7,
      summary: 'Implemented workbench artifact cards',
      filePath: '/vault/artifact.md',
      connections: ['other-artifact'],
      tensionRefs: ['tension-1']
    })
  })

  it('extracts tension-specific fields', () => {
    const frontmatter = {
      ...baseFrontmatter('tension'),
      status: 'open',
      opened_at: '2026-03-20T10:00:00Z',
      question: 'Should artifacts auto-place or require user action?',
      hypothesis: 'Auto-place reduces friction',
      file_refs: ['src/placement.ts'],
      pattern_refs: ['p-20260320-tdd']
    }

    const meta = enrichArtifactMetadata(frontmatter, 'tension', '/vault/artifact.md')

    expect(meta).toMatchObject({
      artifactKind: 'tension',
      question: 'Should artifacts auto-place or require user action?',
      status: 'open',
      fileRefCount: 1,
      connections: ['other-artifact'],
      tensionRefs: ['tension-1']
    })
  })

  it('extracts pattern-specific fields including snapshot indicator', () => {
    const frontmatter = {
      ...baseFrontmatter('pattern'),
      status: 'active',
      project_root: '/repo',
      file_refs: ['src/a.ts', 'src/b.ts'],
      canvas_snapshot: `${TE_DIR}/artifacts/patterns/p-20260320-test.canvas.json`,
      note_refs: ['note-1'],
      tension_refs: ['t-20260320-bug']
    }

    const meta = enrichArtifactMetadata(frontmatter, 'pattern', '/vault/artifact.md')

    expect(meta).toMatchObject({
      artifactKind: 'pattern',
      hasSnapshot: true,
      fileRefCount: 2,
      status: 'active',
      connections: ['other-artifact'],
      tensionRefs: ['tension-1', 't-20260320-bug']
    })
  })

  it('handles pattern without snapshot', () => {
    const frontmatter = {
      ...baseFrontmatter('pattern'),
      status: 'draft',
      project_root: '/repo',
      file_refs: []
    }

    const meta = enrichArtifactMetadata(frontmatter, 'pattern', '/vault/artifact.md')

    expect(meta.hasSnapshot).toBe(false)
    expect(meta.fileRefCount).toBe(0)
  })

  it('merges tensions_with and tension_refs into tensionRefs', () => {
    const frontmatter = {
      ...baseFrontmatter('pattern'),
      status: 'active',
      project_root: '/repo',
      file_refs: [],
      tensions_with: ['tw-1', 'tw-2'],
      tension_refs: ['tr-1', 'tw-1']
    }

    const meta = enrichArtifactMetadata(frontmatter, 'pattern', '/vault/artifact.md')

    // Should be deduplicated union of tensions_with + tension_refs
    expect(meta.tensionRefs).toContain('tw-1')
    expect(meta.tensionRefs).toContain('tw-2')
    expect(meta.tensionRefs).toContain('tr-1')
    expect(new Set(meta.tensionRefs).size).toBe(meta.tensionRefs.length)
  })

  it('defaults missing optional fields gracefully', () => {
    const frontmatter = {
      id: 's-minimal',
      title: 'Minimal',
      type: 'session',
      created: '2026-03-20',
      modified: '2026-03-20',
      signal: 'untested',
      status: 'active',
      started_at: '2026-03-20T10:00:00Z',
      project_root: '/repo'
    }

    const meta = enrichArtifactMetadata(frontmatter, 'session', '/vault/artifact.md')

    expect(meta.summary).toBeUndefined()
    expect(meta.question).toBeUndefined()
    expect(meta.fileRefCount).toBe(0)
    expect(meta.commandCount).toBe(0)
    expect(meta.fileTouchCount).toBe(0)
    expect(meta.connections).toEqual([])
    expect(meta.tensionRefs).toEqual([])
  })
})
