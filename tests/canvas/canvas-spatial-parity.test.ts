import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'
import {
  CommandStack,
  duplicateSelectionCommand,
  copySelectionToClipboard,
  pasteClipboardCommand,
  clearCanvasClipboard,
  nudgeNodesCommand
} from '../../src/renderer/src/panels/canvas/canvas-commands'
import { isSpatialShortcutBlocked } from '../../src/renderer/src/panels/canvas/use-canvas-keyboard-shortcuts'
import {
  computeAlignmentSnap,
  ALIGN_SNAP_THRESHOLD_PX
} from '../../src/renderer/src/panels/canvas/canvas-alignment'

function fakeRect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect
}

describe('canvas spatial parity (3.7)', () => {
  let stack: CommandStack

  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
    useCanvasStore.getState().loadCanvas('/test/canvas.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    stack = new CommandStack()
    clearCanvasClipboard()
  })

  describe('duplicateSelectionCommand', () => {
    it('clones the selection with fresh ids at a +24 offset and selects the clones', async () => {
      const a = createCanvasNode('text', { x: 10, y: 20 }, { content: 'original' })
      const b = createCanvasNode('text', { x: 300, y: 20 })
      const edge = createCanvasEdge(a.id, b.id, 'right', 'left', 'connection')
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)
      s.addEdge(edge)
      s.setSelection(new Set([a.id, b.id]))

      const cmd = duplicateSelectionCommand()
      expect(cmd).not.toBeNull()
      stack.execute(cmd!)

      const after = useCanvasStore.getState()
      expect(after.nodes).toHaveLength(4)
      const clones = after.nodes.filter((n) => n.id !== a.id && n.id !== b.id)
      expect(clones).toHaveLength(2)
      const cloneA = clones.find((n) => n.content === 'original')
      expect(cloneA).toBeDefined()
      expect(cloneA!.position).toEqual({ x: 34, y: 44 })
      expect(cloneA!.id).not.toBe(a.id)
      // Intra-selection edge cloned and remapped to the fresh ids
      expect(after.edges).toHaveLength(2)
      const clonedEdge = after.edges.find((e) => e.id !== edge.id)
      expect(clonedEdge).toBeDefined()
      const cloneIds = new Set(clones.map((n) => n.id))
      expect(cloneIds.has(clonedEdge!.fromNode)).toBe(true)
      expect(cloneIds.has(clonedEdge!.toNode)).toBe(true)
      expect(clonedEdge!.kind).toBe('connection')
      // Clones become the selection
      expect(after.selectedNodeIds).toEqual(cloneIds)

      await stack.undo()
      const undone = useCanvasStore.getState()
      expect(undone.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort())
      expect(undone.edges.map((e) => e.id)).toEqual([edge.id])

      await stack.redo()
      const redone = useCanvasStore.getState()
      expect(redone.nodes).toHaveLength(4)
      // Redo re-inserts the SAME clone ids (built once at command build time)
      expect(new Set(redone.nodes.map((n) => n.id))).toEqual(new Set([a.id, b.id, ...cloneIds]))
    })

    it('does not clone edges that leave the selection', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      const outside = createCanvasNode('text', { x: 500, y: 0 })
      const edge = createCanvasEdge(a.id, outside.id, 'right', 'left')
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(outside)
      s.addEdge(edge)
      s.setSelection(new Set([a.id]))

      stack.execute(duplicateSelectionCommand()!)
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })

    it('never attaches a duplicated terminal card to the original PTY session', () => {
      const term = createCanvasNode('terminal', { x: 0, y: 0 }, { content: 'sess-live' })
      const s = useCanvasStore.getState()
      s.addNode(term)
      s.setSelection(new Set([term.id]))

      stack.execute(duplicateSelectionCommand()!)
      const clone = useCanvasStore.getState().nodes.find((n) => n.id !== term.id)
      expect(clone!.type).toBe('terminal')
      expect(clone!.content).toBe('')
    })

    it('returns null with an empty selection', () => {
      expect(duplicateSelectionCommand()).toBeNull()
    })

    it('undo kills the PTY a duplicated terminal spawned and clears focus/lock', async () => {
      const kill = vi.fn()
      ;(window as { api?: unknown }).api = { terminal: { kill } }
      try {
        const term = createCanvasNode('terminal', { x: 0, y: 0 }, { content: 'sess-original' })
        const s = useCanvasStore.getState()
        s.addNode(term)
        s.setSelection(new Set([term.id]))

        stack.execute(duplicateSelectionCommand()!)
        const clone = useCanvasStore.getState().nodes.find((n) => n.id !== term.id)!
        // TerminalCard spawns a session for the empty clone and writes the
        // live session id back into the node; the card may also be locked.
        useCanvasStore.getState().updateNodeContent(clone.id, 'sess-clone')
        useCanvasStore.getState().lockCard(clone.id)
        useCanvasStore.getState().setFocusedTerminal(clone.id)

        await stack.undo()
        const undone = useCanvasStore.getState()
        expect(kill).toHaveBeenCalledWith('sess-clone')
        expect(undone.nodes.map((n) => n.id)).toEqual([term.id])
        expect(undone.focusedCardId).toBeNull()
        expect(undone.lockedCardId).toBeNull()
        expect(undone.focusedTerminalId).toBeNull()
        expect(undone.selectedNodeIds.size).toBe(0)
      } finally {
        delete (window as { api?: unknown }).api
      }
    })
  })

  describe('copy / paste', () => {
    it('paste inserts fresh-id clones with cascading offsets; undo-redo round-trips', async () => {
      const a = createCanvasNode('text', { x: 100, y: 100 }, { content: 'copy me' })
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.setSelection(new Set([a.id]))

      expect(copySelectionToClipboard()).toBe(1)

      stack.execute(pasteClipboardCommand()!)
      stack.execute(pasteClipboardCommand()!)

      const after = useCanvasStore.getState()
      expect(after.nodes).toHaveLength(3)
      const pastes = after.nodes.filter((n) => n.id !== a.id)
      expect(new Set(pastes.map((n) => n.id)).size).toBe(2)
      expect(pastes.map((n) => n.position).sort((p, q) => p.x - q.x)).toEqual([
        { x: 124, y: 124 },
        { x: 148, y: 148 }
      ])
      expect(pastes.every((n) => n.content === 'copy me')).toBe(true)
      // Latest paste is selected
      const second = pastes.find((n) => n.position.x === 148)
      expect(after.selectedNodeIds).toEqual(new Set([second!.id]))

      await stack.undo()
      await stack.undo()
      expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual([a.id])

      await stack.redo()
      expect(useCanvasStore.getState().nodes).toHaveLength(2)
    })

    it('copies intra-selection edges and remaps them on paste', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      const b = createCanvasNode('text', { x: 300, y: 0 })
      const edge = createCanvasEdge(a.id, b.id, 'right', 'left', 'tension', 'pull')
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)
      s.addEdge(edge)
      s.setSelection(new Set([a.id, b.id]))

      copySelectionToClipboard()
      stack.execute(pasteClipboardCommand()!)

      const after = useCanvasStore.getState()
      const pastedEdge = after.edges.find((e) => e.id !== edge.id)
      expect(pastedEdge).toBeDefined()
      expect(pastedEdge!.kind).toBe('tension')
      expect(pastedEdge!.label).toBe('pull')
      expect([pastedEdge!.fromNode, pastedEdge!.toNode]).not.toContain(a.id)
      expect([pastedEdge!.fromNode, pastedEdge!.toNode]).not.toContain(b.id)
    })

    it('paste with an empty clipboard is a no-op command', () => {
      expect(pasteClipboardCommand()).toBeNull()
    })

    it('copy with an empty selection leaves the clipboard untouched', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.setSelection(new Set([a.id]))
      copySelectionToClipboard()
      s.clearSelection()
      expect(copySelectionToClipboard()).toBe(0)
      // Previous clipboard still pastes
      expect(pasteClipboardCommand()).not.toBeNull()
    })
  })

  describe('nudgeNodesCommand', () => {
    it('moves the nodes by the delta; undo restores, redo re-applies', async () => {
      const a = createCanvasNode('text', { x: 50, y: 60 })
      const b = createCanvasNode('text', { x: 200, y: 60 })
      const s = useCanvasStore.getState()
      s.addNode(a)
      s.addNode(b)

      stack.execute(nudgeNodesCommand([a.id, b.id], 1, 0)!)
      let positions = useCanvasStore.getState().nodes.map((n) => n.position)
      expect(positions).toEqual([
        { x: 51, y: 60 },
        { x: 201, y: 60 }
      ])

      stack.execute(nudgeNodesCommand([a.id], 0, -24)!)
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 51, y: 36 })

      await stack.undo()
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 51, y: 60 })

      await stack.undo()
      positions = useCanvasStore.getState().nodes.map((n) => n.position)
      expect(positions).toEqual([
        { x: 50, y: 60 },
        { x: 200, y: 60 }
      ])

      await stack.redo()
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 51, y: 60 })
    })

    it('returns null for zero delta or unknown ids', () => {
      const a = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(a)
      expect(nudgeNodesCommand([a.id], 0, 0)).toBeNull()
      expect(nudgeNodesCommand(['missing'], 1, 0)).toBeNull()
    })
  })

  describe('isSpatialShortcutBlocked', () => {
    function visibleContainerRef(): { current: HTMLElement } {
      const el = document.createElement('div')
      el.getBoundingClientRect = () => fakeRect(800, 600)
      return { current: el }
    }

    afterEach(() => {
      document.querySelectorAll('[role="menu"]').forEach((el) => el.remove())
    })

    it('blocks while a context menu is open so menu arrows do not nudge cards', () => {
      const ref = visibleContainerRef()
      expect(isSpatialShortcutBlocked(ref)).toBe(false)

      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      menu.getBoundingClientRect = () => fakeRect(160, 120)
      document.body.appendChild(menu)
      expect(isSpatialShortcutBlocked(ref)).toBe(true)

      menu.remove()
      expect(isSpatialShortcutBlocked(ref)).toBe(false)
    })

    it('ignores a zero-size menu hidden behind another KeepAlive tab', () => {
      const ref = visibleContainerRef()
      const hidden = document.createElement('div')
      hidden.setAttribute('role', 'menu')
      hidden.getBoundingClientRect = () => fakeRect(0, 0)
      document.body.appendChild(hidden)
      expect(isSpatialShortcutBlocked(ref)).toBe(false)
    })
  })

  describe('computeAlignmentSnap', () => {
    const neighbor = { x: 100, y: 100, width: 200, height: 100 }

    it('snaps left edges within the threshold and emits a vertical guide', () => {
      const moving = { x: 104, y: 400, width: 150, height: 80 }
      const result = computeAlignmentSnap(moving, [neighbor], ALIGN_SNAP_THRESHOLD_PX)
      expect(result.x).toBe(100)
      expect(result.y).toBe(400) // y unaffected
      const guide = result.guides.find((g) => g.axis === 'vertical')
      expect(guide).toBeDefined()
      expect(guide!.position).toBe(100)
      // Spans from the neighbor's top to the moving card's bottom
      expect(guide!.start).toBe(100)
      expect(guide!.end).toBe(480)
    })

    it('snaps centers on both axes', () => {
      // Neighbor center: (200, 150). Moving center lands within threshold of both.
      const moving = { x: 153, y: 113, width: 100, height: 80 }
      const result = computeAlignmentSnap(moving, [neighbor], ALIGN_SNAP_THRESHOLD_PX)
      expect(result.x + moving.width / 2).toBe(200)
      expect(result.y + moving.height / 2).toBe(150)
      expect(result.guides.some((g) => g.axis === 'vertical' && g.position === 200)).toBe(true)
      expect(result.guides.some((g) => g.axis === 'horizontal' && g.position === 150)).toBe(true)
    })

    it('does not snap outside the threshold', () => {
      const moving = { x: 110, y: 400, width: 150, height: 80 }
      const result = computeAlignmentSnap(moving, [neighbor], ALIGN_SNAP_THRESHOLD_PX)
      expect(result.x).toBe(110)
      expect(result.y).toBe(400)
      expect(result.guides).toHaveLength(0)
    })

    it('prefers the nearest candidate when several are within threshold', () => {
      const near = { x: 100, y: 0, width: 50, height: 50 }
      const nearer = { x: 102, y: 200, width: 50, height: 50 }
      const moving = { x: 103, y: 400, width: 50, height: 50 }
      const result = computeAlignmentSnap(moving, [near, nearer], ALIGN_SNAP_THRESHOLD_PX)
      expect(result.x).toBe(102)
    })

    it('right-edge to left-edge adjacency snaps too', () => {
      // Moving right edge (x+width) near neighbor's left edge (100)
      const moving = { x: -52, y: 400, width: 150, height: 80 }
      const result = computeAlignmentSnap(moving, [neighbor], ALIGN_SNAP_THRESHOLD_PX)
      expect(result.x + moving.width).toBe(100)
    })
  })
})
