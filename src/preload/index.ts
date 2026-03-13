import { contextBridge, ipcRenderer } from 'electron'
import type { VaultConfig, VaultState } from '../shared/types'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  config: {
    read: (scope: string, key: string) => ipcRenderer.invoke('config:read', { scope, key }),
    write: (scope: string, key: string, value: unknown) =>
      ipcRenderer.invoke('config:write', { scope, key, value })
  },
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:read-file', { path }),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('fs:write-file', { path, content }),
    listFiles: (dir: string, pattern?: string) =>
      ipcRenderer.invoke('fs:list-files', { dir, pattern }),
    listFilesRecursive: (dir: string) => ipcRenderer.invoke('fs:list-files-recursive', { dir }),
    deleteFile: (path: string) => ipcRenderer.invoke('fs:delete-file', { path }),
    selectVault: () => ipcRenderer.invoke('fs:select-vault')
  },
  vault: {
    init: (vaultPath: string) => ipcRenderer.invoke('vault:init', { vaultPath }),
    readConfig: (vaultPath: string) =>
      ipcRenderer.invoke('vault:read-config', { vaultPath }) as Promise<VaultConfig>,
    writeConfig: (vaultPath: string, config: VaultConfig) =>
      ipcRenderer.invoke('vault:write-config', { vaultPath, config }),
    readState: (vaultPath: string) =>
      ipcRenderer.invoke('vault:read-state', { vaultPath }) as Promise<VaultState>,
    writeState: (vaultPath: string, state: VaultState) =>
      ipcRenderer.invoke('vault:write-state', { vaultPath, state }),
    watchStart: (vaultPath: string) => ipcRenderer.invoke('vault:watch-start', { vaultPath }),
    watchStop: () => ipcRenderer.invoke('vault:watch-stop'),
    listCommands: (dirPath: string): Promise<string[]> =>
      ipcRenderer.invoke('vault:list-commands', dirPath),
    readFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('vault:read-file', filePath),
    deleteFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('fs:delete-file', { path: filePath })
  },
  terminal: {
    create: (cwd: string, shell?: string) =>
      ipcRenderer.invoke('terminal:create', { cwd, shell }) as Promise<string>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
    kill: (sessionId: string) => ipcRenderer.invoke('terminal:kill', { sessionId }),
    getProcessName: (sessionId: string) =>
      ipcRenderer.invoke('terminal:process-name', { sessionId }) as Promise<string | null>
  },
  on: {
    terminalData: (callback: (data: { sessionId: string; data: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { sessionId: string; data: string }) =>
        callback(data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    terminalExit: (callback: (data: { sessionId: string; code: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { sessionId: string; code: number }) =>
        callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    fileChanged: (
      callback: (data: { path: string; event: 'add' | 'change' | 'unlink' }) => void
    ) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        data: { path: string; event: 'add' | 'change' | 'unlink' }
      ) => callback(data)
      ipcRenderer.on('vault:file-changed', handler)
      return () => ipcRenderer.removeListener('vault:file-changed', handler)
    }
  }
}

export type ElectronApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
