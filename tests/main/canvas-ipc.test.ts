// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '/tmp/test-app-data' }
}))

// ---------------------------------------------------------------------------
// Mock fs/promises so canvas handler doesn't hit disk
// ---------------------------------------------------------------------------
const mockStat = vi.fn()
const mockReadFile = vi.fn()
vi.mock('fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args)
}))

// ---------------------------------------------------------------------------
// Mock window-registry
// ---------------------------------------------------------------------------
const mockGetMainWindow = vi.fn()
vi.mock('../../src/main/window-registry', () => ({
  getMainWindow: () => mockGetMainWindow()
}))

// ---------------------------------------------------------------------------
// Capture IPC registrations
// ---------------------------------------------------------------------------
import { ipcMain } from 'electron'

const mockHandle = vi.mocked(ipcMain.handle)

function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1]
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { registerCanvasIpc } from '../../src/main/ipc/canvas'

// ---------------------------------------------------------------------------
// Type-level tests: import types and verify shape at compile time
// ---------------------------------------------------------------------------
import type { IpcChannels, IpcEvents } from '../../src/shared/ipc-channels'
import type { CanvasMutationPlan } from '../../src/shared/canvas-mutation-types'
import type { McpServerOpts } from '../../src/main/services/mcp-server'

describe('canvas:apply-plan IPC handler', () => {
  const testMtime = '2026-04-01T00:00:00.000Z'

  const testPlan: CanvasMutationPlan = {
    id: 'plan_test1',
    operationId: 'op_1',
    source: 'agent',
    ops: [
      {
        type: 'add-node',
        node: {
          id: 'node-1',
          type: 'text',
          position: { x: 0, y: 0 },
          size: { width: 200, height: 100 },
          text: 'Test node'
        }
      }
    ],
    summary: {
      addedNodes: 1,
      addedEdges: 0,
      movedNodes: 0,
      skippedFiles: 0,
      unresolvedRefs: 0
    }
  }

  const canvasFile = {
    nodes: [],
    edges: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStat.mockResolvedValue({ mtime: { toISOString: () => testMtime } })
    mockReadFile.mockResolvedValue(JSON.stringify(canvasFile))
  })

  it('returns { accepted: true } on successful validation (not "applied")', async () => {
    registerCanvasIpc()

    const handler = getHandler('canvas:apply-plan')
    const result = await handler(
      {},
      {
        canvasPath: '/test/canvas.canvas',
        expectedMtime: testMtime,
        plan: testPlan
      }
    )

    // Must use `accepted`, NOT `applied`
    expect(result).toEqual({ accepted: true, mtime: testMtime })
    expect(result).not.toHaveProperty('applied')
  })

  it('dispatches plan to renderer via typedSend when window exists', async () => {
    const mockSend = vi.fn()
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: mockSend }
    }
    mockGetMainWindow.mockReturnValue(mockWindow)

    registerCanvasIpc()

    const handler = getHandler('canvas:apply-plan')
    await handler(
      {},
      {
        canvasPath: '/test/canvas.canvas',
        expectedMtime: testMtime,
        plan: testPlan
      }
    )

    // Verify typedSend dispatched the plan event
    expect(mockSend).toHaveBeenCalledWith('canvas:agent-plan-accepted', { plan: testPlan })
  })

  it('does not throw when no main window is available', async () => {
    mockGetMainWindow.mockReturnValue(null)

    registerCanvasIpc()

    const handler = getHandler('canvas:apply-plan')
    const result = await handler(
      {},
      {
        canvasPath: '/test/canvas.canvas',
        expectedMtime: testMtime,
        plan: testPlan
      }
    )

    // Still returns accepted even without a window
    expect(result).toEqual({ accepted: true, mtime: testMtime })
  })

  it('does not dispatch when validation fails', async () => {
    const mockSend = vi.fn()
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: mockSend }
    }
    mockGetMainWindow.mockReturnValue(mockWindow)

    registerCanvasIpc()

    // Plan references a node that doesn't exist
    const badPlan: CanvasMutationPlan = {
      ...testPlan,
      ops: [{ type: 'remove-node', nodeId: 'nonexistent' }]
    }

    const handler = getHandler('canvas:apply-plan')
    const result = await handler(
      {},
      {
        canvasPath: '/test/canvas.canvas',
        expectedMtime: testMtime,
        plan: badPlan
      }
    )

    expect(result).toHaveProperty('error', 'validation-failed')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not dispatch when mtime is stale', async () => {
    const mockSend = vi.fn()
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: mockSend }
    }
    mockGetMainWindow.mockReturnValue(mockWindow)

    registerCanvasIpc()

    const handler = getHandler('canvas:apply-plan')
    const result = await handler(
      {},
      {
        canvasPath: '/test/canvas.canvas',
        expectedMtime: '1999-01-01T00:00:00.000Z',
        plan: testPlan
      }
    )

    expect(result).toHaveProperty('error', 'stale')
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('IPC type contracts', () => {
  it('IpcChannels canvas:apply-plan response uses accepted (compile-time check)', () => {
    // This function would fail to compile if the type used `applied` instead of `accepted`
    type ApplyPlanResponse = IpcChannels['canvas:apply-plan']['response']
    type SuccessCase = Extract<ApplyPlanResponse, { accepted: boolean }>

    // If this compiles, the type has `accepted`
    const _check: SuccessCase = { accepted: true, mtime: '2026-01-01' }
    expect(_check.accepted).toBe(true)
  })

  it('IpcEvents includes canvas:agent-plan-accepted', () => {
    // This would fail to compile if the event doesn't exist in IpcEvents
    type PlanAcceptedData = IpcEvents['canvas:agent-plan-accepted']
    const _check: PlanAcceptedData = {
      plan: {
        id: 'test',
        operationId: 'op',
        source: 'agent',
        ops: [],
        summary: {
          addedNodes: 0,
          addedEdges: 0,
          movedNodes: 0,
          skippedFiles: 0,
          unresolvedRefs: 0
        }
      }
    }
    expect(_check.plan).toBeDefined()
  })
})

describe('McpServerOpts type contract', () => {
  it('accepts dispatchCanvasPlan callback', () => {
    // Compile-time verification that McpServerOpts accepts the callback
    const opts: McpServerOpts = {
      dispatchCanvasPlan: (_plan: CanvasMutationPlan) => {}
    }
    expect(opts.dispatchCanvasPlan).toBeDefined()
  })
})
