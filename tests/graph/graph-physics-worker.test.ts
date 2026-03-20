import { describe, it, expect } from 'vitest'
import { createPhysicsEngine } from '@engine/graph-physics-worker'
import type { SimNode } from '@renderer/panels/graph/graph-types'

function makeNodes(count: number): SimNode[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    id: `node-${i}`,
    type: 'note' as const,
    signal: 'untested' as const,
    connectionCount: 0,
    isGhost: false
  }))
}

describe('graph-physics-engine', () => {
  it('creates an engine and returns ready state', () => {
    const engine = createPhysicsEngine()
    expect(engine).toBeDefined()
    expect(typeof engine.init).toBe('function')
    expect(typeof engine.tick).toBe('function')
    expect(typeof engine.drag).toBe('function')
  })

  it('initializes with nodes and produces positions', () => {
    const engine = createPhysicsEngine()
    const nodes = makeNodes(5)
    const edges = [{ source: 0, target: 1, kind: 'connection' as const }]
    engine.init(nodes, edges)
    const result = engine.tick()
    expect(result.buffer).toBeInstanceOf(Float32Array)
    expect(result.buffer.length).toBe(10) // 5 nodes * 2 (x,y)
    expect(typeof result.alpha).toBe('number')
    expect(typeof result.settled).toBe('boolean')
  })

  it('positions are finite numbers after init', () => {
    const engine = createPhysicsEngine()
    engine.init(makeNodes(3), [])
    const result = engine.tick()
    for (let i = 0; i < result.buffer.length; i++) {
      expect(Number.isFinite(result.buffer[i])).toBe(true)
    }
  })

  it('drag pins a node at the given position', () => {
    const engine = createPhysicsEngine()
    engine.init(makeNodes(3), [])
    engine.drag(0, 500, 500)
    const result = engine.tick()
    expect(Math.abs(result.buffer[0] - 500)).toBeLessThan(1)
    expect(Math.abs(result.buffer[1] - 500)).toBeLessThan(1)
  })

  it('drag-end releases a pinned node', () => {
    const engine = createPhysicsEngine()
    engine.init(makeNodes(3), [])
    engine.drag(0, 500, 500)
    engine.tick()
    engine.dragEnd(0)
    const result = engine.tick()
    expect(result.buffer).toBeInstanceOf(Float32Array)
  })

  it('reheat increases alpha', () => {
    const engine = createPhysicsEngine()
    engine.init(makeNodes(3), [])
    for (let i = 0; i < 500; i++) engine.tick()
    const before = engine.tick()
    expect(before.alpha).toBeLessThan(0.01)
    engine.reheat(0.5)
    const after = engine.tick()
    expect(after.alpha).toBeGreaterThan(before.alpha)
  })

  it('simulation converges with default params', () => {
    const engine = createPhysicsEngine()
    engine.init(makeNodes(10), [
      { source: 0, target: 1, kind: 'connection' as const },
      { source: 1, target: 2, kind: 'connection' as const },
      { source: 2, target: 3, kind: 'cluster' as const }
    ])
    let result = engine.tick()
    for (let i = 0; i < 600; i++) {
      result = engine.tick()
    }
    expect(result.settled).toBe(true)
    expect(result.alpha).toBeLessThan(0.002)
  })

  it('handles empty graph', () => {
    const engine = createPhysicsEngine()
    engine.init([], [])
    const result = engine.tick()
    expect(result.buffer.length).toBe(0)
    expect(result.settled).toBe(true)
  })
})
