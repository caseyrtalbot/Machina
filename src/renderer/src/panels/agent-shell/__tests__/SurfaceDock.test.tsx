import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, act, screen, within } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { SurfaceDock } from '../SurfaceDock'
import type { Thread } from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'

const tabsA: DockTab[] = [
  { kind: 'editor', path: '/v/A.md' },
  { kind: 'graph' },
  { kind: 'health' }
]
const tabsB: DockTab[] = [{ kind: 'editor', path: '/v/B.md' }]

const thread = (id: string): Thread => ({
  id,
  agent: 'machina-native',
  model: 'm',
  started: '',
  lastMessage: '',
  title: id,
  dockState: { tabs: [] },
  messages: []
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/v',
    threadsById: { a: thread('a'), b: thread('b') },
    dockTabsByThreadId: { a: tabsA, b: tabsB },
    activeThreadId: 'a'
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { fs: { fileExists: () => Promise.resolve(true) } }
})

function tabBar() {
  return screen.queryAllByRole('tab')
}

describe('SurfaceDock activeIndex on thread switch', () => {
  it('does not show the empty state when at a valid index', () => {
    render(<SurfaceDock />)
    expect(screen.queryByTestId('dock-empty-state')).toBeNull()
  })

  it('resets activeIndex to 0 when switching from a 3-tab thread to a 1-tab thread', () => {
    render(<SurfaceDock />)
    // activate index 2 ("health") on thread a
    fireEvent.click(tabBar()[2])
    expect(screen.queryByTestId('dock-empty-state')).toBeNull()

    // switch to thread b which has only 1 tab
    act(() => {
      useThreadStore.setState({ activeThreadId: 'b' })
    })

    // empty-state must NOT appear; the single editor tab on thread b is rendered
    expect(screen.queryByTestId('dock-empty-state')).toBeNull()
    // and the visible tab is the one from thread b
    const remaining = tabBar()
    expect(remaining).toHaveLength(1)
    expect(within(remaining[0]).getByText('B.md')).toBeTruthy()
  })

  it('survives a switch back to the multi-tab thread by starting at index 0', () => {
    render(<SurfaceDock />)
    fireEvent.click(tabBar()[2])
    act(() => {
      useThreadStore.setState({ activeThreadId: 'b' })
    })
    act(() => {
      useThreadStore.setState({ activeThreadId: 'a' })
    })
    // back on thread a; should show all 3 tabs and not crash
    expect(tabBar()).toHaveLength(3)
    expect(screen.queryByTestId('dock-empty-state')).toBeNull()
  })
})
