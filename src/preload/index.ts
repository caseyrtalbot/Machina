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
import type { Block } from '../shared/engine/block-model'
import type { CanvasMutationPlan } from '../shared/canvas-mutation-types'
import type { ClaudeStatus } from '../shared/claude-status-types'
import type { AgentArtifactDraft, MaterializeResult } from '../shared/agent-artifact-types'
import type { CLIAgentSessionStatus } from '../shared/cli-agent-session-types'
import type { InfraHealth } from '../shared/engine/vault-health'
import type { Thread } from '../shared/thread-types'
import type { AgentIdentity } from '../shared/agent-identity'
import type { VaultMachinaConfig } from '../shared/thread-storage-types'
import type { IpcEventData } from '../shared/ipc-channels'
import type { DockTab } from '../shared/dock-types'

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
    deleteFile: (filePath: string) => typedInvoke('fs:delete-file', { path: filePath }),
    emergeGhost: (
      ghostId: string,
      ghostTitle: string,
      referencePaths: readonly string[],
      vaultPath: string
    ) => typedInvoke('vault:emerge-ghost', { ghostId, ghostTitle, referencePaths, vaultPath })
  },
  shell: {
    showInFolder: (path: string) => typedInvoke('shell:show-in-folder', { path }),
    openPath: (path: string) => typedInvoke('shell:open-path', { path }),
    openExternal: (url: string) => typedInvoke('shell:open-external', { url }),
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
  claude: {
    getStatus: () => typedInvoke('claude:get-status'),
    recheck: () => typedInvoke('claude:recheck')
  },
  agent: {
    getStates: () => typedInvoke('agent:get-states'),
    spawn: (request: AgentSpawnRequest) => typedInvoke('agent:spawn', request),
    kill: (sessionId: string) => typedInvoke('agent:kill', { sessionId }),
    listInstalled: () => typedInvoke('agent:list-installed')
  },
  actions: {
    list: () => typedInvoke('actions:list'),
    read: (id: string) => typedInvoke('actions:read', { id })
  },
  canvas: {
    getSnapshot: (canvasPath: string) => typedInvoke('canvas:get-snapshot', { canvasPath }),
    applyPlan: (canvasPath: string, expectedMtime: string, plan: CanvasMutationPlan) =>
      typedInvoke('canvas:apply-plan', { canvasPath, expectedMtime, plan })
  },
  artifact: {
    materialize: (draft: AgentArtifactDraft, vaultPath: string): Promise<MaterializeResult> =>
      typedInvoke('artifact:materialize', { draft, vaultPath }),
    unmaterialize: (paths: readonly string[], vaultPath: string): Promise<void> =>
      typedInvoke('artifact:unmaterialize', { paths, vaultPath })
  },
  health: {
    heartbeat: (payload: { at: number }) => typedInvoke('health:heartbeat', payload),
    requestTick: () => typedInvoke('health:request-tick')
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
  agentNative: {
    hasKey: () => typedInvoke('agent-native:has-key'),
    setKey: (key: string) => typedInvoke('agent-native:set-key', { key }),
    clearKey: () => typedInvoke('agent-native:clear-key'),
    run: (req: {
      vaultPath: string
      threadId: string
      model: string
      systemPrompt: string
      userMessage: string
      historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
      autoAccept?: boolean
      dockTabsSnapshot?: ReadonlyArray<DockTab>
    }) => typedInvoke('agent-native:run', req),
    abort: (runId: string) => typedInvoke('agent-native:abort', { runId }),
    toolDecision: (req: { toolUseId: string; accept: boolean; rejectReason?: string }) =>
      typedInvoke('agent-native:tool-decision', req)
  },
  thread: {
    list: (vaultPath: string) => typedInvoke('thread:list', { vaultPath }),
    listArchived: (vaultPath: string) => typedInvoke('thread:list-archived', { vaultPath }),
    read: (vaultPath: string, id: string) => typedInvoke('thread:read', { vaultPath, id }),
    save: (vaultPath: string, thread: Thread) => typedInvoke('thread:save', { vaultPath, thread }),
    create: (vaultPath: string, agent: AgentIdentity, model: string, title?: string) =>
      typedInvoke('thread:create', { vaultPath, agent, model, title }),
    archive: (vaultPath: string, id: string) => typedInvoke('thread:archive', { vaultPath, id }),
    unarchive: (vaultPath: string, id: string) =>
      typedInvoke('thread:unarchive', { vaultPath, id }),
    delete: (vaultPath: string, id: string) => typedInvoke('thread:delete', { vaultPath, id }),
    readConfig: (vaultPath: string) => typedInvoke('thread:read-config', { vaultPath }),
    writeConfig: (vaultPath: string, config: VaultMachinaConfig) =>
      typedInvoke('thread:write-config', { vaultPath, config })
  },
  cliThread: {
    spawn: (req: { threadId: string; identity: AgentIdentity; cwd: string }) =>
      typedInvoke('cli-thread:spawn', req),
    input: (req: { threadId: string; identity: AgentIdentity; text: string }) =>
      typedInvoke('cli-thread:input', req),
    close: (threadId: string) => typedInvoke('cli-thread:close', { threadId }),
    cancel: (threadId: string) => typedInvoke('cli-thread:cancel', { threadId })
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
      typedOn('app:will-quit', callback),
    claudeStatusChanged: (callback: (data: ClaudeStatus) => void) =>
      typedOn('claude:status-changed', callback),
    healthReport: (callback: (data: InfraHealth) => void) => typedOn('health:report', callback),
    blockUpdate: (callback: (data: { sessionId: SessionId; block: Block }) => void) =>
      typedOn('block:update', callback),
    cliAgentSessionStatus: (callback: (data: CLIAgentSessionStatus) => void) =>
      typedOn('cli-agent:session-status-changed', callback),
    cliAgentContextUpdated: (callback: (data: CLIAgentSessionStatus) => void) =>
      typedOn('cli-agent:context-updated', callback),
    threadCliMessage: (callback: (data: IpcEventData<'thread:cli-message'>) => void) =>
      typedOn('thread:cli-message', callback),
    agentNativeEvent: (callback: (data: IpcEventData<'agent-native:event'>) => void) =>
      typedOn('agent-native:event', callback),
    agentNativeDockAction: (callback: (data: IpcEventData<'agent-native:dock-action'>) => void) =>
      typedOn('agent-native:dock-action', callback)
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
