import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSaveTextCard } from '../useSaveTextCard'
import { useSettingsStore } from '../../../store/settings-store'
import { useVaultStore } from '../../../store/vault-store'
import { useCanvasStore } from '../../../store/canvas-store'

const mockFs = {
  mkdir: vi.fn(),
  listFiles: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  fileExists: vi.fn(),
  listAllFiles: vi.fn()
}

beforeEach(() => {
  vi.resetAllMocks()
  globalThis.window = globalThis.window ?? ({} as Window & typeof globalThis)
  // @ts-expect-error test stub
  window.api = { fs: mockFs }
  useSettingsStore.setState({ canvasTextSaveFolder: 'Inbox' })
  useVaultStore.setState({ vaultPath: '/vault' })
  useCanvasStore.setState({
    nodes: [
      {
        id: 'n1',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 },
        content: '# Hello World\nbody',
        metadata: {}
      }
    ]
  } as never)
})

describe('useSaveTextCard.saveQuick', () => {
  it('mkdir → list-files → write-file in order, with slugified name', async () => {
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.listFiles.mockResolvedValue([])
    mockFs.writeFile.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      await result.current.saveQuick('n1')
    })

    expect(mockFs.mkdir).toHaveBeenCalledWith('/vault/Inbox')
    expect(mockFs.listFiles).toHaveBeenCalledWith('/vault/Inbox', '*.md')
    expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/Inbox/hello-world.md', '# Hello World\nbody')

    const node = useCanvasStore.getState().nodes[0]
    expect(node.metadata.savedToPath).toBe('Inbox/hello-world.md')
    expect(node.metadata.savedContentHash).toBeTypeOf('string')
  })

  it('uses collision suffix when filename exists', async () => {
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.listFiles.mockResolvedValue(['hello-world.md'])
    mockFs.writeFile.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      await result.current.saveQuick('n1')
    })

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/vault/Inbox/hello-world (2).md',
      expect.any(String)
    )
  })

  it('returns error and leaves store unchanged when writeFile rejects', async () => {
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.listFiles.mockResolvedValue([])
    mockFs.writeFile.mockRejectedValue(new Error('disk full'))

    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      const r = await result.current.saveQuick('n1')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('disk full')
    })

    const node = useCanvasStore.getState().nodes[0]
    expect(node.metadata.savedToPath).toBeUndefined()
  })

  it('returns error when vault is not set', async () => {
    useVaultStore.setState({ vaultPath: null })
    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      const r = await result.current.saveQuick('n1')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/vault/i)
    })
  })
})

describe('useSaveTextCard.saveAsNew', () => {
  it('writes to user-picked folder with user-picked filename', async () => {
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.listFiles.mockResolvedValue([])
    mockFs.writeFile.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      await result.current.saveAsNew('n1', { folder: 'Notes/2026', filename: 'custom-name.md' })
    })

    expect(mockFs.mkdir).toHaveBeenCalledWith('/vault/Notes/2026')
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/vault/Notes/2026/custom-name.md',
      expect.any(String)
    )
  })
})

describe('useSaveTextCard.saveAppend', () => {
  it('reads target file, appends with blank line, writes back', async () => {
    mockFs.fileExists.mockResolvedValue(true)
    mockFs.readFile.mockResolvedValue('existing body')
    mockFs.writeFile.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      await result.current.saveAppend('n1', 'Notes/target.md')
    })

    expect(mockFs.readFile).toHaveBeenCalledWith('/vault/Notes/target.md')
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/vault/Notes/target.md',
      'existing body\n\n# Hello World\nbody'
    )
    const node = useCanvasStore.getState().nodes[0]
    expect(node.metadata.savedToPath).toBe('Notes/target.md')
  })

  it('returns error when target file no longer exists', async () => {
    mockFs.fileExists.mockResolvedValue(false)
    const { result } = renderHook(() => useSaveTextCard())
    await act(async () => {
      const r = await result.current.saveAppend('n1', 'Notes/missing.md')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/no longer exists/i)
    })
  })
})
