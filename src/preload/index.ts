import { contextBridge, webUtils } from 'electron'
import { homedir } from 'os'
import { typedInvoke, typedOn } from './typed-ipc'
import type { SessionId, VaultConfig, VaultState } from '../shared/types'

const api = {
  window: {
    minimize: () => typedInvoke('window:minimize'),
    maximize: () => typedInvoke('window:maximize'),
    close: () => typedInvoke('window:close')
  },
  config: {
    read: (scope: string, key: string) => typedInvoke('config:read', { scope, key }),
    write: (scope: string, key: string, value: unknown) =>
      typedInvoke('config:write', { scope, key, value })
  },
  fs: {
    readFile: (path: string) => typedInvoke('fs:read-file', { path }),
    writeFile: (path: string, content: string) => typedInvoke('fs:write-file', { path, content }),
    listFiles: (dir: string, pattern?: string) => typedInvoke('fs:list-files', { dir, pattern }),
    listFilesRecursive: (dir: string) => typedInvoke('fs:list-files-recursive', { dir }),
    fileExists: (path: string) => typedInvoke('fs:file-exists', { path }),
    deleteFile: (path: string) => typedInvoke('fs:delete-file', { path }),
    renameFile: (oldPath: string, newPath: string) =>
      typedInvoke('fs:rename-file', { oldPath, newPath }),
    copyFile: (srcPath: string, destPath: string) =>
      typedInvoke('fs:copy-file', { srcPath, destPath }),
    selectVault: () => typedInvoke('fs:select-vault'),
    createFolder: (defaultPath: string) => typedInvoke('fs:create-folder', { defaultPath }),
    mkdir: (path: string) => typedInvoke('fs:mkdir', { path }),
    readBinary: (path: string) => typedInvoke('fs:read-binary', { path }),
    listAllFiles: (dir: string) => typedInvoke('fs:list-all-files', { dir })
  },
  vault: {
    init: (vaultPath: string) => typedInvoke('vault:init', { vaultPath }),
    readConfig: (vaultPath: string) => typedInvoke('vault:read-config', { vaultPath }),
    writeConfig: (vaultPath: string, config: VaultConfig) =>
      typedInvoke('vault:write-config', { vaultPath, config }),
    readState: (vaultPath: string) => typedInvoke('vault:read-state', { vaultPath }),
    writeState: (vaultPath: string, state: VaultState) =>
      typedInvoke('vault:write-state', { vaultPath, state }),
    watchStart: (vaultPath: string) => typedInvoke('vault:watch-start', { vaultPath }),
    watchStop: () => typedInvoke('vault:watch-stop'),
    listCommands: (dirPath: string) => typedInvoke('vault:list-commands', { dirPath }),
    readFile: (filePath: string) => typedInvoke('vault:read-file', { filePath }),
    deleteFile: (filePath: string) => typedInvoke('fs:delete-file', { path: filePath })
  },
  shell: {
    showInFolder: (path: string) => typedInvoke('shell:show-in-folder', { path }),
    openPath: (path: string) => typedInvoke('shell:open-path', { path }),
    trashItem: (path: string) => typedInvoke('shell:trash-item', { path })
  },
  terminal: {
    create: (cwd: string, shell?: string) => typedInvoke('terminal:create', { cwd, shell }),
    write: (sessionId: SessionId, data: string) =>
      typedInvoke('terminal:write', { sessionId, data }),
    resize: (sessionId: SessionId, cols: number, rows: number) =>
      typedInvoke('terminal:resize', { sessionId, cols, rows }),
    kill: (sessionId: SessionId) => typedInvoke('terminal:kill', { sessionId }),
    getProcessName: (sessionId: SessionId) => typedInvoke('terminal:process-name', { sessionId })
  },
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  getHomePath: () => homedir(),
  on: {
    terminalData: (callback: (data: { sessionId: SessionId; data: string }) => void) =>
      typedOn('terminal:data', callback),
    terminalExit: (callback: (data: { sessionId: SessionId; code: number }) => void) =>
      typedOn('terminal:exit', callback),
    fileChanged: (callback: (data: { path: string; event: 'add' | 'change' | 'unlink' }) => void) =>
      typedOn('vault:file-changed', callback)
  }
}

export type ElectronApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
