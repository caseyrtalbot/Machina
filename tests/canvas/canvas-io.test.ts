import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  serializeCanvas,
  deserializeCanvas,
  loadCanvasFromDisk,
  defaultCanvasFilename
} from '../../src/renderer/src/panels/canvas/canvas-io'
import { createCanvasFile, createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'
import { setErrorNotifier } from '../../src/renderer/src/utils/error-logger'

function expectOk(result: ReturnType<typeof deserializeCanvas>) {
  if (!result.ok) throw new Error(`expected ok result, got error: ${result.error}`)
  return result.value
}

describe('canvas-io', () => {
  describe('serializeCanvas', () => {
    it('serializes an empty canvas to pretty JSON', () => {
      const file = createCanvasFile()
      const json = serializeCanvas(file)
      const parsed = JSON.parse(json)
      expect(parsed.nodes).toEqual([])
      expect(parsed.edges).toEqual([])
      expect(parsed.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    })

    it('round-trips nodes and edges', () => {
      const node1 = createCanvasNode('text', { x: 10, y: 20 }, { content: 'Hello' })
      const node2 = createCanvasNode('note', { x: 300, y: 20 }, { content: '/notes/foo.md' })
      const edge = createCanvasEdge(node1.id, node2.id, 'right', 'left')
      const file = { nodes: [node1, node2], edges: [edge], viewport: { x: 0, y: 0, zoom: 1 } }

      const json = serializeCanvas(file)
      const restored = expectOk(deserializeCanvas(json))

      expect(restored.nodes).toHaveLength(2)
      expect(restored.nodes[0].content).toBe('Hello')
      expect(restored.edges).toHaveLength(1)
      expect(restored.edges[0].fromNode).toBe(node1.id)
    })
  })

  describe('deserializeCanvas', () => {
    it('returns an error for empty/invalid input instead of an empty canvas', () => {
      expect(deserializeCanvas('')).toMatchObject({ ok: false })
      expect(deserializeCanvas('not json')).toMatchObject({ ok: false })
      expect(deserializeCanvas('{"nodes": [truncated')).toMatchObject({ ok: false })
    })

    it('fills missing viewport with defaults', () => {
      const json = JSON.stringify({ nodes: [], edges: [] })
      const result = expectOk(deserializeCanvas(json))
      expect(result.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    })
  })

  describe('loadCanvasFromDisk', () => {
    const canvasPath = '/vault/.machina/canvas.json'
    const readFile = vi.fn<(path: string) => Promise<string>>()
    const copyFile = vi.fn<(src: string, dest: string) => Promise<void>>()
    const notify = vi.fn<(message: string) => void>()

    beforeEach(() => {
      readFile.mockReset()
      copyFile.mockReset().mockResolvedValue(undefined)
      notify.mockReset()
      setErrorNotifier(notify)
      vi.stubGlobal('window', {
        api: { fs: { readFile, copyFile } }
      } as unknown as Window & typeof globalThis)
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      setErrorNotifier(() => {})
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('returns the parsed canvas for valid JSON', async () => {
      readFile.mockResolvedValue(serializeCanvas(createCanvasFile()))
      const file = await loadCanvasFromDisk(canvasPath)
      expect(file).not.toBeNull()
      expect(file?.nodes).toEqual([])
      expect(copyFile).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    })

    it('corrupt canvas.json: creates .bak, surfaces error, returns null (no empty canvas)', async () => {
      readFile.mockResolvedValue('{"nodes": [{"id": "half-writ')
      const file = await loadCanvasFromDisk(canvasPath)
      expect(file).toBeNull()
      expect(copyFile).toHaveBeenCalledWith(canvasPath, `${canvasPath}.bak`)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0][0]).toContain(`${canvasPath}.bak`)
    })

    it('still surfaces an error when the .bak copy itself fails', async () => {
      readFile.mockResolvedValue('not json')
      copyFile.mockRejectedValue(new Error('EACCES'))
      const file = await loadCanvasFromDisk(canvasPath)
      expect(file).toBeNull()
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0][0]).toContain('backup')
    })
  })

  describe('defaultCanvasFilename', () => {
    it('generates Untitled.canvas', () => {
      expect(defaultCanvasFilename([])).toBe('Untitled.canvas')
    })

    it('increments when name exists', () => {
      expect(defaultCanvasFilename(['Untitled.canvas'])).toBe('Untitled 1.canvas')
      expect(defaultCanvasFilename(['Untitled.canvas', 'Untitled 1.canvas'])).toBe(
        'Untitled 2.canvas'
      )
    })
  })
})
