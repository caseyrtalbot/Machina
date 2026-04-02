import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'

const mockEmergeGhost = vi.fn()

vi.stubGlobal('window', {
  ...window,
  api: {
    vault: {
      emergeGhost: mockEmergeGhost
    },
    document: {
      saveContent: vi.fn().mockResolvedValue(undefined)
    }
  }
})

const { useGhostEmerge } = await import('../useGhostEmerge')

describe('useGhostEmerge', () => {
  beforeEach(() => {
    mockEmergeGhost.mockReset()
    mockEmergeGhost.mockResolvedValue({
      filePath: '/test-vault/emerged-note.md',
      folderCreated: false,
      folderPath: '/test-vault'
    })

    useEditorStore.setState({
      activeNotePath: null,
      mode: 'rich',
      isDirty: false,
      content: '',
      cursorLine: 1,
      cursorCol: 1,
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })

    useVaultStore.setState({ vaultPath: '/test-vault' })
  })

  afterEach(() => {
    cleanup()
  })

  it('returns emerge function and isEmerging false initially', () => {
    const { result } = renderHook(() => useGhostEmerge())

    expect(typeof result.current.emerge).toBe('function')
    expect(result.current.isEmerging).toBe(false)
  })

  it('calls emergeGhost IPC with correct arguments', async () => {
    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'My Ghost Note', [
        '/test-vault/ref1.md',
        '/test-vault/ref2.md'
      ])
    })

    expect(mockEmergeGhost).toHaveBeenCalledWith(
      'ghost-123',
      'My Ghost Note',
      ['/test-vault/ref1.md', '/test-vault/ref2.md'],
      '/test-vault'
    )
  })

  it('navigates to emerged file path after success', async () => {
    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'My Ghost Note', ['/test-vault/ref1.md'])
    })

    expect(useEditorStore.getState().activeNotePath).toBe('/test-vault/emerged-note.md')
  })

  it('does nothing when vaultPath is null', async () => {
    useVaultStore.setState({ vaultPath: null })

    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'Title', ['/ref.md'])
    })

    expect(mockEmergeGhost).not.toHaveBeenCalled()
    expect(useEditorStore.getState().activeNotePath).toBeNull()
  })

  it('sets isEmerging true during the IPC call', async () => {
    let resolveEmerge!: (value: {
      filePath: string
      folderCreated: boolean
      folderPath: string
    }) => void
    mockEmergeGhost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEmerge = resolve
        })
    )

    const { result } = renderHook(() => useGhostEmerge())

    // Start emerge but don't resolve yet
    let emergePromise: Promise<void>
    act(() => {
      emergePromise = result.current.emerge('ghost-123', 'Title', ['/ref.md'])
    })

    // isEmerging should be true while awaiting
    expect(result.current.isEmerging).toBe(true)

    // Resolve the IPC call
    await act(async () => {
      resolveEmerge({
        filePath: '/test-vault/emerged-note.md',
        folderCreated: false,
        folderPath: '/test-vault'
      })
      await emergePromise!
    })

    // isEmerging should be false after completion
    expect(result.current.isEmerging).toBe(false)
  })

  it('resets isEmerging to false on error', async () => {
    mockEmergeGhost.mockRejectedValue(new Error('disk full'))

    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'Title', ['/ref.md'])
    })

    expect(result.current.isEmerging).toBe(false)
    // Should not navigate on error
    expect(useEditorStore.getState().activeNotePath).toBeNull()
  })

  it('prevents concurrent emerge calls', async () => {
    let resolveFirst!: (value: {
      filePath: string
      folderCreated: boolean
      folderPath: string
    }) => void
    mockEmergeGhost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )

    const { result } = renderHook(() => useGhostEmerge())

    // Start first emerge
    let firstPromise: Promise<void>
    act(() => {
      firstPromise = result.current.emerge('ghost-1', 'First', ['/ref.md'])
    })

    // Try second emerge while first is in flight
    await act(async () => {
      await result.current.emerge('ghost-2', 'Second', ['/ref2.md'])
    })

    // Only one call should have been made
    expect(mockEmergeGhost).toHaveBeenCalledTimes(1)

    // Complete the first call
    await act(async () => {
      resolveFirst({
        filePath: '/test-vault/first.md',
        folderCreated: false,
        folderPath: '/test-vault'
      })
      await firstPromise!
    })
  })
})
