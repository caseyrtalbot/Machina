import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { setErrorNotifier } from '../../utils/error-logger'

const mockEmergeGhost = vi.fn()
const mockReadFile = vi.fn()

vi.stubGlobal('window', {
  ...window,
  api: {
    vault: {
      emergeGhost: mockEmergeGhost
    },
    fs: {
      readFile: mockReadFile
    },
    document: {
      saveContent: vi.fn().mockResolvedValue(undefined)
    }
  }
})

const { useGhostEmerge } = await import('../useGhostEmerge')

const SYNTHESIZED_NOTE = '---\nid: emerged\ntitle: emerged\n---\n\nSynthesized body content.\n'
const EMPTY_NOTE = '---\nid: emerged\ntitle: emerged\n---\n\n'

describe('useGhostEmerge', () => {
  let notified: string[]

  beforeEach(() => {
    notified = []
    setErrorNotifier((message) => notified.push(message))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mockEmergeGhost.mockReset()
    mockEmergeGhost.mockResolvedValue({
      status: 'created',
      filePath: '/test-vault/emerged-note.md',
      folderCreated: false,
      folderPath: '/test-vault'
    })
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValue(SYNTHESIZED_NOTE)

    useEditorStore.setState({
      activeNotePath: null,
      mode: 'rich',
      isDirty: false,
      content: '',
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })

    useVaultStore.setState({ vaultPath: '/test-vault' })
  })

  afterEach(() => {
    setErrorNotifier(() => {})
    vi.restoreAllMocks()
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

  it('opens the emerged note in the editor after success', async () => {
    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'My Ghost Note', ['/test-vault/ref1.md'])
    })

    // openArtifactInEditor: tab opened and made active
    expect(useEditorStore.getState().activeNotePath).toBe('/test-vault/emerged-note.md')
    expect(useEditorStore.getState().openTabs.map((t) => t.path)).toContain(
      '/test-vault/emerged-note.md'
    )
    expect(notified).toEqual([])
  })

  it('notifies when the synthesized note came back empty (CLI fallback)', async () => {
    mockReadFile.mockResolvedValue(EMPTY_NOTE)
    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'My Ghost Note', ['/test-vault/ref1.md'])
    })

    // Note still opens; user is told synthesis fell back to an empty note
    expect(useEditorStore.getState().activeNotePath).toBe('/test-vault/emerged-note.md')
    expect(notified).toHaveLength(1)
    expect(notified[0]).toContain('My Ghost Note')
    expect(notified[0]).toContain('empty note')
  })

  it('does not open the editor when synthesis is denied at the gate', async () => {
    mockEmergeGhost.mockResolvedValue({ status: 'denied', reason: 'Approval gate not wired' })
    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'My Ghost Note', ['/test-vault/ref1.md'])
    })

    // Denied: no note written, so no editor tab and no read-back.
    expect(useEditorStore.getState().activeNotePath).toBeNull()
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(notified).toHaveLength(1)
    expect(notified[0]).toContain('My Ghost Note')
    expect(notified[0]).toContain('not approved')
  })

  it('notifies the user when emergence fails', async () => {
    mockEmergeGhost.mockRejectedValue(new Error('disk full'))

    const { result } = renderHook(() => useGhostEmerge())

    await act(async () => {
      await result.current.emerge('ghost-123', 'Title', ['/ref.md'])
    })

    expect(result.current.isEmerging).toBe(false)
    expect(useEditorStore.getState().activeNotePath).toBeNull()
    expect(notified).toHaveLength(1)
    expect(notified[0]).toContain('Title')
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
      status: 'created'
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
        status: 'created',
        filePath: '/test-vault/emerged-note.md',
        folderCreated: false,
        folderPath: '/test-vault'
      })
      await emergePromise!
    })

    // isEmerging should be false after completion
    expect(result.current.isEmerging).toBe(false)
  })

  it('prevents concurrent emerge calls', async () => {
    let resolveFirst!: (value: {
      status: 'created'
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
        status: 'created',
        filePath: '/test-vault/first.md',
        folderCreated: false,
        folderPath: '/test-vault'
      })
      await firstPromise!
    })
  })
})
