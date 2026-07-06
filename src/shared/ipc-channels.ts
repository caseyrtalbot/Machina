import type { FilesystemFileEntry, SessionId, VaultConfig, VaultState } from './types'
import type { SystemArtifactKind } from './system-artifacts'
import type { AgentSidecarState } from './agent-types'
import type { CanvasMutationPlan } from './canvas-mutation-types'
import type { ClaudeStatus } from './claude-status-types'
import type { CLIAgentSessionStatus } from './cli-agent-session-types'
import type { InfraHealth } from './engine/vault-health'
import type { Block } from './engine/block-model'
import type { DockTab } from './dock-types'

export type DockAction = { action: 'open'; tab: DockTab } | { action: 'close'; index: number }

export interface IpcChannels {
  // --- Filesystem ---
  'fs:read-file': { request: { path: string }; response: string }
  'fs:write-file': { request: { path: string; content: string }; response: void }
  'fs:delete-file': { request: { path: string }; response: void }
  'fs:list-files': { request: { dir: string; pattern?: string }; response: string[] }
  'fs:file-exists': { request: { path: string }; response: boolean }
  'fs:select-vault': { request: void; response: string | null }
  'fs:rename-file': { request: { oldPath: string; newPath: string }; response: void }
  'fs:copy-file': { request: { srcPath: string; destPath: string }; response: void }
  'fs:mkdir': { request: { path: string }; response: void }
  'fs:read-binary': { request: { path: string }; response: string }
  'fs:list-all-files': { request: { dir: string }; response: FilesystemFileEntry[] }
  'fs:file-mtime': { request: { path: string }; response: string | null }
  'fs:read-files-batch': {
    request: { paths: readonly string[] }
    response: Array<{ path: string; content: string | null; error?: string }>
  }

  // --- Workspace (workstation contracts §1/§6) ---
  'workspace:open': {
    request: { path: string }
    response: import('./workspace-types').Workspace
  }
  'workspace:current': {
    request: void
    response: import('./workspace-types').Workspace | null
  }

