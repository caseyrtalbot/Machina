import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  stripToCanvas,
  canvasToStrip,
  openStripTerminal,
  openStripTerminalInFolder,
  toggleTerminalStrip,
  viewportWorldCenter
} from '../terminal-migration'
import { useDockStore } from '../../../store/dock-store'
import { useTerminalStripStore } from '../../../store/terminal-strip-store'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { getCanvasStore, DEFAULT_CANVAS_ID } from '../../../store/canvas-store'
import { createCanvasNode } from '@shared/canvas-types'

const THREAD = 't1'

const killMock = vi.fn().mockResolvedValue(undefined)
const selectVaultMock = vi.fn()

beforeEach(() => {
  useTerminalStripStore.setState(useTerminalStripStore.getInitialState(), true)
  useThreadStore.setState(useThreadStore.getInitialState())
  useDockStore.setState(useDockStore.getInitialState())
  useVaultStore.setState(useVaultStore.getInitialState())
  const canvas = getCanvasStore(DEFAULT_CANVAS_ID)
  canvas.setState(canvas.getInitialState(), true)

  killMock.mockClear()
  selectVaultMock.mockReset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    terminal: { kill: killMock },
    fs: { selectVault: selectVaultMock },
    thread: {
      readConfig: vi.fn().mockResolvedValue({}),
      writeConfig: vi.fn().mockResolvedValue(undefined)
    }
  }

  useThreadStore.setState({ activeThreadId: THREAD })
  useVaultStore.setState({ vaultPath: '/vault' })
})

describe('viewportWorldCenter', () => {
  it('maps the surface center through pan and zoom', () => {
    expect(viewportWorldCenter({ x: -100, y: 50, zoom: 2 }, { width: 800, height: 600 })).toEqual({
      x: 250,
      y: 125
    })
  })
})

describe('stripToCanvas', () => {
  it('returns null for an unbound session (sessionId "") and creates nothing', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')

    const node = stripToCanvas(THREAD, tabId)

    expect(node).toBeNull()
    expect(getCanvasStore(DEFAULT_CANVAS_ID).getState().nodes).toHaveLength(0)
    expect(useDockStore.getState().dockTabsByThreadId[THREAD] ?? []).toHaveLength(0)
    // Session stays in the strip untouched.
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.sessions).toHaveLength(1)
    expect(killMock).not.toHaveBeenCalled()
  })

  it('moves a bound session onto the canvas without ever killing the PTY', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/proj')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'sess-1')

    const node = stripToCanvas(THREAD, tabId)

    expect(node).not.toBeNull()
    if (!node) return
    // The canvas card carries the live session id and the strip cwd.
    expect(node.type).toBe('terminal')
    expect(node.content).toBe('sess-1')
    expect(node.metadata.initialCwd).toBe('/proj')
    const canvasNodes = getCanvasStore(DEFAULT_CANVAS_ID).getState().nodes
    expect(canvasNodes.map((n) => n.id)).toContain(node.id)
    // The canvas dock tab is opened so the new webview reconnects.
    expect(useDockStore.getState().dockTabsByThreadId[THREAD]).toContainEqual({
      kind: 'canvas',
      id: DEFAULT_CANVAS_ID
    })
    // Detached from the strip...
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.sessions).toHaveLength(0)
    // ...and the PTY is never killed anywhere in the flow.
    expect(killMock).not.toHaveBeenCalled()
  })
})

