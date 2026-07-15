import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../../src/renderer/src/store/thread-store'
import { useDockStore } from '../../src/renderer/src/store/dock-store'

interface MockApi {
  thread: {
    readConfig: ReturnType<typeof vi.fn>
    writeConfig: ReturnType<typeof vi.fn>
  }
}

function installApiMock(cfg: Record<string, unknown> = {}): MockApi {
  const api: MockApi = {
    thread: {
      readConfig: vi.fn().mockResolvedValue(cfg),
      writeConfig: vi.fn().mockResolvedValue(undefined)
    }
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useDockStore.setState(useDockStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/vault',
    sidebarCollapsed: false,
    chatCollapsed: false,
    filesPanelOpen: false,
    focusMode: false,
    focusSnapshot: null
  })
  window.localStorage.clear()
  installApiMock()
})

describe('panel collapse invariants', () => {
  it('collapsing chat while the dock is collapsed re-expands the dock', () => {
    useDockStore.setState({ dockCollapsed: true })
    useThreadStore.getState().toggleChatCollapsed()
    expect(useThreadStore.getState().chatCollapsed).toBe(true)
    expect(useDockStore.getState().dockCollapsed).toBe(false)
  })

  it('collapsing the dock while chat is collapsed re-expands chat', () => {
    useThreadStore.setState({ chatCollapsed: true })
    useDockStore.getState().toggleDock()
    expect(useDockStore.getState().dockCollapsed).toBe(true)
    expect(useThreadStore.getState().chatCollapsed).toBe(false)
  })

  it('loadLayout never restores both chat and dock collapsed', async () => {
    installApiMock({ chatCollapsed: true, dockCollapsed: true })
    await useThreadStore.getState().loadLayout()
    expect(useThreadStore.getState().chatCollapsed).toBe(true)
    expect(useDockStore.getState().dockCollapsed).toBe(false)
  })
})

describe('focus mode', () => {
  it('hides sidebar, chat, and files; forces the dock visible', () => {
    useThreadStore.setState({ filesPanelOpen: true })
    useDockStore.setState({ dockCollapsed: true })
    useThreadStore.getState().toggleFocusMode()
    const s = useThreadStore.getState()
    expect(s.focusMode).toBe(true)
    expect(s.sidebarCollapsed).toBe(true)
    expect(s.chatCollapsed).toBe(true)
    expect(s.filesPanelOpen).toBe(false)
    expect(useDockStore.getState().dockCollapsed).toBe(false)
  })

  it('restores the prior panel visibility on exit', () => {
    useThreadStore.setState({ sidebarCollapsed: true, chatCollapsed: false, filesPanelOpen: true })
    useThreadStore.getState().toggleFocusMode()
    useThreadStore.getState().toggleFocusMode()
    const s = useThreadStore.getState()
    expect(s.focusMode).toBe(false)
    expect(s.sidebarCollapsed).toBe(true)
    expect(s.chatCollapsed).toBe(false)
    expect(s.filesPanelOpen).toBe(true)
  })

  it('restores a pre-focus collapsed dock on exit', () => {
    useThreadStore.setState({ chatCollapsed: false })
    useDockStore.setState({ dockCollapsed: true })
    useThreadStore.getState().toggleFocusMode()
    expect(useDockStore.getState().dockCollapsed).toBe(false)
    useThreadStore.getState().toggleFocusMode()
    expect(useDockStore.getState().dockCollapsed).toBe(true)
    expect(useThreadStore.getState().chatCollapsed).toBe(false)
  })

  it('entering focus mode does not persist the files panel state', () => {
    window.localStorage.setItem('te.files-side-panel-open', '1')
    useThreadStore.setState({ filesPanelOpen: true })
    useThreadStore.getState().toggleFocusMode()
    // localStorage untouched — quitting while focused restores pre-focus state.
    expect(window.localStorage.getItem('te.files-side-panel-open')).toBe('1')
  })

  it('a manual panel toggle exits focus mode without restoring the snapshot', () => {
    useThreadStore.getState().toggleFocusMode()
    useThreadStore.getState().toggleChatCollapsed()
    const s = useThreadStore.getState()
    expect(s.focusMode).toBe(false)
    expect(s.focusSnapshot).toBeNull()
    expect(s.chatCollapsed).toBe(false)
    // Sidebar stays as focus mode left it — no half-restore.
    expect(s.sidebarCollapsed).toBe(true)
  })
})

describe('selectThread reveal behavior', () => {
  it('boot-time selection (reveal: false) preserves a persisted chat collapse', async () => {
    useThreadStore.setState({ chatCollapsed: true })
    await useThreadStore.getState().selectThread('t1', { reveal: false })
    expect(useThreadStore.getState().chatCollapsed).toBe(true)
    expect(useThreadStore.getState().activeThreadId).toBe('t1')
  })

  it('user selection (default) re-expands a collapsed chat', async () => {
    useThreadStore.setState({ chatCollapsed: true })
    await useThreadStore.getState().selectThread('t1')
    expect(useThreadStore.getState().chatCollapsed).toBe(false)
  })
})

describe('chat width persistence', () => {
  it('clamps chatWidth to its minimum', () => {
    useThreadStore.getState().setChatWidth(50)
    expect(useThreadStore.getState().chatWidth).toBe(320)
  })

  it('persistLayout writes chat width and collapse states', async () => {
    const api = installApiMock({ welcomed: true })
    useThreadStore.getState().setChatWidth(500)
    useThreadStore.setState({ sidebarCollapsed: true })
    await useThreadStore.getState().persistLayout()
    expect(api.thread.writeConfig).toHaveBeenCalledWith(
      '/vault',
      expect.objectContaining({
        welcomed: true,
        chatWidth: 500,
        sidebarCollapsed: true,
        chatCollapsed: false
      })
    )
  })

  it('loadLayout reads chatWidth with a 420 default', async () => {
    installApiMock({})
    await useThreadStore.getState().loadLayout()
    expect(useThreadStore.getState().chatWidth).toBe(420)
  })
})

describe('files panel state', () => {
  it('toggleFilesPanel flips and persists to localStorage', () => {
    useThreadStore.getState().toggleFilesPanel()
    expect(useThreadStore.getState().filesPanelOpen).toBe(true)
    expect(window.localStorage.getItem('te.files-side-panel-open')).toBe('1')
    useThreadStore.getState().toggleFilesPanel()
    expect(useThreadStore.getState().filesPanelOpen).toBe(false)
    expect(window.localStorage.getItem('te.files-side-panel-open')).toBe('0')
  })
})
