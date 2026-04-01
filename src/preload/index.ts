import { contextBridge, webUtils } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { typedInvoke, typedOn } from './typed-ipc'
import type { SessionId, VaultConfig, VaultState } from '../shared/types'

import type {
  WorkbenchFileChangedEvent,
  SessionMilestone,
  SessionDetectedEvent
} from '../shared/workbench-types'

import type { AgentSidecarState, AgentSpawnRequest } from '../shared/agent-types'
import type { CanvasMutationPlan } from '../shared/canvas-mutation-types'

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
    listAllFiles: (dir: string) => typedInvoke('fs:list-all-files', { dir }),
    fileMtime: (path: string) => typedInvoke('fs:file-mtime', { path }),
    readFilesBatch: (paths: readonly string[]) => typedInvoke('fs:read-files-batch', { paths })
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
    listSystemArtifacts: (vaultPath: string, kind?: 'session' | 'pattern' | 'tension') =>
      typedInvoke('vault:list-system-artifacts', { vaultPath, kind }),
    readSystemArtifact: (vaultPath: string, path: string) =>
      typedInvoke('vault:read-system-artifact', { vaultPath, path }),
    createSystemArtifact: (
      vaultPath: string,
      kind: 'session' | 'pattern' | 'tension',
      filename: string,
      content: string
    ) => typedInvoke('vault:create-system-artifact', { vaultPath, kind, filename, content }),
    updateSystemArtifact: (vaultPath: string, path: string, content: string) =>
      typedInvoke('vault:update-system-artifact', { vaultPath, path, content }),
    deleteFile: (filePath: string) => typedInvoke('fs:delete-file', { path: filePath })
  },
  shell: {
    showInFolder: (path: string) => typedInvoke('shell:show-in-folder', { path }),
    openPath: (path: string) => typedInvoke('shell:open-path', { path }),
    trashItem: (path: string) => typedInvoke('shell:trash-item', { path })
  },

  workbench: {
    watchStart: (projectPath: string) => typedInvoke('workbench:watch-start', { projectPath }),
    watchStop: () => typedInvoke('workbench:watch-stop'),
    parseSessions: (projectPath: string) =>
      typedInvoke('workbench:parse-sessions', { projectPath }),
    tailStart: (projectPath: string) => typedInvoke('session:tail-start', { projectPath }),
    tailStop: () => typedInvoke('session:tail-stop')
  },
  terminal: {
    create: (cwd: string, shell?: string, label?: string, vaultPath?: string) =>
      typedInvoke('terminal:create', { cwd, shell, label, vaultPath }),
    write: (sessionId: SessionId, data: string) =>
      typedInvoke('terminal:write', { sessionId, data }),
    sendRawKeys: (sessionId: SessionId, data: string) =>
      typedInvoke('terminal:send-raw-keys', { sessionId, data }),
    resize: (sessionId: SessionId, cols: number, rows: number) =>
      typedInvoke('terminal:resize', { sessionId, cols, rows }),
    kill: (sessionId: SessionId) => typedInvoke('terminal:kill', { sessionId }),
    getProcessName: (sessionId: SessionId) => typedInvoke('terminal:process-name', { sessionId }),
    reconnect: (sessionId: SessionId, cols: number, rows: number) =>
      typedInvoke('terminal:reconnect', { sessionId, cols, rows })
  },
  agent: {
    getStates: () => typedInvoke('agent:get-states'),
    spawn: (request: AgentSpawnRequest) => typedInvoke('agent:spawn', request)
  },
  canvas: {
    getSnapshot: (canvasPath: string) => typedInvoke('canvas:get-snapshot', { canvasPath }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyPlan: (canvasPath: string, expectedMtime: string, plan: any) =>
      typedInvoke('canvas:apply-plan', { canvasPath, expectedMtime, plan })
  },
  document: {
    open: (path: string) => typedInvoke('doc:open', { path }),
    close: (path: string) => typedInvoke('doc:close', { path }),
    update: (path: string, content: string) => typedInvoke('doc:update', { path, content }),
    save: (path: string) => typedInvoke('doc:save', { path }),
    saveContent: (path: string, content: string) =>
      typedInvoke('doc:save-content', { path, content }),
    getContent: (path: string) => typedInvoke('doc:get-content', { path })
  },
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  getHomePath: () => homedir(),
  getTerminalPreloadPath: () => join(__dirname, 'terminal-webview.js'),
  on: {
    terminalData: (callback: (data: { sessionId: SessionId; data: string }) => void) =>
      typedOn('terminal:data', callback),
    terminalExit: (callback: (data: { sessionId: SessionId; code: number }) => void) =>
      typedOn('terminal:exit', callback),
    filesChangedBatch: (
      callback: (data: {
        events: readonly { path: string; event: 'add' | 'change' | 'unlink' }[]
      }) => void
    ) => typedOn('vault:files-changed-batch', callback),
    projectFileChanged: (callback: (data: WorkbenchFileChangedEvent) => void) =>
      typedOn('workbench:file-changed', callback),
    sessionMilestone: (callback: (data: SessionMilestone) => void) =>
      typedOn('session:milestone', callback),
    sessionDetected: (callback: (data: SessionDetectedEvent) => void) =>
      typedOn('session:detected', callback),
    docExternalChange: (callback: (data: { path: string; content: string }) => void) =>
      typedOn('doc:external-change', callback),
    docConflict: (callback: (data: { path: string; diskContent: string }) => void) =>
      typedOn('doc:conflict', callback),
    docSaved: (callback: (data: { path: string }) => void) => typedOn('doc:saved', callback),
    agentStatesChanged: (callback: (data: { states: readonly AgentSidecarState[] }) => void) =>
      typedOn('agent:states-changed', callback),
    canvasAgentPlanAccepted: (callback: (data: { plan: CanvasMutationPlan }) => void) =>
      typedOn('canvas:agent-plan-accepted', callback),
    appWillQuit: (callback: (data: Record<string, never>) => void) =>
      typedOn('app:will-quit', callback)
  },
  app: {
    pathExists: (path: string) => typedInvoke('app:path-exists', { path })
  },
  lifecycle: {
    quitReady: () => typedInvoke('app:quit-ready')
  }
}

export type ElectronApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