describe('canvasToStrip', () => {
  it('returns false for terminal nodes without content and touches nothing', () => {
    const node = createCanvasNode('terminal', { x: 0, y: 0 }, { content: '' })
    getCanvasStore(DEFAULT_CANVAS_ID).getState().addNode(node)

    expect(canvasToStrip(node)).toBe(false)
    expect(useTerminalStripStore.getState().byThreadId[THREAD]).toBeUndefined()
    expect(getCanvasStore(DEFAULT_CANVAS_ID).getState().nodes).toHaveLength(1)
    expect(killMock).not.toHaveBeenCalled()
  })

  it('attaches to the active thread strip and removes the card with preserveSession', () => {
    const node = createCanvasNode(
      'terminal',
      { x: 0, y: 0 },
      { content: 'sess-9', metadata: { initialCwd: '/proj' } }
    )
    const canvas = getCanvasStore(DEFAULT_CANVAS_ID)
    canvas.getState().addNode(node)
    const removeNodeSpy = vi.fn(canvas.getState().removeNode)
    canvas.setState({ removeNode: removeNodeSpy })

    expect(canvasToStrip(node)).toBe(true)

    const strip = useTerminalStripStore.getState().byThreadId[THREAD]
    expect(strip?.sessions).toHaveLength(1)
    expect(strip?.sessions[0].sessionId).toBe('sess-9')
    expect(strip?.sessions[0].cwd).toBe('/proj')
    expect(strip?.activeTabId).toBe(strip?.sessions[0].tabId)
    // Card removal goes through the preserveSession escape hatch, so the
    // terminal-card kill path in removeNode must never fire.
    expect(removeNodeSpy).toHaveBeenCalledWith(node.id, { preserveSession: true })
    expect(canvas.getState().nodes).toHaveLength(0)
    expect(killMock).not.toHaveBeenCalled()
  })

  it('falls back to the vault root when the card has no initialCwd', () => {
    const node = createCanvasNode('terminal', { x: 0, y: 0 }, { content: 'sess-2', metadata: {} })
    getCanvasStore(DEFAULT_CANVAS_ID).getState().addNode(node)

    expect(canvasToStrip(node)).toBe(true)
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.sessions[0].cwd).toBe('/vault')
  })

  it('returns false when no thread is active', () => {
    useThreadStore.setState({ activeThreadId: null })
    const node = createCanvasNode('terminal', { x: 0, y: 0 }, { content: 'sess-3' })

    expect(canvasToStrip(node)).toBe(false)
  })
})

describe('openStripTerminal', () => {
  it('spawns at the vault root on the active thread', () => {
    const tabId = openStripTerminal()

    expect(tabId).not.toBeNull()
    const strip = useTerminalStripStore.getState().byThreadId[THREAD]
    expect(strip?.sessions).toEqual([{ tabId, sessionId: '', cwd: '/vault' }])
  })

  it('expands a collapsed dock so the new session is visible', () => {
    useDockStore.setState({ dockCollapsed: true })

    openStripTerminal()

    expect(useDockStore.getState().dockCollapsed).toBe(false)
  })

  it('returns null without an active thread or vault root', () => {
    useThreadStore.setState({ activeThreadId: null })
    expect(openStripTerminal()).toBeNull()

    useThreadStore.setState({ activeThreadId: THREAD })
    useVaultStore.setState({ vaultPath: null })
    expect(openStripTerminal()).toBeNull()
  })

  it('prefers an explicit cwd over the vault root', () => {
    openStripTerminal('/elsewhere')
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.sessions[0].cwd).toBe('/elsewhere')
  })
})

describe('openStripTerminalInFolder', () => {
  it('returns null when the picker is cancelled', async () => {
    selectVaultMock.mockResolvedValue(null)
    expect(await openStripTerminalInFolder()).toBeNull()
    expect(useTerminalStripStore.getState().byThreadId[THREAD]).toBeUndefined()
  })

  it('spawns at the picked directory', async () => {
    selectVaultMock.mockResolvedValue('/picked')
    const tabId = await openStripTerminalInFolder()
    expect(tabId).not.toBeNull()
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.sessions[0].cwd).toBe('/picked')
  })
})

describe('toggleTerminalStrip', () => {
  it('spawns a session at the vault root when the strip is empty', () => {
    toggleTerminalStrip()

    const strip = useTerminalStripStore.getState().byThreadId[THREAD]
    expect(strip?.sessions).toHaveLength(1)
    expect(strip?.sessions[0].cwd).toBe('/vault')
    expect(strip?.collapsed).toBe(false)
  })

  it('toggles collapsed when sessions exist', () => {
    useTerminalStripStore.getState().spawn(THREAD, '/vault')

    toggleTerminalStrip()
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.collapsed).toBe(true)
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.sessions).toHaveLength(1)
    // Dock stays where it was — visible dock means plain strip toggle.
    expect(useDockStore.getState().dockCollapsed).toBe(false)

    toggleTerminalStrip()
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.collapsed).toBe(false)
  })

  it('expands a collapsed dock without collapsing an expanded strip', () => {
    useTerminalStripStore.getState().spawn(THREAD, '/vault') // strip expanded
    useDockStore.setState({ dockCollapsed: true })

    toggleTerminalStrip()

    expect(useDockStore.getState().dockCollapsed).toBe(false)
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.collapsed).toBe(false)
  })

  it('expands both the dock and a collapsed strip', () => {
    useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().toggleCollapsed(THREAD)
    useDockStore.setState({ dockCollapsed: true })

    toggleTerminalStrip()

    expect(useDockStore.getState().dockCollapsed).toBe(false)
    expect(useTerminalStripStore.getState().byThreadId[THREAD]?.collapsed).toBe(false)
  })

  it('does nothing without an active thread', () => {
    useThreadStore.setState({ activeThreadId: null })
    toggleTerminalStrip()
    expect(useTerminalStripStore.getState().byThreadId).toEqual({})
  })
})

