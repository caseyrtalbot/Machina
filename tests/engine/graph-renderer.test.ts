import { describe, it, expect } from 'vitest'
import {
  createSimulation,
  type SimNode,
  type SimEdge
} from '../../src/renderer/src/panels/graph/GraphRenderer'

describe('GraphRenderer simulation', () => {
  it('creates simulation with nodes and edges', () => {
    const nodes: SimNode[] = [
      { id: 'g1', title: 'G1', type: 'gene', signal: 'core', connectionCount: 1, x: 0, y: 0 },
      { id: 'g2', title: 'G2', type: 'gene', signal: 'untested', connectionCount: 1, x: 0, y: 0 }
    ]
    const edges: SimEdge[] = [{ source: 'g1', target: 'g2', kind: 'connection' }]
    const sim = createSimulation(nodes, edges, 800, 600)
    expect(sim).toBeDefined()
    sim.stop()
  })
})
