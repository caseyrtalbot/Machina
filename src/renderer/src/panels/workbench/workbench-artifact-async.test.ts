import { describe, expect, it, beforeEach, vi } from 'vitest'
import { TE_DIR } from '@shared/constants'
import { useCanvasStore } from '../../store/canvas-store'
import { useTabStore } from '../../store/tab-store'
import { placeArtifactOnWorkbench, enrichPlacedArtifact } from './workbench-artifact-placement'
import type { SystemArtifactListItem } from '../sidebar/Sidebar'

const SESSION_MARKDOWN = `---
id: s-20260320-dev
title: Dev session
type: session
created: 2026-03-20
modified: 2026-03-20
signal: validated
status: completed
started_at: 2026-03-20T10:00:00Z
project_root: /repo
claude_session_ids:
  - sess-a
file_refs:
  - src/app.tsx
  - src/index.ts
command_count: 8
file_touch_count: 5
connections:
  - p-20260320-tdd
tensions_with: []
summary: Built artifact visualization
---

## Context

Development session for workbench.
`

const TENSION_MARKDOWN = `---
id: t-20260320-perf
title: Performance concern
type: tension
created: 2026-03-20
modified: 2026-03-20
signal: untested
status: open
opened_at: 2026-03-20T10:00:00Z
file_refs:
  - src/placement.ts
pattern_refs: []
question: Will async enrichment cause visible flicker?
connections: []
tensions_with: []
---

## Why This Matters

Card appears with basic data then updates.
`

function makeItem(overrides: Partial<SystemArtifactListItem> = {}): SystemArtifactListItem {
  return {
    id: 's-20260320-dev',
    path: `/vault/${TE_DIR}/artifacts/sessions/s-20260320-dev.md`,
    title: 'Dev session',
    type: 'session',
    modified: '2026-03-20',
    status: 'completed',
    ...overrides
  }
}

function createMockReader(
  contentByPath: Record<string, string>
): (vaultPath: string, path: string) => Promise<string> {
  return vi.fn(async (_vaultPath: string, path: string) => {
    const content = contentByPath[path]
    if (!content) throw new Error(`Not found: ${path}`)
    return content
  })
}

describe('enrichPlacedArtifact', () => {
  beforeEach(() => {
    useCanvasStore.getState().closeCanvas()
    useTabStore.setState({ activeTabId: 'workbench' })
  })

  it('enriches a placed session artifact with full frontmatter', async () => {
    const item = makeItem()
    placeArtifactOnWorkbench(item)

    const node = useCanvasStore.getState().nodes[0]
    const reader = createMockReader({ [item.path]: SESSION_MARKDOWN })

    await enrichPlacedArtifact(node.id, item, '/vault', reader)

    const enriched = useCanvasStore.getState().nodes[0]
    expect(enriched.metadata).toMatchObject({
      artifactKind: 'session',
      summary: 'Built artifact visualization',
      signal: 'validated',
      fileRefCount: 2,
      commandCount: 8,
      fileTouchCount: 5,
      connections: ['p-20260320-tdd']
    })
  })

  it('enriches a tension artifact with question field', async () => {
    const item = makeItem({
      id: 't-20260320-perf',
      path: `/vault/${TE_DIR}/artifacts/tensions/t-20260320-perf.md`,
      title: 'Performance concern',
      type: 'tension',
      status: 'open'
    })
    placeArtifactOnWorkbench(item)

    const node = useCanvasStore.getState().nodes[0]
    const reader = createMockReader({ [item.path]: TENSION_MARKDOWN })

    await enrichPlacedArtifact(node.id, item, '/vault', reader)

    const enriched = useCanvasStore.getState().nodes[0]
    expect(enriched.metadata.question).toBe('Will async enrichment cause visible flicker?')
    expect(enriched.metadata.fileRefCount).toBe(1)
  })

  it('wires edges when connected artifact is already on canvas', async () => {
    // Place pattern first
    const pattern = makeItem({
      id: 'p-20260320-tdd',
      path: `/vault/${TE_DIR}/artifacts/patterns/p-20260320-tdd.md`,
      title: 'TDD loop',
      type: 'pattern',
      status: 'active'
    })
    placeArtifactOnWorkbench(pattern)

    // Place session that connects to pattern
    const session = makeItem()
    placeArtifactOnWorkbench(session)

    const sessionNode = useCanvasStore.getState().nodes[1]
    const reader = createMockReader({ [session.path]: SESSION_MARKDOWN })

    await enrichPlacedArtifact(sessionNode.id, session, '/vault', reader)

    const edges = useCanvasStore.getState().edges
    expect(edges.length).toBeGreaterThanOrEqual(1)
    expect(edges.some((e) => e.kind === 'connection')).toBe(true)
  })

  it('does not crash when IPC read fails', async () => {
    const item = makeItem()
    placeArtifactOnWorkbench(item)

    const node = useCanvasStore.getState().nodes[0]
    const reader = vi.fn(async () => {
      throw new Error('File not found')
    })

    // Should not throw
    await enrichPlacedArtifact(node.id, item, '/vault', reader)

    // Node still exists with basic metadata
    const afterNode = useCanvasStore.getState().nodes[0]
    expect(afterNode.metadata.artifactKind).toBe('session')
  })

  it('does not enrich if node was removed between place and enrich', async () => {
    const item = makeItem()
    placeArtifactOnWorkbench(item)

    const node = useCanvasStore.getState().nodes[0]

    // Remove the node before enrichment runs
    useCanvasStore.getState().removeNode(node.id)

    const reader = createMockReader({ [item.path]: SESSION_MARKDOWN })
    await enrichPlacedArtifact(node.id, item, '/vault', reader)

    // No crash, no nodes
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })
})
