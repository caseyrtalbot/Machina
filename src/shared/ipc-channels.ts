import type { FilesystemFileEntry, SessionId, VaultConfig, VaultState } from './types'
import type { AgentArtifactDraft, MaterializeResult } from './agent-artifact-types'
import type {
  WorkbenchSessionEvent,
  WorkbenchFileChangedEvent,
  SessionMilestone,
  SessionDetectedEvent
} from './workbench-types'
import type { SystemArtifactKind } from './system-artifacts'
import type { AgentSidecarState, AgentSpawnRequest } from './agent-types'
import type { ActionDefinition } from './action-types'
import type { CanvasMutationPlan } from './canvas-mutation-types'
import type { ClaudeStatus } from './claude-status-types'
import type { CLIAgentInstallation } from './cli-agents'
import type { CLIAgentSessionStatus } from './cli-agent-session-types'
import type { InfraHealth } from './engine/vault-health'
import type { Block } from './engine/block-model'

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
  'fs:list-all-files': { request: { dir: string }; response: FilesystemFileEntry[] }
  'fs:file-mtime': { request: { path: string }; response: string | null }
  'fs:read-files-batch': {
    request: { paths: readonly string[] }
    response: Array<{ path: string; content: string | null; error?: string }>
  }

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
  'vault:emerge-ghost': {
    request: {
      ghostId: string
      ghostTitle: string
      referencePaths: readonly string[]
      vaultPath: string
    }
    response: {
      filePath: string
      folderCreated: boolean
      folderPath: string
    }
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
  'shell:open-external': { request: { url: string }; response: void }
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
  'terminal:send-raw-keys': {
    request: { sessionId: SessionId; data: string }
    response: void
  }
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
  'app:path-exists': { request: { path: string }; response: boolean }

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

  // --- Actions ---
  'actions:list': { request: void; response: readonly ActionDefinition[] }
  'actions:read': {
    request: { id: string }
    response: { definition: ActionDefinition; body: string } | { error: string }
  }

  // --- Agents ---
  'agent:get-states': { request: void; response: AgentSidecarState[] }
  'agent:spawn': {
    request: AgentSpawnRequest
    response: { sessionId: string } | { error: string }
  }
  'agent:kill': { request: { sessionId: string }; response: void }
  'agent:list-installed': { request: void; response: readonly CLIAgentInstallation[] }

  // --- Claude Status ---
  'claude:get-status': { request: void; response: ClaudeStatus }
  'claude:recheck': { request: void; response: ClaudeStatus }

  // --- Canvas ---
  'canvas:get-snapshot': {
    request: { canvasPath: string }
    response: { file: import('./canvas-types').CanvasFile; mtime: string }
  }
  'canvas:apply-plan': {
    request: {
      canvasPath: string
      expectedMtime: string
      plan: CanvasMutationPlan
    }
    response:
      | { accepted: boolean; mtime: string }
      | { error: 'stale' | 'validation-failed'; message: string }
  }

  // --- Artifact ---
  'artifact:materialize': {
    request: { draft: AgentArtifactDraft; vaultPath: string }
    response: MaterializeResult
  }
  'artifact:unmaterialize': {
    request: { paths: readonly string[]; vaultPath: string }
    response: void
  }

  // --- Health ---
  'health:heartbeat': { request: { at: number }; response: void }
  'health:request-tick': { request: void; response: void }

  // --- Threads ---
  'thread:list': {
    request: { vaultPath: string }
    response: import('./thread-types').Thread[]
  }
  'thread:list-archived': {
    request: { vaultPath: string }
    response: import('./thread-types').Thread[]
  }
  'thread:read': {
    request: { vaultPath: string; id: string }
    response: import('./thread-types').Thread
  }
  'thread:save': {
    request: { vaultPath: string; thread: import('./thread-types').Thread }
    response: void
  }
  'thread:create': {
    request: {
      vaultPath: string
      agent: import('./agent-identity').AgentIdentity
      model: string
      title?: string
    }
    response: import('./thread-types').Thread
  }
  'thread:archive': { request: { vaultPath: string; id: string }; response: void }
  'thread:unarchive': { request: { vaultPath: string; id: string }; response: void }
  'thread:delete': { request: { vaultPath: string; id: string }; response: void }
  'thread:read-config': {
    request: { vaultPath: string }
    response: import('./thread-storage-types').VaultMachinaConfig
  }
  'thread:write-config': {
    request: {
      vaultPath: string
      config: import('./thread-storage-types').VaultMachinaConfig
    }
    response: void
  }

  // --- Machina Native (Anthropic SDK) ---
  'agent-native:has-key': { request: void; response: boolean }
  'agent-native:set-key': { request: { key: string }; response: void }
  'agent-native:clear-key': { request: void; response: void }
  'agent-native:run': {
    request: {
      vaultPath: string
      threadId: string
      model: string
      systemPrompt: string
      userMessage: string
      historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
      autoAccept?: boolean
    }
    response: { runId: string }
  }
  'agent-native:abort': { request: { runId: string }; response: void }
  'agent-native:tool-decision': {
    request: { toolUseId: string; accept: boolean; rejectReason?: string }
    response: void
  }

  // --- CLI Agent Threads (Phase 8) ---
  'cli-thread:spawn': {
    request: {
      threadId: string
      identity: import('./agent-identity').AgentIdentity
      cwd: string
    }
    response: { ok: true; sessionId: string } | { ok: false; error: string }
  }
  'cli-thread:input': {
    request: {
      threadId: string
      identity: import('./agent-identity').AgentIdentity
      text: string
    }
    response: { ok: boolean }
  }
  'cli-thread:close': { request: { threadId: string }; response: void }
  'cli-thread:cancel': { request: { threadId: string }; response: { ok: boolean } }
}

