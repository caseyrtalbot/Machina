import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAgentShellKeybindings } from '../keybindings'
import { useThreadStore } from '../../../store/thread-store'
import { useDockStore } from '../../../store/dock-store'
import { useVaultStore } from '../../../store/vault-store'
import { useEditorStore } from '../../../store/editor-store'
import { useUiStore } from '../../../store/ui-store'
import { toggleTerminalStrip } from '../terminal-migration'

vi.mock('../terminal-migration', () => ({
  toggleTerminalStrip: vi.fn()
}))

function fireKey(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }))
}

function defaultOpts() {
  return { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
}

const mockFs = {
  fileExists: vi.fn().mockResolvedValue(false),
  writeFile: vi.fn().mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFs.fileExists.mockResolvedValue(false)
  mockFs.writeFile.mockResolvedValue(undefined)
  // @ts-expect-error test stub
  window.api = { fs: mockFs }
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState({ vaultPath: null })
  useEditorStore.setState(useEditorStore.getInitialState())
  useUiStore.setState(useUiStore.getInitialState())
})

describe('useAgentShellKeybindings — Cmd+. abort', () => {
  it('cancels the active in-flight run on Cmd+.', () => {
    const cancelActive = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({
      activeThreadId: 't1',
      inFlightByThreadId: { t1: true },
      cancelActive
    })
    const opts = { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
    renderHook(() => useAgentShellKeybindings(opts))

    fireKey({ key: '.', metaKey: true })

    expect(cancelActive).toHaveBeenCalledWith('t1')
  })

  it('does nothing when no run is in flight', () => {
    const cancelActive = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({
      activeThreadId: 't1',
      inFlightByThreadId: {},
      cancelActive
    })
    const opts = { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
    renderHook(() => useAgentShellKeybindings(opts))

    fireKey({ key: '.', metaKey: true })

    expect(cancelActive).not.toHaveBeenCalled()
  })

  it('aborts even when the focus is in a textarea (composer)', () => {
    const cancelActive = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({
      activeThreadId: 't1',
      inFlightByThreadId: { t1: true },
      cancelActive
    })
    const opts = { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
    renderHook(() => useAgentShellKeybindings(opts))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    try {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true })
      )
      expect(cancelActive).toHaveBeenCalledWith('t1')
    } finally {
      textarea.remove()
    }
  })
})

describe('useAgentShellKeybindings — Cmd+N / Cmd+Shift+N', () => {
  it('Cmd+N creates an untitled note and opens it', async () => {
    useVaultStore.setState({ vaultPath: '/vault' })
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: 'n', metaKey: true })

    await vi.waitFor(() => {
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/vault/Untitled.md',
        expect.stringContaining('title: Untitled\n')
      )
      expect(useEditorStore.getState().activeNotePath).toBe('/vault/Untitled.md')
    })
  })

  it('Cmd+N is a no-op without a vault', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: 'n', metaKey: true })

    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+N creates a thread instead of a note', () => {
    const createThread = vi.fn().mockResolvedValue(undefined)
    useVaultStore.setState({ vaultPath: '/vault' })
    useThreadStore.setState({ createThread })
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: 'N', metaKey: true, shiftKey: true })

    expect(createThread).toHaveBeenCalledWith('machina-native', 'claude-sonnet-4-6')
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })
})

describe('useAgentShellKeybindings — editor history (Cmd+Opt+Left/Right)', () => {
  beforeEach(() => {
    useEditorStore.setState({
      historyStack: ['/vault/a.md', '/vault/b.md'],
      historyIndex: 1,
      activeNotePath: '/vault/b.md'
    })
  })

  it('Cmd+Opt+Left goes back', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: 'ArrowLeft', metaKey: true, altKey: true })

    expect(useEditorStore.getState().activeNotePath).toBe('/vault/a.md')
    expect(useEditorStore.getState().historyIndex).toBe(0)
  })

  it('Cmd+Opt+Right goes forward', () => {
    useEditorStore.setState({ historyIndex: 0, activeNotePath: '/vault/a.md' })
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: 'ArrowRight', metaKey: true, altKey: true })

    expect(useEditorStore.getState().activeNotePath).toBe('/vault/b.md')
    expect(useEditorStore.getState().historyIndex).toBe(1)
  })

  it('works from inside an editable target (the editor is contentEditable)', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    try {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          metaKey: true,
          altKey: true,
          bubbles: true
        })
      )
      expect(useEditorStore.getState().historyIndex).toBe(0)
    } finally {
      textarea.remove()
    }
  })
})

