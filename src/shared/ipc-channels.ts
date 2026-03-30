import type { SessionId, VaultConfig, VaultState } from './types'
import type {
  WorkbenchSessionEvent,
  WorkbenchFileChangedEvent,
  SessionMilestone,
  SessionDetectedEvent
} from './workbench-types'
import type { SystemArtifactKind } from './system-artifacts'
import type { AgentSidecarState, AgentSpawnRequest } from './agent-types'

export interface IpcChannels {
  // --- Filesystem ---
  'fs:read-file': { request: { path: string }; response: string }
  'fs:write-file': { request: { path: string; content: string }; response: void }
  'fs:delete-file': { request: { path: string }; response: void }
  'fs:list-files': { request: { dir: string; pattern?: string }; response: string[] }
  'fs:list-files-recursive': { request: { dir: string }; response: string[] }
  'fs:file-exists': { request: { path: string }; response: boolean }
  'fs:select-vault': { request: void; response: string | null }
  'fs:rename-file': { request: { oldPath: string; newPath: string }; response: void }
  'fs:copy-file': { request: { srcPath: string; destPath: string }; response: void }
  'fs:create-folder': { request: { defaultPath: string }; response: string | null }
  'fs:mkdir': { request: { path: string }; response: void }
  'fs:read-binary': { request: { path: string }; response: string }
  'fs:list-all-files': { request: { dir: string }; response: string[] }
  'fs:file-mtime': { request: { path: string }; response: string | null }

  // --- Vault ---
  'vault:read-config': { request: { vaultPath: string }; response: VaultConfig }
  'vault:write-config': { request: { vaultPath: string; config: VaultConfig }; response: void }
  'vault:read-state': { request: { vaultPath: string }; response: VaultState }
  'vault:write-state': { request: { vaultPath: string; state: VaultState }; response: void }
  'vault:init': { request: { vaultPath: string }; response: void }
  'vault:list-commands': { request: { dirPath: string }; response: string[] }
  'vault:read-file': { request: { filePath: string }; response: string }
  'vault:list-system-artifacts': {
    request: { vaultPath: string; kind?: SystemArtifactKind }
    response: string[]
  }
  'vault:read-system-artifact': {
    request: { vaultPath: string; path: string }
    response: string
  }
  'vault:create-system-artifact': {
    request: {
      vaultPath: string
      kind: SystemArtifactKind
      filename: string
      content: string
    }
    response: string
  }
  'vault:update-system-artifact': {
    request: { vaultPath: string; path: string; content: string }
    response: void
  }
  'vault:watch-start': { request: { vaultPath: string }; response: void }
  'vault:watch-stop': { request: void; response: void }

  // --- Workbench ---
  'workbench:watch-start': { request: { projectPath: string }; response: void }
  'workbench:watch-stop': { request: void; response: void }
  'workbench:parse-sessions': {
    request: { projectPath: string }
    response: WorkbenchSessionEvent[]
  }

  // --- Session Tailing ---
  'session:tail-start': { request: { projectPath: string }; response: void }
  'session:tail-stop': { request: void; response: void }

  // --- Shell ---
  'shell:show-in-folder': { request: { path: string }; response: void }
  'shell:open-path': { request: { path: string }; response: string }
  'shell:trash-item': { request: { path: string }; response: void }

  // --- Terminal ---
  'terminal:create': {
    request: {
      cwd: string
      cols?: number
      rows?: number
      shell?: string
      label?: string
      vaultPath?: string
    }
    response: SessionId
  }
  'terminal:write': { request: { sessionId: SessionId; data: string }; response: void }
  'terminal:resize': {
    request: { sessionId: SessionId; cols: number; rows: number }
    response: void
  }
  'terminal:kill': { request: { sessionId: SessionId }; response: void }
  'terminal:process-name': { request: { sessionId: SessionId }; response: string | null }
  'terminal:reconnect': {
    request: { sessionId: SessionId; cols: number; rows: number }
    response: {
      scrollback: string
      meta: { shell: string; cwd: string; label?: string }
    } | null
  }
  'terminal:discover': {
    request: void
    response: Array<{
      sessionId: SessionId
      meta: { shell: string; cwd: string; createdAt: string; label?: string; vaultPath?: string }
    }>
  }
  'terminal:tmux-available': { request: void; response: boolean }

  // --- Document Manager ---
  'doc:open': { request: { path: string }; response: { content: string; version: number } }
  'doc:close': { request: { path: string }; response: void }
  'doc:update': {
    request: { path: string; content: string }
    response: { version: number }
  }
  'doc:save': { request: { path: string }; response: void }
  'doc:save-content': { request: { path: string; content: string }; response: void }
  'doc:get-content': {
    request: { path: string }
    response: { content: string; version: number; dirty: boolean } | null
  }

  // --- App Lifecycle ---
  'app:quit-ready': { request: void; response: void }

  // --- Window ---
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: void }
  'window:close': { request: void; response: void }

  // --- Config ---
  'config:read': { request: { scope: string; key: string }; response: unknown }
  'config:write': { request: { scope: string; key: string; value: unknown }; response: void }

  // --- MCP ---
  'mcp:status': {
    request: void
    response: { running: boolean; toolCount: number }
  }

  // --- Agents ---
  'agent:get-states': { request: void; response: AgentSidecarState[] }
  'agent:spawn': {
    request: AgentSpawnRequest
    response: { sessionId: string } | { error: string }
  }
}

export interface IpcEvents {
  'terminal:data': { sessionId: SessionId; data: string }
  'terminal:exit': { sessionId: SessionId; code: number }
  'vault:files-changed-batch': {
    events: readonly { path: string; event: 'add' | 'change' | 'unlink' }[]
  }

  'workbench:file-changed': WorkbenchFileChangedEvent
  'session:milestone': SessionMilestone
  'session:detected': SessionDetectedEvent

  // Document Manager events (main -> renderer)
  // App Lifecycle events (main -> renderer)
  'app:will-quit': Record<string, never>

  'doc:external-change': { path: string; content: string }
  'doc:conflict': { path: string; diskContent: string }
  'doc:saved': { path: string }

  // Agent observation events (main -> renderer)
  'agent:states-changed': { states: readonly AgentSidecarState[] }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']

export type IpcEvent = keyof IpcEvents
export type IpcEventData<E extends IpcEvent> = IpcEvents[E]
