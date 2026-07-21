import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act, screen, within } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { useDockStore } from '../../../store/dock-store'
import { DEFAULT_CANVAS_ID } from '../../../store/canvas-store'
import { useTerminalStripStore } from '../../../store/terminal-strip-store'
import { TerminalStrip } from '../TerminalStrip'
import type { TerminalStripSession } from '@shared/dock-types'

// The real adapter renders a <webview> (unknown element in happy-dom) — stub it
// with a div that records the launch props it was mounted with.
vi.mock('../dock-adapters/TerminalDockAdapter', () => ({
  TerminalDockAdapter: (props: { sessionId: string; cwd: string }) => (
    <div data-testid="terminal-stub" data-session-id={props.sessionId} data-cwd={props.cwd} />
  )
}))

// Strip commands touch vault/canvas stores — out of scope for this component test.
vi.mock('../terminal-migration', () => ({
  openStripTerminal: vi.fn(),
  openStripTerminalInFolder: vi.fn(),
  stripToCanvas: vi.fn()
}))

const THREAD_ID = 't1'

const killMock = vi.fn(() => Promise.resolve())

function seedStrip(sessions: TerminalStripSession[], activeTabId: string | null) {
  act(() => {
    useTerminalStripStore.getState().seed(THREAD_ID, {
      sessions,
      activeTabId,
      collapsed: false,
      height: 240
    })
  })
}

function tab(tabId: string): HTMLElement {
  return screen.getByTestId(`terminal-strip-tab-${tabId}`)
}

function stubs(): HTMLElement[] {
  return screen.getAllByTestId('terminal-stub')
}

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useThreadStore.setState({ activeThreadId: THREAD_ID })
  // "Move to canvas" targets the FOCUSED canvas only — seed an active canvas tab.
  useDockStore.setState(useDockStore.getInitialState())
  useDockStore.setState({
    dockTabsByThreadId: { [THREAD_ID]: [{ kind: 'canvas', id: DEFAULT_CANVAS_ID }] },
    dockActiveIndexByThreadId: { [THREAD_ID]: 0 }
  })
  useTerminalStripStore.setState(useTerminalStripStore.getInitialState(), true)
  killMock.mockClear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { terminal: { kill: killMock } }
})