  // --- Vault ---
  'vault:read-config': { request: { vaultPath: string }; response: VaultConfig }
  'vault:read-state': { request: { vaultPath: string }; response: VaultState }
  'vault:write-state': { request: { vaultPath: string; state: VaultState }; response: void }
  // Response is the canonicalized vault root (symlinks resolved, NFC) so the
  // renderer, watcher, and main-process index share one path namespace.
  'vault:init': { request: { vaultPath: string }; response: string }
  // Copy an external file (Finder drop, file picker) into <vault>/assets/ so
  // later reads pass PathGuard. In-vault sources are returned uncopied.
  'vault:import-asset': { request: { sourcePath: string }; response: { path: string } }
  'vault:list-system-artifacts': {
    request: { vaultPath: string; kind?: SystemArtifactKind }
    response: string[]
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
  // Per-page PDF text extracted by the renderer (3.10a), upserted into the
  // main-process SearchEngine so MCP search.query covers PDF content too.
  'vault:index-pdf-content': {
    request: { pdfPath: string; pages: ReadonlyArray<{ page: number; text: string }> }
    response: void
  }

  // --- Shell ---
  'shell:show-in-folder': { request: { path: string }; response: void }
  'shell:open-path': { request: { path: string }; response: string }
  'shell:open-external': { request: { url: string }; response: void }
  'shell:trash-item': { request: { path: string }; response: void }
  // Block-protocol shell hooks (resources/shell-hooks/te.*). Status reports
  // whether the user's login shell sources the bundled hook; install copies
  // the hook home and appends a guarded source line to the rc file.
  'shell:hooks-status': {
    request: void
    response: { installed: boolean; shell: 'zsh' | 'bash' | 'fish'; hookPath: string }
  }
  'shell:install-hooks': {
    request: void
    response: {
      ok: boolean
      shell: 'zsh' | 'bash' | 'fish'
      hookPath: string
      rcPath: string | null
      rcUpdated: boolean
      error?: string
    }
  }

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

  // --- App Lifecycle ---
  'app:quit-ready': { request: void; response: void }
  'app:path-exists': { request: { path: string }; response: boolean }
  'app:reveal-logs': { request: void; response: void }

  // --- Config ---
  'config:read': { request: { scope: string; key: string }; response: unknown }
  'config:write': { request: { scope: string; key: string; value: unknown }; response: void }

  // --- Agents ---
  'agent:get-states': { request: void; response: AgentSidecarState[] }

  // --- Claude Status ---
  'claude:get-status': { request: void; response: ClaudeStatus }
  'claude:recheck': { request: void; response: ClaudeStatus }

  // --- MCP server ---
  // Status of the in-process MCP endpoint (Streamable HTTP on localhost).
  // url is the address external clients connect to; null while not running.
  'mcp:status': {
    request: void
    response: {
      running: boolean
      toolCount: number
      url: string | null
      vaultRoot: string | null
    }
  }

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
  'canvas:list': {
    request: { vaultPath: string }
    response: { canvasIds: readonly string[] }
  }
  // Renderer-driven canvas write. Routes through the same per-file
  // mutex as agent-side tools (pin_to_canvas etc.) so the renderer's
  // debounced autosave cannot interleave with an in-flight agent
  // read-modify-write. Without this shared serialization, either side
  // can silently clobber the other's changes.
  'canvas:save': {
    request: { canvasPath: string; content: string }
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
      /** Snapshot of the active dock tabs at run start. Lets close_dock_tab
       * resolve a kind to an index without an extra round-trip. */
      dockTabsSnapshot?: ReadonlyArray<DockTab>
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
      // Optional harness slug (workstation step 3, the step 6 seam): flows
      // into turn attribution and commit trailers. Absent → identity.
      agentId?: string
      // Optional explicit model pick (workstation Phase 2 step 1). Validated
      // at the IPC boundary (roster + charset — resolveModelPick); absent,
      // unknown, or the DEFAULT_NATIVE_MODEL filler ⇒ adapter default, no flag.
      model?: string
    }
    response: { ok: true; sessionId: string } | { ok: false; error: string }
  }
  'cli-thread:input': {
    request: {
      threadId: string
      identity: import('./agent-identity').AgentIdentity
      text: string
      // Per-turn cwd from the renderer (workstation step 1): the renderer
      // already holds the workspace root; main no longer reads it from config.
      cwd: string
      // Optional harness slug (workstation step 3, the step 6 seam).
      agentId?: string
      // Optional explicit model pick (workstation Phase 2 step 1) — same
      // trust rule as cli-thread:spawn.
      model?: string
    }
    response: { ok: boolean }
  }
  'cli-thread:close': { request: { threadId: string }; response: void }
  'cli-thread:cancel': { request: { threadId: string }; response: { ok: boolean } }

  // --- Local embeddings / semantic search (3.11) ---
  // Strictly opt-in: the renderer only invokes these when the Settings
  // toggle is on, so disabled means zero embeddings IPC traffic.
  'embeddings:set-enabled': { request: { enabled: boolean }; response: void }
  'embeddings:status': {
    request: void
    response: {
      enabled: boolean
      state: 'off' | 'loading-model' | 'indexing' | 'ready' | 'error'
      docCount: number
      error?: string
    }
  }
  'embeddings:search': {
    request: { query: string; k?: number }
    response: import('./engine/search-engine').SearchHit[]
  }

