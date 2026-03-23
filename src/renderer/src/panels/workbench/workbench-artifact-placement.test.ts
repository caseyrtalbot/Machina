import { describe, expect, it, beforeEach } from 'vitest'
import { TE_DIR } from '@shared/constants'
import { useCanvasStore } from '../../store/canvas-store'
import { useTabStore } from '../../store/tab-store'
import { placeArtifactOnWorkbench } from './workbench-artifact-placement'
import type { SystemArtifactListItem } from '../sidebar/Sidebar'

function makeItem(overrides: Partial<SystemArtifactListItem> = {}): SystemArtifactListItem {
  return {
    id: 't-20260320-test',
    path: `/vault/${TE_DIR}/artifacts/tensions/t-20260320-test.md`,
    title: 'Test tension',
    type: 'tension',
    modified: '2026-03-20',
    status: 'open',
    ...overrides
  }
}

describe('placeArtifactOnWorkbench', () => {
  beforeEach(() => {
    useCanvasStore.getState().closeCanvas()
    useTabStore.setState({ activeTabId: 'workbench' })
  })

  it('places a system-artifact node when workbench is active', () => {
    const item = makeItem()

    const nodeId = placeArtifactOnWorkbench(item)

    expect(nodeId).toBeTruthy()
    const nodes = useCanvasStore.getState().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('system-artifact')
    expect(nodes[0].content).toBe('Test tension')
    expect(nodes[0].metadata).toMatchObject({
      artifactKind: 'tension',
      artifactId: 't-20260320-test',
      status: 'open',
      filePath: `/vault/${TE_DIR}/artifacts/tensions/t-20260320-test.md`
    })
  })

  it('does not place when workbench tab is not active', () => {
    useTabStore.setState({ activeTabId: 'editor' })

    const nodeId = placeArtifactOnWorkbench(makeItem())

    expect(nodeId).toBeNull()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('skips duplicate placement for same artifact id', () => {
    const item = makeItem()

    const firstId = placeArtifactOnWorkbench(item)
    const secondId = placeArtifactOnWorkbench(item)

    expect(secondId).toBe(firstId)
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })

  it('places different artifact kinds with correct metadata', () => {
    const session = makeItem({
      id: 's-20260320-session',
      type: 'session',
      title: 'Dev session',
      status: 'completed'
    })
    const pattern = makeItem({
      id: 'p-20260320-pattern',
      type: 'pattern',
      title: 'TDD loop',
      status: 'active'
    })

    placeArtifactOnWorkbench(session)
    placeArtifactOnWorkbench(pattern)

    const nodes = useCanvasStore.getState().nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[0].metadata.artifactKind).toBe('session')
    expect(nodes[1].metadata.artifactKind).toBe('pattern')
  })
})
