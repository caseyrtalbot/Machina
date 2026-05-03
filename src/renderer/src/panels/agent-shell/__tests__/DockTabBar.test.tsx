import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { DockTabBar } from '../DockTabBar'
import type { Thread } from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'

const tabs: DockTab[] = [{ kind: 'graph' }, { kind: 'ghosts' }, { kind: 'health' }]

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
    threadsById: { a: thread('a') },
    dockTabsByThreadId: { a: tabs.slice() },
    activeThreadId: 'a'
  })
})

describe('DockTabBar context menu', () => {
  it('right-click on a tab opens close / close-others / close-right', () => {
    render(<DockTabBar activeIndex={0} onActivate={() => {}} />)
    const firstTab = screen.getAllByRole('tab')[0]
    fireEvent.contextMenu(firstTab, { clientX: 50, clientY: 50 })
    expect(screen.getByText('Close tab')).toBeTruthy()
    expect(screen.getByText('Close other tabs')).toBeTruthy()
    expect(screen.getByText('Close tabs to the right')).toBeTruthy()
  })

  it('clicking Close other tabs leaves only the targeted tab', () => {
    render(<DockTabBar activeIndex={1} onActivate={() => {}} />)
    const ghosts = screen.getAllByRole('tab')[1]
    fireEvent.contextMenu(ghosts, { clientX: 50, clientY: 50 })
    fireEvent.click(screen.getByText('Close other tabs'))
    const remaining = useThreadStore.getState().dockTabsByThreadId['a']
    expect(remaining).toEqual([{ kind: 'ghosts' }])
  })

  it('clicking Close tabs to the right drops everything past the target', () => {
    render(<DockTabBar activeIndex={0} onActivate={() => {}} />)
    const graph = screen.getAllByRole('tab')[0]
    fireEvent.contextMenu(graph, { clientX: 50, clientY: 50 })
    fireEvent.click(screen.getByText('Close tabs to the right'))
    const remaining = useThreadStore.getState().dockTabsByThreadId['a']
    expect(remaining).toEqual([{ kind: 'graph' }])
  })
})