export type AgentNativeApprovalPreview =
  | {
      approvalKind: 'write_note'
      preview: { path: string; content: string; created: boolean }
    }
  | {
      approvalKind: 'edit_note'
      preview: { path: string; find: string; replace: string }
    }

export type AgentNativeEventBody =
  | { kind: 'text'; text: string }
  | { kind: 'message_end' }
  | { kind: 'error'; code: import('./thread-types').ToolErrorCode; message: string }
  | {
      kind: 'tool_call_persisted'
      call: import('./thread-types').ToolCall
      result: import('./thread-types').ToolResult
    }
  | ({ kind: 'tool_pending_approval'; toolUseId: string } & AgentNativeApprovalPreview)
  | { kind: 'tool_decision_resolved'; toolUseId: string; accepted: boolean }

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

  // Canvas agent plan dispatch (main -> renderer)
  'canvas:agent-plan-accepted': { plan: CanvasMutationPlan }

  // Claude status events (main -> renderer)
  'claude:status-changed': ClaudeStatus

  // Health monitoring events (main -> renderer)
  'health:report': InfraHealth

  // Block protocol events (main -> renderer): one snapshot per block transition.
  // See docs/architecture/block-protocol.md.
  'block:update': { sessionId: SessionId; block: Block }

  // Machina Native streaming events (main -> renderer)
  'agent-native:event': { runId: string; threadId: string } & AgentNativeEventBody

  // CLI agent session listener (main -> renderer). status-changed fires only
  // when the session transitions between in-progress / success / blocked;
  // context-updated fires when the latest tool call or response changes
  // without a status transition. See cli-agent-session-listener.ts.
  'cli-agent:session-status-changed': CLIAgentSessionStatus
  'cli-agent:context-updated': CLIAgentSessionStatus

  // Per-completed-block message addressed to a CLI agent thread. Emitted by
  // CliAgentThreadBridge when a session bound to a thread finishes a block;
  // the renderer mirrors `message` into `threadId`'s message list.
  'thread:cli-message': { threadId: string; message: import('./thread-types').ThreadMessage }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']

export type IpcEvent = keyof IpcEvents
export type IpcEventData<E extends IpcEvent> = IpcEvents[E]