describe('single-projection invariant (Phase 3 step 3)', () => {
  /**
   * Store-level surface references for one sessionId: strip entries + canvas
   * terminal cards. The retired `kind:'terminal'` DockTab removed the third
   * possible surface at the type level. Each store reference mounts at most
   * one webview, and `session-router.register` is last-writer-wins, so a
   * steady state of 2+ references means silent input contention — the state
   * this invariant forbids outside a single synchronous handover.
   */
  function projectionCount(sessionId: string): number {
    const stripCount = Object.values(useTerminalStripStore.getState().byThreadId)
      .flatMap((s) => s.sessions)
      .filter((sess) => sess.sessionId === sessionId).length
    const canvasCount = getCanvasStore(DEFAULT_CANVAS_ID)
      .getState()
      .nodes.filter((n) => n.type === 'terminal' && n.content === sessionId).length
    return stripCount + canvasCount
  }

  /** Record the projection count at every store mutation during fn. */
  function recordTransitions(sessionId: string, fn: () => void): number[] {
    const transitions: number[] = []
    const record = () => transitions.push(projectionCount(sessionId))
    const unsubStrip = useTerminalStripStore.subscribe(record)
    const unsubCanvas = getCanvasStore(DEFAULT_CANVAS_ID).subscribe(record)
    try {
      fn()
    } finally {
      unsubStrip()
      unsubCanvas()
    }
    return transitions
  }

  it('strip→canvas: destination attaches BEFORE the source detaches, ending at exactly one projection', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/proj')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'sess-inv')

    const transitions = recordTransitions('sess-inv', () => {
      expect(stripToCanvas(THREAD, tabId)).not.toBeNull()
    })

    // The count never touches 0 (a zero window would leave the PTY with no
    // owner to reconnect), and the transient 2 collapses back to exactly 1
    // before stripToCanvas returns: the whole handover is one synchronous
    // task, so React commits one frame in which the old webview unmounts and
    // the new one mounts, and last-writer-wins registration leaves one live
    // input path.
    expect(transitions.length).toBeGreaterThan(0)
    expect(Math.min(...transitions)).toBeGreaterThanOrEqual(1)
    expect(projectionCount('sess-inv')).toBe(1)
    expect(killMock).not.toHaveBeenCalled()
  })

  it('canvas→strip mirrors the ordering: attach first, then remove the card', () => {
    const node = createCanvasNode(
      'terminal',
      { x: 0, y: 0 },
      { content: 'sess-inv2', metadata: { initialCwd: '/proj' } }
    )
    getCanvasStore(DEFAULT_CANVAS_ID).getState().addNode(node)

    const transitions = recordTransitions('sess-inv2', () => {
      expect(canvasToStrip(node)).toBe(true)
    })

    expect(Math.min(...transitions)).toBeGreaterThanOrEqual(1)
    expect(projectionCount('sess-inv2')).toBe(1)
    expect(killMock).not.toHaveBeenCalled()
  })

  it('holds at exactly one projection across a full round trip, and a stale re-migration cannot mint a second', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/proj')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'sess-rt')

    const node = stripToCanvas(THREAD, tabId)
    expect(node).not.toBeNull()
    expect(projectionCount('sess-rt')).toBe(1)

    // Replaying the migration with the stale strip tabId must not create a
    // second card for the same PTY.
    expect(stripToCanvas(THREAD, tabId)).toBeNull()
    expect(projectionCount('sess-rt')).toBe(1)

    expect(canvasToStrip(node!)).toBe(true)
    expect(projectionCount('sess-rt')).toBe(1)
    expect(killMock).not.toHaveBeenCalled()
  })
})
