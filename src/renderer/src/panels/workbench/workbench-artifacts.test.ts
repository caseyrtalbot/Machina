import { describe, expect, it } from 'vitest'
import { TE_DIR } from '@shared/constants'
import type { CanvasEdge, CanvasNode } from '@shared/canvas-types'
import type { SessionMilestone, WorkbenchSessionEvent } from '@shared/workbench-types'
import {
  buildPatternArtifactDocument,
  buildSessionArtifactDocument,
  buildTensionArtifactDocument
} from './workbench-artifacts'

function createNode(overrides: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode {
  return {
    id: overrides.id,
    type: overrides.type,
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 200, height: 100 },
    content: overrides.content ?? '',
    metadata: overrides.metadata ?? {}
  }
}

describe('workbench artifacts', () => {
  it('builds a pattern document and snapshot from selected nodes', () => {
    const selectedNodes: CanvasNode[] = [
      createNode({
        id: 'terminal-1',
        type: 'terminal',
        metadata: { initialCwd: '/repo', initialCommand: 'npm test', isActive: true }
      }),
      createNode({
        id: 'file-1',
        type: 'project-file',
        content: 'src/index.ts',
        metadata: { relativePath: 'src/index.ts', filePath: '/repo/src/index.ts' }
      })
    ]
    const edges: CanvasEdge[] = [
      {
        id: 'edge-1',
        fromNode: 'terminal-1',
        toNode: 'file-1',
        fromSide: 'right',
        toSide: 'left'
      }
    ]

    const result = buildPatternArtifactDocument({
      projectName: 'thought-engine',
      projectPath: '/repo',
      now: new Date('2026-03-20T12:34:00Z'),
      selectedNodes,
      selectedNodeIds: new Set(['terminal-1', 'file-1']),
      edges
    })

    expect(result.id).toContain('p-20260320-')
    expect(result.snapshotPath).toBe(TE_DIR + '/artifacts/patterns/' + result.id + '.canvas.json')
    expect(result.snapshot.nodes).toHaveLength(2)
    expect(result.snapshot.edges).toHaveLength(1)
    expect(result.snapshot.nodes[0].metadata).not.toHaveProperty('isActive')
    expect(result.markdown).toContain('file_refs:')
    expect(result.markdown).toContain('src/index.ts')
    expect(result.markdown).toContain('npm test')
  })

  it('builds a tension document from the latest milestone and selected files', () => {
    const selectedNodes: CanvasNode[] = [
      createNode({
        id: 'file-1',
        type: 'project-file',
        metadata: { relativePath: 'src/app.tsx', filePath: '/repo/src/app.tsx' }
      })
    ]
    const milestones: SessionMilestone[] = [
      {
        id: 'm1',
        type: 'edit',
        timestamp: Date.parse('2026-03-20T12:00:00Z'),
        summary: 'Refined canvas toolbar flow',
        files: ['/repo/src/app.tsx'],
        events: []
      }
    ]

    const result = buildTensionArtifactDocument({
      projectName: 'thought-engine',
      projectPath: '/repo',
      now: new Date('2026-03-20T12:34:00Z'),
      selectedNodes,
      milestones
    })

    expect(result.id).toContain('t-20260320-')
    expect(result.markdown).toContain('Refined canvas toolbar flow')
    expect(result.markdown).toContain('src/app.tsx')
    expect(result.markdown).toContain('What remains unresolved')
  })

  it('builds a session document from milestones and session events', () => {
    const milestones: SessionMilestone[] = [
      {
        id: 'm2',
        type: 'command',
        timestamp: Date.parse('2026-03-20T12:10:00Z'),
        summary: 'Ran workbench verification',
        files: ['/repo/src/project.ts'],
        events: [
          { tool: 'Bash', timestamp: Date.parse('2026-03-20T12:10:00Z'), detail: 'npm run check' }
        ]
      },
      {
        id: 'm1',
        type: 'edit',
        timestamp: Date.parse('2026-03-20T12:00:00Z'),
        summary: 'Updated workbench sidebar',
        files: ['/repo/src/sidebar.tsx'],
        events: [
          {
            tool: 'Edit',
            timestamp: Date.parse('2026-03-20T12:00:00Z'),
            filePath: '/repo/src/sidebar.tsx'
          }
        ]
      }
    ]
    const sessionEvents: WorkbenchSessionEvent[] = [
      {
        type: 'file-edit',
        timestamp: Date.parse('2026-03-20T12:00:00Z'),
        sessionId: 'claude-a',
        filePath: '/repo/src/sidebar.tsx'
      },
      {
        type: 'bash-command',
        timestamp: Date.parse('2026-03-20T12:10:00Z'),
        sessionId: 'claude-a',
        detail: 'npm run check'
      }
    ]

    const result = buildSessionArtifactDocument({
      projectName: 'thought-engine',
      projectPath: '/repo',
      now: new Date('2026-03-20T12:34:00Z'),
      milestones,
      sessionEvents
    })

    expect(result.id).toContain('s-20260320-')
    expect(result.markdown).toContain('status: completed')
    expect(result.markdown).toContain('claude-a')
    expect(result.markdown).toContain('Updated workbench sidebar')
    expect(result.markdown).toContain('Files touched: 1')
  })
})
