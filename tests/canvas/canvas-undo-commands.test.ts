import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'
import {
  CommandStack,
  setActiveCommandStack,
  getActiveCommandStack,
  removeNodesCommand,
  removeNodeViaCallback,
  addEdgeCommand,
  removeEdgeCommand,
  addNodeWithEdgeCommand,
  moveNodesCommand,
  resizeNodeCommand,
  convertNodeTypeCommand,
  layoutCommand,
  clearCanvasCommand
} from '../../src/renderer/src/panels/canvas/canvas-commands'

const killMock = vi.fn()

function installApiMock(): void {
  ;(window as unknown as { api: unknown }).api = { terminal: { kill: killMock } }
}

describe('canvas undo commands', () => {
  let stack: CommandStack

  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
    useCanvasStore.getState().loadCanvas('/test/canvas.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    stack = new CommandStack()
    killMock.mockClear()
    installApiMock()
  })

  describe('active stack registry', () => {
    it('registers and unregisters the active stack', () => {
      expect(getActiveCommandStack()).toBeNull()
      setActiveCommandStack(stack)
      expect(getActiveCommandStack()).toBe(stack)
      setActiveCommandStack(null)
      expect(getActiveCommandStack()).toBeNull()
    })
  })

  describe('removeNodesCommand', () => {
    it('removes nodes with attached edges; undo restores both; redo removes again', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      const b = createCanvasNode('text', { x: 200, y: 0 })
      const edge = createCanvasEdge(a.id, b.id, 'right', 'left')
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)
      s.addEdge(edge)

      const cmd = removeNodesCommand([a.id])
      expect(cmd).not.toBeNull()
      stack.execute(cmd!)
      expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual([b.id])
      expect(useCanvasStore.getState().edges).toHaveLength(0)

      await stack.undo()
      expect(useCanvasStore.getState().nodes).toHaveLength(2)
      expect(useCanvasStore.getState().edges).toHaveLength(1)
      expect(useCanvasStore.getState().edges[0].id).toBe(edge.id)

      await stack.redo()
      expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual([b.id])
      expect(useCanvasStore.getState().edges).toHaveLength(0)
    })

    it('returns null when no node matches', () => {
      expect(removeNodesCommand(['missing'])).toBeNull()
    })
  })

  describe('removeNodeViaCallback', () => {
    it('runs the card close callback; undo restores node and edges', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      const b = createCanvasNode('text', { x: 200, y: 0 })
      const edge = createCanvasEdge(a.id, b.id, 'right', 'left')
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)
      s.addEdge(edge)

      const onClose = vi.fn(() => useCanvasStore.getState().removeNode(a.id))
      const cmd = removeNodeViaCallback(a.id, onClose)
      stack.execute(cmd!)
      expect(onClose).toHaveBeenCalledOnce()
      expect(useCanvasStore.getState().nodes).toHaveLength(1)

      await stack.undo()
      expect(useCanvasStore.getState().nodes).toHaveLength(2)
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })

    it('undo is a no-op when the close callback never removed the node', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(a)

      // e.g. terminal close clicked during an in-flight restart: callback no-ops
      const onClose = vi.fn()
      const cmd = removeNodeViaCallback(a.id, onClose)
      stack.execute(cmd!)
      expect(useCanvasStore.getState().nodes).toHaveLength(1)

      await stack.undo()
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
    })
  })

  describe('removeNode hygiene (store)', () => {
    it('clears focusedCardId, lockedCardId, and focusedTerminalId for the removed node', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(a)
      useCanvasStore.setState({ focusedCardId: a.id, lockedCardId: a.id, focusedTerminalId: a.id })

      useCanvasStore.getState().removeNode(a.id)
      const after = useCanvasStore.getState()
      expect(after.focusedCardId).toBeNull()
      expect(after.lockedCardId).toBeNull()
      expect(after.focusedTerminalId).toBeNull()
    })

    it('kills the PTY session when removing a terminal node', () => {
      const term = createCanvasNode('terminal', { x: 0, y: 0 }, { content: 'sess-123' })
      useCanvasStore.getState().addNode(term)

      useCanvasStore.getState().removeNode(term.id)
      expect(killMock).toHaveBeenCalledWith('sess-123')
    })

    it('does not kill anything for non-terminal nodes', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 }, { content: 'sess-123' })
      useCanvasStore.getState().addNode(a)
      useCanvasStore.getState().removeNode(a.id)
      expect(killMock).not.toHaveBeenCalled()
    })
  })

  describe('moveNodesCommand', () => {
    it('undo restores start positions, redo re-applies end positions', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(a)
      const before = new Map([[a.id, { x: 0, y: 0 }]])
      const after = new Map([[a.id, { x: 150, y: 80 }]])

      stack.execute(moveNodesCommand(before, after))
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 150, y: 80 })

      await stack.undo()
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })

      await stack.redo()
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 150, y: 80 })
    })
  })

  describe('resizeNodeCommand', () => {
    it('undo restores start size, redo re-applies end size', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(a)
      const start = { ...a.size }

      stack.execute(resizeNodeCommand(a.id, start, { width: 500, height: 320 }))
      expect(useCanvasStore.getState().nodes[0].size).toEqual({ width: 500, height: 320 })

      await stack.undo()
      expect(useCanvasStore.getState().nodes[0].size).toEqual(start)

      await stack.redo()
      expect(useCanvasStore.getState().nodes[0].size).toEqual({ width: 500, height: 320 })
    })
  })

  describe('edge commands', () => {
    it('addEdgeCommand undo removes the edge', async () => {
      const edge = createCanvasEdge('a', 'b', 'right', 'left')
      stack.execute(addEdgeCommand(edge))
      expect(useCanvasStore.getState().edges).toHaveLength(1)

      await stack.undo()
      expect(useCanvasStore.getState().edges).toHaveLength(0)

      await stack.redo()
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })

    it('removeEdgeCommand undo restores the edge', async () => {
      const edge = createCanvasEdge('a', 'b', 'right', 'left')
      useCanvasStore.getState().addEdge(edge)

      const cmd = removeEdgeCommand(edge.id)
      stack.execute(cmd!)
      expect(useCanvasStore.getState().edges).toHaveLength(0)

      await stack.undo()
      expect(useCanvasStore.getState().edges).toHaveLength(1)
      expect(useCanvasStore.getState().edges[0].id).toBe(edge.id)
    })

    it('removeEdgeCommand returns null for a missing edge', () => {
      expect(removeEdgeCommand('missing')).toBeNull()
    })

    it('addNodeWithEdgeCommand adds and removes node+edge as one step', async () => {
      const src = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(src)
      const node = createCanvasNode('text', { x: 300, y: 0 })
      const edge = createCanvasEdge(src.id, node.id, 'right', 'left')

      stack.execute(addNodeWithEdgeCommand(node, edge))
      expect(useCanvasStore.getState().nodes).toHaveLength(2)
      expect(useCanvasStore.getState().edges).toHaveLength(1)

      await stack.undo()
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().edges).toHaveLength(0)
    })
  })

  describe('convertNodeTypeCommand', () => {
    it('preserves content for text→markdown and resets metadata', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 }, { content: '# Keep me' })
      useCanvasStore.getState().addNode(a)

      stack.execute(convertNodeTypeCommand(a.id, 'markdown')!)
      const converted = useCanvasStore.getState().nodes[0]
      expect(converted.type).toBe('markdown')
      expect(converted.content).toBe('# Keep me')
      expect(converted.metadata).toEqual({ viewMode: 'rendered' })

      await stack.undo()
      const restored = useCanvasStore.getState().nodes[0]
      expect(restored.type).toBe('text')
      expect(restored.content).toBe('# Keep me')
      expect(restored.metadata).toEqual(a.metadata)

      await stack.redo()
      expect(useCanvasStore.getState().nodes[0].type).toBe('markdown')
      expect(useCanvasStore.getState().nodes[0].content).toBe('# Keep me')
    })

    it('wipes content when converting to terminal, and undo restores it', async () => {
      const a = createCanvasNode('code', { x: 0, y: 0 }, { content: 'const x = 1' })
      useCanvasStore.getState().addNode(a)

      stack.execute(convertNodeTypeCommand(a.id, 'terminal')!)
      expect(useCanvasStore.getState().nodes[0].content).toBe('')

      await stack.undo()
      const restored = useCanvasStore.getState().nodes[0]
      expect(restored.type).toBe('code')
      expect(restored.content).toBe('const x = 1')
    })

    it('returns null for a no-op conversion', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(a)
      expect(convertNodeTypeCommand(a.id, 'text')).toBeNull()
      expect(convertNodeTypeCommand('missing', 'code')).toBeNull()
    })
  })

  describe('layoutCommand', () => {
    it('undo restores pre-layout positions', async () => {
      const a = createCanvasNode('text', { x: -500, y: -500 })
      const b = createCanvasNode('text', { x: 900, y: 700 })
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)

      const cmd = layoutCommand(() =>
        useCanvasStore.getState().applyTileLayout('grid-2x2', { x: 0, y: 0 })
      )
      stack.execute(cmd!)
      const tiled = useCanvasStore.getState().nodes.map((n) => ({ ...n.position }))
      expect(tiled).not.toEqual([
        { x: -500, y: -500 },
        { x: 900, y: 700 }
      ])

      await stack.undo()
      const positions = useCanvasStore.getState().nodes.map((n) => n.position)
      expect(positions).toEqual([
        { x: -500, y: -500 },
        { x: 900, y: 700 }
      ])

      await stack.redo()
      expect(useCanvasStore.getState().nodes.map((n) => ({ ...n.position }))).toEqual(tiled)
    })

    it('returns null on an empty canvas', () => {
      expect(layoutCommand(() => {})).toBeNull()
    })
  })

  describe('clearCanvasCommand', () => {
    it('clears everything; undo restores nodes and edges; redo clears again', async () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      const b = createCanvasNode('text', { x: 200, y: 0 })
      const edge = createCanvasEdge(a.id, b.id, 'right', 'left')
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)
      s.addEdge(edge)
      useCanvasStore.setState({ selectedNodeIds: new Set([a.id]), focusedCardId: a.id })

      stack.execute(clearCanvasCommand())
      const cleared = useCanvasStore.getState()
      expect(cleared.nodes).toHaveLength(0)
      expect(cleared.edges).toHaveLength(0)
      expect(cleared.selectedNodeIds.size).toBe(0)
      expect(cleared.focusedCardId).toBeNull()
      expect(cleared.isDirty).toBe(true)

      await stack.undo()
      const restored = useCanvasStore.getState()
      expect(restored.nodes.map((n) => n.id)).toEqual([a.id, b.id])
      expect(restored.edges.map((e) => e.id)).toEqual([edge.id])

      await stack.redo()
      expect(useCanvasStore.getState().nodes).toHaveLength(0)
    })
  })
})
