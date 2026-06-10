import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { CanvasNode } from '@shared/canvas-types'

// --- Mocks ---

const mockGetProcessName = vi.fn<(sessionId: string) => Promise<string | null>>()
let exitCallback: ((data: { sessionId: string; code: number }) => void) | null = null
const mockTerminalExit = vi.fn((cb: (data: { sessionId: string; code: number }) => void) => {
  exitCallback = cb
  return vi.fn() // unsubscribe
})

vi.stubGlobal('window', {
  api: {
    terminal: {
      getProcessName: mockGetProcessName
    },
    on: {
      terminalExit: mockTerminalExit
    }
  }
})

// Import after mocks are set up
const {
  useTerminalStatus,
  deriveLabel,
  deriveStatus,
  shellBaseName,
  SHELL_SET: _SHELL_SET
} = await import('../useTerminalStatus')
const { useBlockStore } = await import('../../../store/block-store')
const { pendingBlock, startBlock, completeBlock } = await import('@shared/engine/block-model')

function runningBlock(sessionId: string) {
  const r = startBlock(
    pendingBlock('b1', { sessionId, cwd: '/tmp', user: null, host: null, shellType: 'zsh' }),
    'sleep 99',
    1000
  )
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function completedBlock(sessionId: string) {
  const c = completeBlock(runningBlock(sessionId), 0, 2000)
  if (!c.ok) throw new Error(c.error)
  return c.value
}

// --- Helpers ---

function makeTerminalNode(
  overrides: Partial<CanvasNode> & { id?: string; content?: string } = {}
): CanvasNode {
  return {
    id: 'node-1',
    type: 'terminal' as const,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    content: 'session-abc',
    metadata: {},
    ...overrides
  }
}

// --- Pure function tests ---

describe('deriveLabel', () => {
  it('returns "Claude" when metadata.initialCommand is "claude"', () => {
    expect(deriveLabel({ initialCommand: 'claude' })).toBe('Claude')
  })

  it('returns basename when metadata.initialCwd is set', () => {
    expect(deriveLabel({ initialCwd: '/Users/casey/Projects/machina' })).toBe('machina')
  })

  it('returns "Terminal" when no relevant metadata', () => {
    expect(deriveLabel({})).toBe('Terminal')
  })
})

describe('deriveStatus', () => {
  it('returns "error" when settled with non-zero code', () => {
    const settled = new Map([['session-1', 1]])
    const processNames = new Map<string, string>()
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('error')
  })

  it('returns "dead" when settled with code 0', () => {
    const settled = new Map([['session-1', 0]])
    const processNames = new Map<string, string>()
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('dead')
  })

  it('returns "unknown" when not in processNames and not settled', () => {
    const settled = new Map<string, number>()
    const processNames = new Map<string, string>()
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('unknown')
  })

  it('returns "claude" when metadata.initialCommand is "claude"', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', 'claude']])
    expect(deriveStatus('session-1', settled, processNames, { initialCommand: 'claude' })).toBe(
      'claude'
    )
  })

  it('returns "idle" when process name is a shell', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', 'zsh']])
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('idle')
  })

  it('returns "busy" when process name is non-shell', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', 'npm']])
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('busy')
  })

  it('returns "idle" for full-path comm values (macOS ps returns /bin/zsh)', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', '/bin/zsh']])
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('idle')
  })

  it('returns "idle" for login-shell comm values (-zsh)', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', '-zsh']])
    expect(deriveStatus('session-1', settled, processNames, {})).toBe('idle')
  })

  it('derives "busy" from a running block, overriding the shell process name', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', '/bin/zsh']])
    expect(deriveStatus('session-1', settled, processNames, {}, [runningBlock('session-1')])).toBe(
      'busy'
    )
  })

  it('derives "idle" from settled blocks even when ps reports a non-shell', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', 'npm']])
    expect(
      deriveStatus('session-1', settled, processNames, {}, [completedBlock('session-1')])
    ).toBe('idle')
  })

  it('falls back to process-name matching when the session has no blocks', () => {
    const settled = new Map<string, number>()
    const processNames = new Map([['session-1', 'npm']])
    expect(deriveStatus('session-1', settled, processNames, {}, [])).toBe('busy')
  })
})

describe('shellBaseName', () => {
  it('strips path and login-shell dash', () => {
    expect(shellBaseName('/bin/zsh')).toBe('zsh')
    expect(shellBaseName('-zsh')).toBe('zsh')
    expect(shellBaseName('zsh')).toBe('zsh')
    expect(shellBaseName('/usr/local/bin/fish')).toBe('fish')
  })
})

// --- Hook tests ---