  // --- Git substrate + approval queue (workstation contracts §6) ---
  // No `root` in any request: main resolves it from WorkspaceService.current()
  // so the renderer can never point git at an arbitrary path.
  'git:status': { request: void; response: import('./git-types').GitStatusResult }
  'git:diff': { request: { paths?: string[] }; response: string }
  'git:commit-approved': {
    request: import('./git-types').CommitApprovedOpts
    response: import('./git-types').GitOpResult
  }
  'git:revert-agent': {
    request: { agentId: string }
    response: import('./git-types').GitOpResult
  }
  'approvals:list': { request: void; response: import('./git-types').PendingChange[] }
  'approvals:resolve': {
    request: { id: string; approve: boolean; message?: string }
    response: import('./git-types').GitOpResult
  }

  // --- Dock IDE shell (workstation contracts §6, step 4) ---
  // Editor-center file open. Guard-checked: null when the pick is cancelled
  // or the chosen file sits outside the workspace root.
  'fs:select-file': { request: void; response: string | null }

  // --- Agent harness (workstation contracts §5/§6, step 6) ---
  // No `root` in either request: main resolves it from
  // WorkspaceService.current(). Result-style responses: duplicate/invalid
  // slug are expected failures, not throws.
  'harness:create': {
    request: { template: string; slug: string }
    response: import('./harness-types').HarnessCreateResult
  }
  'harness:list': {
    request: void
    response: import('./harness-types').HarnessSummary[]
  }
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
  // The turn exhausted MAX_TOOL_ITERATIONS while the model still wanted tools.
  // Emitted before message_end so consumers can tell "stopped mid-task" from
  // "finished" (the text notice alone is not machine-readable).
  | { kind: 'turn_limit' }
  | { kind: 'error'; code: import('./thread-types').ToolErrorCode; message: string }
  | {
      kind: 'tool_call_persisted'
      call: import('./thread-types').ToolCall
      result: import('./thread-types').ToolResult
    }
  | ({ kind: 'tool_pending_approval'; toolUseId: string } & AgentNativeApprovalPreview)

export interface IpcEvents {
  'terminal:data': { sessionId: SessionId; data: string }
  'terminal:exit': { sessionId: SessionId; code: number }
  'vault:files-changed-batch': {
    events: readonly { path: string; event: 'add' | 'change' | 'unlink' }[]
  }

  // Document Manager events (main -> renderer)
  // App Lifecycle events (main -> renderer)
  'app:will-quit': Record<string, never>

  'doc:external-change': { path: string; content: string }
  'doc:conflict': { path: string; diskContent: string }
  'doc:saved': { path: string }
  // A disk write (autosave or explicit save) failed. The renderer must keep
  // the dirty state visible so the user knows their work is not persisted.
  'doc:save-failed': { path: string; message: string }

  // Agent observation events (main -> renderer)
  'agent:states-changed': { states: readonly AgentSidecarState[] }

  // Canvas agent plan dispatch (main -> renderer).
  // canvasPath identifies which canvas file the plan applies to so the
  // renderer can ignore plans for canvases it doesn't currently have
  // loaded (otherwise blind apply mutates the wrong canvas in memory).
  'canvas:agent-plan-accepted': { plan: CanvasMutationPlan; canvasPath: string }

  // Claude status events (main -> renderer)
  'claude:status-changed': ClaudeStatus

  // Health monitoring events (main -> renderer)
  'health:report': InfraHealth

  // Block protocol events (main -> renderer): one snapshot per block transition.
  // See docs/architecture/block-protocol.md.
  'block:update': { sessionId: SessionId; block: Block }

  // Machina Native streaming events (main -> renderer)
  'agent-native:event': { runId: string; threadId: string } & AgentNativeEventBody

  // Agent-driven dock manipulation (main -> renderer). Fired when the agent
  // calls open_dock_tab / close_dock_tab so the renderer can apply the change
  // to the live thread store.
  'agent-native:dock-action': { threadId: string } & DockAction

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

  // Approval queue mutation (main -> renderer): pending item count for the
  // approvals tray badge. Fired on every queue change (contracts §6).
  'approvals:changed': { pending: number }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']

export type IpcEvent = keyof IpcEvents
export type IpcEventData<E extends IpcEvent> = IpcEvents[E]
