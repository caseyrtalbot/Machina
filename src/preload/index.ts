import { contextBridge, webUtils } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { typedInvoke, typedOn } from './typed-ipc'
import type { SessionId, VaultState } from '../shared/types'

import type { AgentSidecarState } from '../shared/agent-types'
import type { Block } from '../shared/engine/block-model'
import type { CanvasMutationPlan } from '../shared/canvas-mutation-types'
import type { ClaudeStatus } from '../shared/claude-status-types'
import type { CLIAgentSessionStatus } from '../shared/cli-agent-session-types'
import type { InfraHealth } from '../shared/engine/vault-health'
import type { Thread } from '../shared/thread-types'
import type { AgentIdentity } from '../shared/agent-identity'
import type { VaultMachinaConfig } from '../shared/thread-storage-types'
import type { IpcEventData } from '../shared/ipc-channels'
import type { DockTab } from '../shared/dock-types'
import type { CommitApprovedOpts } from '../shared/git-types'
import type { HarnessCreateRequest } from '../shared/harness-types'

const api = {
  config: {
    read: (scope: string, key: string) => typedInvoke('config:read', { scope, key }),
    write: (scope: string, key: string, value: unknown) =>
      typedInvoke('config:write', { scope, key, value })
  },
  fs: {
    readFile: (path: string) => typedInvoke('fs:read-file', { path }),
    writeFile: (path: string, content: string) => typedInvoke('fs:write-file', { path, content }),
    listFiles: (dir: string, pattern?: string) => typedInvoke('fs:list-files', { dir, pattern }),
    fileExists: (path: string) => typedInvoke('fs:file-exists', { path }),
    deleteFile: (path: string) => typedInvoke('fs:delete-file', { path }),
    renameFile: (oldPath: string, newPath: string) =>
      typedInvoke('fs:rename-file', { oldPath, newPath }),
    copyFile: (srcPath: string, destPath: string) =>
      typedInvoke('fs:copy-file', { srcPath, destPath }),
    selectVault: () => typedInvoke('fs:select-vault'),
    mkdir: (path: string) => typedInvoke('fs:mkdir', { path }),
    readBinary: (path: string) => typedInvoke('fs:read-binary', { path }),
    listAllFiles: (dir: string) => typedInvoke('fs:list-all-files', { dir }),
    fileMtime: (path: string) => typedInvoke('fs:file-mtime', { path }),
    readFilesBatch: (paths: readonly string[]) => typedInvoke('fs:read-files-batch', { paths }),
    selectFile: () => typedInvoke('fs:select-file')
  },
  workspace: {
    open: (path: string) => typedInvoke('workspace:open', { path }),
    current: () => typedInvoke('workspace:current')
  },
  vault: {
    // Legacy alias for workspace:open (kept for one release, contracts §1).
    init: (vaultPath: string) => typedInvoke('vault:init', { vaultPath }),
    importAsset: (sourcePath: string) => typedInvoke('vault:import-asset', { sourcePath }),
    readConfig: (vaultPath: string) => typedInvoke('vault:read-config', { vaultPath }),
    readState: (vaultPath: string) => typedInvoke('vault:read-state', { vaultPath }),
    writeState: (vaultPath: string, state: VaultState) =>
      typedInvoke('vault:write-state', { vaultPath, state }),
    watchStart: (vaultPath: string) => typedInvoke('vault:watch-start', { vaultPath }),
    watchStop: () => typedInvoke('vault:watch-stop'),
    listSystemArtifacts: (vaultPath: string, kind?: 'session' | 'pattern' | 'tension') =>
      typedInvoke('vault:list-system-artifacts', { vaultPath, kind }),
    emergeGhost: (
      ghostId: string,
      ghostTitle: string,
      referencePaths: readonly string[],
      vaultPath: string
    ) => typedInvoke('vault:emerge-ghost', { ghostId, ghostTitle, referencePaths, vaultPath }),
    indexPdfContent: (pdfPath: string, pages: ReadonlyArray<{ page: number; text: string }>) =>
      typedInvoke('vault:index-pdf-content', { pdfPath, pages })
  },
  shell: {
    showInFolder: (path: string) => typedInvoke('shell:show-in-folder', { path }),
    openPath: (path: string) => typedInvoke('shell:open-path', { path }),
    openExternal: (url: string) => typedInvoke('shell:open-external', { url }),
    trashItem: (path: string) => typedInvoke('shell:trash-item', { path }),
    hooksStatus: () => typedInvoke('shell:hooks-status'),
    installHooks: () => typedInvoke('shell:install-hooks')
  },

  // Trimmed to the members the main renderer actually uses; the terminal
  // webview bridge (terminal-webview.ts) owns create/write/resize/reconnect.
  terminal: {
    kill: (sessionId: SessionId) => typedInvoke('terminal:kill', { sessionId }),
    getProcessName: (sessionId: SessionId) => typedInvoke('terminal:process-name', { sessionId })
  },
  claude: {
    getStatus: () => typedInvoke('claude:get-status'),
    recheck: () => typedInvoke('claude:recheck')
  },
  mcp: {
    status: () => typedInvoke('mcp:status')
  },
  agent: {
    getStates: () => typedInvoke('agent:get-states')
  },
  canvas: {
    getSnapshot: (canvasPath: string) => typedInvoke('canvas:get-snapshot', { canvasPath }),
    applyPlan: (canvasPath: string, expectedMtime: string, plan: CanvasMutationPlan) =>
      typedInvoke('canvas:apply-plan', { canvasPath, expectedMtime, plan }),
    save: (canvasPath: string, content: string) =>
      typedInvoke('canvas:save', { canvasPath, content }),
    list: (vaultPath: string) => typedInvoke('canvas:list', { vaultPath })
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
      typedInvoke('doc:save-content', { path, content })
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
    spawn: (req: {
      threadId: string
      identity: AgentIdentity
      cwd: string
      agentId?: string
      model?: string
    }) => typedInvoke('cli-thread:spawn', req),
    input: (req: {
      threadId: string
      identity: AgentIdentity
      text: string
      cwd: string
      agentId?: string
      model?: string
    }) => typedInvoke('cli-thread:input', req),
    close: (threadId: string) => typedInvoke('cli-thread:close', { threadId }),
    cancel: (threadId: string) => typedInvoke('cli-thread:cancel', { threadId }),
    getSession: (threadId: string) => typedInvoke('cli-thread:get-session', { threadId })
  },
  embeddings: {
    setEnabled: (enabled: boolean) => typedInvoke('embeddings:set-enabled', { enabled }),
    status: () => typedInvoke('embeddings:status'),
    search: (query: string, k?: number) => typedInvoke('embeddings:search', { query, k })
  },
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  getHomePath: () => homedir(),
  getTerminalPreloadPath: () => join(__dirname, 'terminal-webview.js'),
  on: {
    terminalExit: (callback: (data: { sessionId: SessionId; code: number }) => void) =>
      typedOn('terminal:exit', callback),
    filesChangedBatch: (
      callback: (data: {
        events: readonly { path: string; event: 'add' | 'change' | 'unlink' }[]
      }) => void
    ) => typedOn('vault:files-changed-batch', callback),
    docExternalChange: (callback: (data: { path: string; content: string }) => void) =>
      typedOn('doc:external-change', callback),
    docConflict: (callback: (data: { path: string; diskContent: string }) => void) =>
      typedOn('doc:conflict', callback),
    docSaved: (callback: (data: { path: string }) => void) => typedOn('doc:saved', callback),
    docSaveFailed: (callback: (data: { path: string; message: string }) => void) =>
      typedOn('doc:save-failed', callback),
    agentStatesChanged: (callback: (data: { states: readonly AgentSidecarState[] }) => void) =>
      typedOn('agent:states-changed', callback),
    canvasAgentPlanAccepted: (
      callback: (data: { plan: CanvasMutationPlan; canvasPath: string }) => void
    ) => typedOn('canvas:agent-plan-accepted', callback),
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
      typedOn('agent-native:dock-action', callback),
    approvalsChanged: (callback: (data: { pending: number }) => void) =>
      typedOn('approvals:changed', callback),
    watcherHealth: (callback: (data: IpcEventData<'approvals:watcher-health'>) => void) =>
      typedOn('approvals:watcher-health', callback),
    cliThreadSessionChanged: (
      callback: (data: IpcEventData<'cli-thread:session-changed'>) => void
    ) => typedOn('cli-thread:session-changed', callback),
    agentBreakerTripped: (callback: (data: IpcEventData<'agent:breaker-tripped'>) => void) =>
      typedOn('agent:breaker-tripped', callback)
  },
  app: {
    pathExists: (path: string) => typedInvoke('app:path-exists', { path }),
    revealLogs: () => typedInvoke('app:reveal-logs')
  },
  lifecycle: {
    quitReady: () => typedInvoke('app:quit-ready')
  },
  // Git substrate + approval queue (workstation contracts §6). No paths take
  // a root — main resolves it from the current workspace.
  git: {
    status: () => typedInvoke('git:status'),
    diff: (paths?: string[]) => typedInvoke('git:diff', { paths }),
    commitApproved: (opts: CommitApprovedOpts) => typedInvoke('git:commit-approved', opts),
    revertAgent: (agentId: string) => typedInvoke('git:revert-agent', { agentId }),
    listAgentCommits: () => typedInvoke('git:list-agent-commits')
  },
  approvals: {
    list: () => typedInvoke('approvals:list'),
    resolve: (id: string, approve: boolean, message?: string) =>
      typedInvoke('approvals:resolve', { id, approve, message }),
    watcherStatus: () => typedInvoke('approvals:watcher-status'),
    watcherRetry: () => typedInvoke('approvals:watcher-retry')
  },
  // Agent harness (workstation contracts §5/§6, step 6). No root in either
  // call — main resolves it from the current workspace.
  harness: {
    create: (request: HarnessCreateRequest) => typedInvoke('harness:create', request),
    list: () => typedInvoke('harness:list'),
    run: (slug: string, threadId: string, taskBrief: string) =>
      typedInvoke('harness:run', { slug, threadId, taskBrief }),
    binding: (threadId: string) => typedInvoke('harness:binding', { threadId }),
    lint: (slug: string) => typedInvoke('harness:lint', { slug })
  },
  // Agent circuit breaker (workstation contracts §5/§6, Phase 2 step 6).
  // Appended at the api end per the parallel-session rule.
  breaker: {
    status: () => typedInvoke('agent:breaker-status')
  },
  // OS-notification landing (workstation contracts §4/§6 v1.3.1, Phase 3
  // step 2). Appended at the api end per the parallel-session rule: a
  // notification click focuses the window, then this event opens the tray.
  notifications: {
    onOpenTray: (callback: (data: Record<string, never>) => void) =>
      typedOn('approvals:open-tray', callback)
  }
}

export type ElectronApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