describe('useTerminalStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useBlockStore.setState(useBlockStore.getInitialState())
    mockGetProcessName.mockReset()
    mockTerminalExit.mockReset()
    exitCallback = null
    mockTerminalExit.mockImplementation(
      (cb: (data: { sessionId: string; code: number }) => void) => {
        exitCallback = cb
        return vi.fn()
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('returns "unknown" for all terminals before first poll completes', () => {
    // getProcessName never resolves
    mockGetProcessName.mockReturnValue(new Promise(() => {}))

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].status).toBe('unknown')
  })

  it('returns "idle" when process name matches shell set (zsh)', async () => {
    mockGetProcessName.mockResolvedValue('zsh')

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    // Flush the immediate poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].status).toBe('idle')
    expect(result.current[0].processName).toBe('zsh')
  })

  it('returns "busy" when process name is non-shell (npm)', async () => {
    mockGetProcessName.mockResolvedValue('npm')

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].status).toBe('busy')
    expect(result.current[0].processName).toBe('npm')
  })

  it('reports "busy" from a running block even when ps sees only the shell', async () => {
    mockGetProcessName.mockResolvedValue('/bin/zsh')
    useBlockStore.getState().applyUpdate('session-abc', runningBlock('session-abc'))

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current[0].status).toBe('busy')

    // Block completes → back to idle.
    act(() => {
      useBlockStore.getState().applyUpdate('session-abc', completedBlock('session-abc'))
    })
    expect(result.current[0].status).toBe('idle')
  })

  it('returns "claude" when metadata.initialCommand === "claude"', async () => {
    mockGetProcessName.mockResolvedValue('claude')

    const nodes = [makeTerminalNode({ metadata: { initialCommand: 'claude' } })]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].status).toBe('claude')
    expect(result.current[0].label).toBe('Claude')
  })

  it('returns "error" on exit with non-zero code', async () => {
    mockGetProcessName.mockResolvedValue('zsh')

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current[0].status).toBe('idle')

    // Simulate exit with error
    act(() => {
      exitCallback?.({ sessionId: 'session-abc', code: 1 })
    })

    expect(result.current[0].status).toBe('error')
  })

  it('returns "dead" on exit with code 0', async () => {
    mockGetProcessName.mockResolvedValue('zsh')

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Simulate clean exit
    act(() => {
      exitCallback?.({ sessionId: 'session-abc', code: 0 })
    })

    expect(result.current[0].status).toBe('dead')
  })

  it('returns "dead" when getProcessName rejects', async () => {
    mockGetProcessName.mockRejectedValue(new Error('session gone'))

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current[0].status).toBe('dead')
  })

  it('ignores poll results for settled sessions', async () => {
    // First poll succeeds
    mockGetProcessName.mockResolvedValue('zsh')

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current[0].status).toBe('idle')

    // Terminal exits with error
    act(() => {
      exitCallback?.({ sessionId: 'session-abc', code: 1 })
    })

    expect(result.current[0].status).toBe('error')

    // Next poll returns a process name, but should be ignored because settled
    mockGetProcessName.mockResolvedValue('npm')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    // Still error, not busy
    expect(result.current[0].status).toBe('error')
  })

  it('poll reject does not overwrite settled error with dead', async () => {
    // First poll starts (slow, will reject)
    mockGetProcessName.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), 100)
        })
    )

    const nodes = [makeTerminalNode()]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    // Exit fires with error code before the poll rejects
    act(() => {
      exitCallback?.({ sessionId: 'session-abc', code: 1 })
    })

    expect(result.current[0].status).toBe('error')

    // Now let the poll rejection land
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // Status should remain error, NOT flip to dead
    expect(result.current[0].status).toBe('error')
  })

  it('skips nodes with empty content', async () => {
    mockGetProcessName.mockResolvedValue('zsh')

    const nodes = [
      makeTerminalNode({ id: 'node-1', content: '' }),
      makeTerminalNode({ id: 'node-2', content: 'session-xyz' })
    ]
    const { result } = renderHook(() => useTerminalStatus(nodes))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // The empty content node should still be in the output with unknown status
    // since it has no sessionId to poll
    const emptyNode = result.current.find((s) => s.nodeId === 'node-1')
    const activeNode = result.current.find((s) => s.nodeId === 'node-2')

    expect(emptyNode?.status).toBe('unknown')
    expect(activeNode?.status).toBe('idle')
    // getProcessName should only be called for the active session
    expect(mockGetProcessName).toHaveBeenCalledTimes(1)
  })

  it('dead terminals sort to end, others maintain insertion order', async () => {
    const resolvers: Record<string, (value: string | null) => void> = {}
    mockGetProcessName.mockImplementation(
      (sessionId: string) =>
        new Promise((resolve) => {
          resolvers[sessionId] = resolve
        })
    )

    const nodes = [
      makeTerminalNode({ id: 'node-a', content: 'session-a' }),
      makeTerminalNode({ id: 'node-b', content: 'session-b' }),
      makeTerminalNode({ id: 'node-c', content: 'session-c' })
    ]

    const { result } = renderHook(() => useTerminalStatus(nodes))

    // Resolve all polls
    await act(async () => {
      resolvers['session-a']?.('zsh')
      resolvers['session-b']?.('npm')
      resolvers['session-c']?.('zsh')
      await vi.advanceTimersByTimeAsync(0)
    })

    // All alive, insertion order
    expect(result.current.map((s) => s.nodeId)).toEqual(['node-a', 'node-b', 'node-c'])

    // Kill middle terminal
    act(() => {
      exitCallback?.({ sessionId: 'session-b', code: 0 })
    })

    // Dead (node-b) sinks to end
    expect(result.current.map((s) => s.nodeId)).toEqual(['node-a', 'node-c', 'node-b'])
  })
})
