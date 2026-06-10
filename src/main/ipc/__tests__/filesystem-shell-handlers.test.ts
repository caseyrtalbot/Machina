// @vitest-environment node
/**
 * Handler-level tests for the shell:* and fs:rename-file IPC handlers in
 * filesystem.ts. typedHandle is mocked to capture the real handler functions,
 * so these tests exercise the actual guard + dispatch logic: out-of-vault
 * paths must throw before any Electron shell call, and renames must re-key
 * open documents in the DocumentManager.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PathGuardError } from '@shared/agent-types'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => unknown>(),
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined)
  },
  rename: vi.fn().mockResolvedValue(undefined),
  documentManager: { rename: vi.fn() },
  vaultHistory: [] as string[]
}))

vi.mock('../config', () => ({
  readAppConfigValue: vi.fn((key: string) => (key === 'vaultHistory' ? state.vaultHistory : null))
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  shell: state.shell
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    state.handlers.set(channel, handler)
  })
}))

vi.mock('../../services/file-service', () => ({
  FileService: class {
    initVault = vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('../../services/vault-watcher', () => ({
  createVaultIgnoreFilter: vi.fn().mockResolvedValue(() => false)
}))

vi.mock('../../utils/vault-config', () => ({
  getIgnorePatterns: vi.fn().mockResolvedValue([])
}))

vi.mock('../documents', () => ({
  getDocumentManager: () => state.documentManager
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: state.rename }
})

import { registerFilesystemIpc } from '../filesystem'

function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(handler(args as never)) as Promise<T>
}

describe('shell + rename IPC handlers', () => {
  let vaultRoot: string

  beforeEach(async () => {
    state.handlers.clear()
    state.vaultHistory = []
    vi.clearAllMocks()

    const base = join(
      tmpdir(),
      `fs-shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(join(base, 'notes'), { recursive: true })
    writeFileSync(join(base, 'notes', 'test.md'), '# Test')
    vaultRoot = realpathSync(base)

    registerFilesystemIpc()
    await invoke('vault:init', { vaultPath: vaultRoot })
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('shell:trash-item rejects out-of-vault paths without touching the shell', async () => {
    await expect(invoke('shell:trash-item', { path: '/tmp/evil' })).rejects.toThrow(PathGuardError)
    expect(state.shell.trashItem).not.toHaveBeenCalled()
  })

  it('shell:trash-item uses shell.trashItem (recoverable), not rm', async () => {
    const target = join(vaultRoot, 'notes', 'test.md')
    await invoke('shell:trash-item', { path: target })
    expect(state.shell.trashItem).toHaveBeenCalledWith(target)
  })

  it('shell:open-path and shell:show-in-folder reject out-of-vault paths', async () => {
    await expect(invoke('shell:open-path', { path: '/etc/passwd' })).rejects.toThrow(PathGuardError)
    await expect(invoke('shell:show-in-folder', { path: '/etc/passwd' })).rejects.toThrow(
      PathGuardError
    )
    expect(state.shell.openPath).not.toHaveBeenCalled()
    expect(state.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('shell:show-in-folder allows a recent-vault root from persisted history', async () => {
    state.vaultHistory = ['/Users/someone/OtherVault']
    await invoke('shell:show-in-folder', { path: '/Users/someone/OtherVault' })
    expect(state.shell.showItemInFolder).toHaveBeenCalledWith('/Users/someone/OtherVault')
  })

  it('shell:show-in-folder still rejects out-of-vault paths not in history', async () => {
    state.vaultHistory = ['/Users/someone/OtherVault']
    await expect(invoke('shell:show-in-folder', { path: '/etc' })).rejects.toThrow(PathGuardError)
    expect(state.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('shell:open-external rejects non-http(s) URLs', async () => {
    await expect(invoke('shell:open-external', { url: 'file:///etc/passwd' })).rejects.toThrow()
    await expect(invoke('shell:open-external', { url: 'javascript:alert(1)' })).rejects.toThrow()
    expect(state.shell.openExternal).not.toHaveBeenCalled()

    await invoke('shell:open-external', { url: 'https://example.com' })
    expect(state.shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('fs:rename-file re-keys open documents via DocumentManager', async () => {
    const oldPath = join(vaultRoot, 'notes', 'test.md')
    const newPath = join(vaultRoot, 'notes', 'renamed.md')
    await invoke('fs:rename-file', { oldPath, newPath })
    expect(state.rename).toHaveBeenCalled()
    expect(state.documentManager.rename).toHaveBeenCalledWith(oldPath, newPath)
  })

  it('fs:list-all-files rejects out-of-vault directories', async () => {
    await expect(invoke('fs:list-all-files', { dir: '/tmp' })).rejects.toThrow(PathGuardError)
  })
})
