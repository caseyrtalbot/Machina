import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { SideDockRibbon } from '../SideDockRibbon'
import type { Thread } from '@shared/thread-types'

const sampleThread = (id: string, agent: Thread['agent'] = 'machina-native'): Thread => ({
  id,
  agent,
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T00:00:00.000Z',
  lastMessage: '2026-05-01T00:00:00.000Z',
  title: 'Sample',
  dockState: { tabs: [] },
  messages: []
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/v',
    activeThreadId: 'a',
    threadsById: { a: sampleThread('a') },
    dockTabsByThreadId: { a: [] }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: {
      save: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockImplementation(async (_v: string, agent: string, model: string) => ({
        id: 'created-1',
        agent,
        model,
        started: '2026-05-01T00:00:00.000Z',
        lastMessage: '2026-05-01T00:00:00.000Z',
        title: 'created',
        dockState: { tabs: [] },
        messages: []
      }))
    },
    agentNative: { abort: vi.fn().mockResolvedValue(undefined) },
    cliThread: {
      cancel: vi.fn().mockResolvedValue(undefined),
      spawn: vi.fn().mockResolvedValue({ ok: true })
    }
  }
})

describe('SideDockRibbon', () => {
  it('renders a 35px ribbon with the core actions', () => {
    const openPalette = vi.fn()
    render(<SideDockRibbon onOpenPalette={openPalette} onOpenSettings={() => {}} />)

    expect(screen.getByTestId('side-dock-ribbon').style.width).toBe('35px')
    expect(screen.getByLabelText('Collapse surface dock')).toBeTruthy()
    expect(screen.getByLabelText('Open command palette')).toBeTruthy()
    expect(screen.getByLabelText('New thread')).toBeTruthy()
    expect(screen.getByLabelText('Open canvas')).toBeTruthy()
    expect(screen.getByLabelText('Open graph')).toBeTruthy()
    expect(screen.getByLabelText('Open ghosts')).toBeTruthy()
    expect(screen.getByLabelText('Open health')).toBeTruthy()
    expect(screen.getByLabelText('Open settings')).toBeTruthy()
  })

  it('opens the command palette through the injected callback', () => {
    const openPalette = vi.fn()
    render(<SideDockRibbon onOpenPalette={openPalette} />)

    fireEvent.click(screen.getByLabelText('Open command palette'))

    expect(openPalette).toHaveBeenCalledTimes(1)
  })

  it('opens a surface tab and expands the dock if it was collapsed', () => {
    useThreadStore.setState({ dockCollapsed: true })
    render(<SideDockRibbon onOpenPalette={() => {}} />)

    fireEvent.click(screen.getByLabelText('Open graph'))

    expect(useThreadStore.getState().dockCollapsed).toBe(false)
    expect(useThreadStore.getState().dockTabsByThreadId.a).toEqual([{ kind: 'graph' }])
  })

  it('toggles auto-accept for native threads', async () => {
    render(<SideDockRibbon onOpenPalette={() => {}} />)

    fireEvent.click(screen.getByLabelText('Enable auto-accept'))

    await waitFor(() => {
      expect(useThreadStore.getState().threadsById.a.autoAcceptSession).toBe(true)
    })
  })

  it('stops an in-flight native run', async () => {
    useThreadStore.setState({ inFlightByThreadId: { a: true }, runIdByThreadId: { a: 'run-1' } })
    render(<SideDockRibbon onOpenPalette={() => {}} />)

    fireEvent.click(screen.getByLabelText('Stop active run'))

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).api.agentNative.abort).toHaveBeenCalledWith('run-1')
    })
  })

  it('opens the existing agent picker for new threads', () => {
    render(<SideDockRibbon onOpenPalette={() => {}} />)

    fireEvent.click(screen.getByLabelText('New thread'))

    expect(screen.getByText('/native')).toBeTruthy()
    expect(screen.getByText('/claude')).toBeTruthy()
    expect(screen.getByText('/codex')).toBeTruthy()
    expect(screen.getByText('/gemini')).toBeTruthy()
  })
})
