// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Ensure process.contextIsolated is truthy so the preload takes the contextBridge path
// instead of trying to assign window.api (window doesn't exist in Node)
Object.defineProperty(process, 'contextIsolated', { value: true, writable: true })

// Mock electron so preload can be imported without a real Electron context
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn() },
  webUtils: { getPathForFile: vi.fn() }
}))

// Mock os.homedir
vi.mock('os', () => ({ homedir: () => '/home/test' }))

describe('vault:emerge-ghost IPC channel', () => {
  it('preload vault namespace exposes emergeGhost method', async () => {
    // Dynamic import after mocks are set up
    await import('../../src/preload/index')
    const { contextBridge } = await import('electron')
    const exposeCall = vi.mocked(contextBridge.exposeInMainWorld)

    expect(exposeCall).toHaveBeenCalled()
    const [namespace, api] = exposeCall.mock.calls[0] as [string, Record<string, unknown>]

    expect(namespace).toBe('api')
    expect(api).toHaveProperty('vault')

    const vault = api.vault as Record<string, unknown>
    expect(vault).toHaveProperty('emergeGhost')
    expect(typeof vault.emergeGhost).toBe('function')
  })

  it('emergeGhost calls ipcRenderer.invoke with correct channel and args', async () => {
    const { ipcRenderer } = await import('electron')
    const mockInvoke = vi.mocked(ipcRenderer.invoke)
    mockInvoke.mockResolvedValue({
      status: 'created',
      filePath: '/vault/emergent-concept.md',
      folderCreated: false,
      folderPath: '/vault'
    })

    const { contextBridge } = await import('electron')
    const exposeCall = vi.mocked(contextBridge.exposeInMainWorld)
    const [, api] = exposeCall.mock.calls[0] as [string, Record<string, unknown>]
    const vault = api.vault as Record<string, (...args: unknown[]) => Promise<unknown>>

    await vault.emergeGhost(
      'ghost-123',
      'Emergent Concept',
      ['/vault/note-a.md', '/vault/note-b.md'],
      '/vault'
    )

    expect(mockInvoke).toHaveBeenCalledWith('vault:emerge-ghost', {
      ghostId: 'ghost-123',
      ghostTitle: 'Emergent Concept',
      referencePaths: ['/vault/note-a.md', '/vault/note-b.md'],
      vaultPath: '/vault'
    })
  })
})