describe('useAgentShellKeybindings — panel toggles', () => {
  beforeEach(() => {
    useThreadStore.setState({
      vaultPath: '/vault',
      sidebarCollapsed: false,
      chatCollapsed: false,
      filesPanelOpen: false,
      focusMode: false,
      focusSnapshot: null
    })
    useDockStore.setState({ dockCollapsed: false })
    // persistLayout fires on toggles; stub the config IPC it reads/writes.
    // @ts-expect-error test stub
    window.api.thread = {
      readConfig: vi.fn().mockResolvedValue({}),
      writeConfig: vi.fn().mockResolvedValue(undefined)
    }
  })

  it('Cmd+Shift+B toggles the thread sidebar', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))
    fireKey({ key: 'B', metaKey: true, shiftKey: true })
    expect(useThreadStore.getState().sidebarCollapsed).toBe(true)
    fireKey({ key: 'B', metaKey: true, shiftKey: true })
    expect(useThreadStore.getState().sidebarCollapsed).toBe(false)
  })

  it('Cmd+Shift+C toggles the chat panel', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))
    fireKey({ key: 'C', metaKey: true, shiftKey: true })
    expect(useThreadStore.getState().chatCollapsed).toBe(true)
  })

  it('Cmd+Shift+V toggles the files panel', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))
    fireKey({ key: 'V', metaKey: true, shiftKey: true })
    expect(useThreadStore.getState().filesPanelOpen).toBe(true)
  })

  it('Cmd+Shift+F enters and exits focus mode', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))
    fireKey({ key: 'F', metaKey: true, shiftKey: true })
    const s = useThreadStore.getState()
    expect(s.focusMode).toBe(true)
    expect(s.sidebarCollapsed).toBe(true)
    expect(s.chatCollapsed).toBe(true)
    fireKey({ key: 'F', metaKey: true, shiftKey: true })
    expect(useThreadStore.getState().focusMode).toBe(false)
    expect(useThreadStore.getState().chatCollapsed).toBe(false)
  })

  it('panel toggles are suppressed inside editable targets', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    try {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'B', metaKey: true, shiftKey: true, bubbles: true })
      )
      expect(useThreadStore.getState().sidebarCollapsed).toBe(false)
    } finally {
      textarea.remove()
    }
  })
})

describe('useAgentShellKeybindings — Ctrl+` terminal strip toggle', () => {
  it('Ctrl+` dispatches toggleTerminalStrip', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: '`', ctrlKey: true })

    expect(toggleTerminalStrip).toHaveBeenCalledTimes(1)
  })

  it('fires even from inside an editable target', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    try {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: '`', ctrlKey: true, bubbles: true })
      )
      expect(toggleTerminalStrip).toHaveBeenCalledTimes(1)
    } finally {
      textarea.remove()
    }
  })

  it('Cmd+` (metaKey) does NOT trigger it — that chord is macOS window cycling', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))

    fireKey({ key: '`', metaKey: true })

    expect(toggleTerminalStrip).not.toHaveBeenCalled()
  })
})

describe('useAgentShellKeybindings — Cmd+Shift+O outline toggle', () => {
  it('toggles outline visibility', () => {
    renderHook(() => useAgentShellKeybindings(defaultOpts()))
    expect(useUiStore.getState().outlineVisible).toBe(false)

    fireKey({ key: 'O', metaKey: true, shiftKey: true })
    expect(useUiStore.getState().outlineVisible).toBe(true)

    fireKey({ key: 'O', metaKey: true, shiftKey: true })
    expect(useUiStore.getState().outlineVisible).toBe(false)
  })
})