describe('TerminalStrip', () => {
  it('renders nothing when the active thread has no strip sessions', () => {
    const { container } = render(<TerminalStrip />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('terminal-strip')).toBeNull()
  })

  it('renders nothing when the strip exists but has zero sessions', () => {
    seedStrip([], null)
    render(<TerminalStrip />)
    expect(screen.queryByTestId('terminal-strip')).toBeNull()
  })

  it('renders one tab per session labeled with the basename of its cwd', () => {
    seedStrip(
      [
        { tabId: 'tab-1', sessionId: '', cwd: '/v/projects/alpha' },
        { tabId: 'tab-2', sessionId: '', cwd: '/v/projects/beta' }
      ],
      'tab-1'
    )
    render(<TerminalStrip />)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(within(tab('tab-1')).getByText('alpha')).toBeTruthy()
    expect(within(tab('tab-2')).getByText('beta')).toBeTruthy()
  })

  it('shows the new-terminal button', () => {
    seedStrip([{ tabId: 'tab-1', sessionId: '', cwd: '/v/alpha' }], 'tab-1')
    render(<TerminalStrip />)
    expect(screen.getByTestId('terminal-strip-new')).toBeTruthy()
  })

  it('activates a tab on click', () => {
    seedStrip(
      [
        { tabId: 'tab-1', sessionId: '', cwd: '/v/alpha' },
        { tabId: 'tab-2', sessionId: '', cwd: '/v/beta' }
      ],
      'tab-1'
    )
    render(<TerminalStrip />)
    expect(tab('tab-1').getAttribute('aria-selected')).toBe('true')

    fireEvent.click(tab('tab-2'))

    expect(tab('tab-2').getAttribute('aria-selected')).toBe('true')
    expect(tab('tab-1').getAttribute('aria-selected')).toBe('false')
    expect(useTerminalStripStore.getState().byThreadId[THREAD_ID].activeTabId).toBe('tab-2')
  })

  it('disables "Move to canvas" until the session is bound, then enables it', () => {
    seedStrip([{ tabId: 'tab-1', sessionId: '', cwd: '/v/alpha' }], 'tab-1')
    render(<TerminalStrip />)

    fireEvent.contextMenu(tab('tab-1'), { clientX: 40, clientY: 500 })
    const menu = screen.getByTestId('terminal-strip-menu')
    const moveItem = within(menu).getByRole('menuitem', {
      name: 'Move to canvas'
    }) as HTMLButtonElement
    expect(moveItem.disabled).toBe(true)

    // The webview reports session-created → the store rebinds → the open menu
    // re-renders with the action enabled.
    act(() => {
      useTerminalStripStore.getState().bindSession(THREAD_ID, 'tab-1', 'sess-1')
    })
    const rebound = within(screen.getByTestId('terminal-strip-menu')).getByRole('menuitem', {
      name: 'Move to canvas'
    }) as HTMLButtonElement
    expect(rebound.disabled).toBe(false)
  })

  it('disables "Move to canvas" when no canvas tab is focused', () => {
    // Replace the seeded canvas tab with a graph tab: no focused canvas.
    useDockStore.setState({
      dockTabsByThreadId: { [THREAD_ID]: [{ kind: 'graph' }] },
      dockActiveIndexByThreadId: { [THREAD_ID]: 0 }
    })
    seedStrip([{ tabId: 'tab-1', sessionId: 'sess-1', cwd: '/v/alpha' }], 'tab-1')
    render(<TerminalStrip />)

    fireEvent.contextMenu(tab('tab-1'), { clientX: 40, clientY: 500 })
    const menu = screen.getByTestId('terminal-strip-menu')
    const moveItem = within(menu).getByRole('menuitem', {
      name: 'Move to canvas'
    }) as HTMLButtonElement
    expect(moveItem.disabled).toBe(true)
  })

  it('keeps visited tabs mounted with display:none after switching away', () => {
    seedStrip(
      [
        { tabId: 'tab-1', sessionId: '', cwd: '/v/alpha' },
        { tabId: 'tab-2', sessionId: '', cwd: '/v/beta' }
      ],
      'tab-1'
    )
    render(<TerminalStrip />)
    // Only the active tab is mounted initially — unvisited tabs stay unmounted.
    expect(stubs()).toHaveLength(1)
    expect(stubs()[0].getAttribute('data-cwd')).toBe('/v/alpha')

    fireEvent.click(tab('tab-2'))

    // Both instances now exist; only the active one is display:block.
    const mounted = stubs()
    expect(mounted).toHaveLength(2)
    const byCwd = new Map(mounted.map((el) => [el.getAttribute('data-cwd'), el]))
    const alphaWrapper = byCwd.get('/v/alpha')?.parentElement
    const betaWrapper = byCwd.get('/v/beta')?.parentElement
    expect(alphaWrapper?.style.display).toBe('none')
    expect(betaWrapper?.style.display).toBe('block')
  })

  it('collapse button hides the strip body', () => {
    seedStrip([{ tabId: 'tab-1', sessionId: '', cwd: '/v/alpha' }], 'tab-1')
    render(<TerminalStrip />)
    const body = stubs()[0].parentElement?.parentElement
    expect(body?.style.display).toBe('block')
    expect(screen.queryByTestId('terminal-strip-resize')).toBeTruthy()

    fireEvent.click(screen.getByTestId('terminal-strip-collapse'))

    expect(body?.style.display).toBe('none')
    expect(screen.queryByTestId('terminal-strip-resize')).toBeNull()
    expect(useTerminalStripStore.getState().byThreadId[THREAD_ID].collapsed).toBe(true)
  })

  it('close button on a tab removes it and kills the bound PTY', () => {
    seedStrip(
      [
        { tabId: 'tab-1', sessionId: 'sess-1', cwd: '/v/alpha' },
        { tabId: 'tab-2', sessionId: '', cwd: '/v/beta' }
      ],
      'tab-1'
    )
    render(<TerminalStrip />)

    fireEvent.click(within(tab('tab-1')).getByRole('button', { name: 'Close terminal alpha' }))

    expect(screen.queryByTestId('terminal-strip-tab-tab-1')).toBeNull()
    expect(screen.getByTestId('terminal-strip-tab-tab-2')).toBeTruthy()
    expect(killMock).toHaveBeenCalledWith('sess-1')
    const strip = useTerminalStripStore.getState().byThreadId[THREAD_ID]
    expect(strip.sessions.map((s) => s.tabId)).toEqual(['tab-2'])
    expect(strip.activeTabId).toBe('tab-2')
  })
})
