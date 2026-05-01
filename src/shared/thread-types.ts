import type { AgentIdentity } from './agent-identity'
import type { DockTab } from './dock-types'

export interface Thread {
  readonly id: string
  readonly agent: AgentIdentity
  readonly model: string
  readonly started: string
  lastMessage: string
  title: string
  dockState: { tabs: DockTab[] }
  messages: ThreadMessage[]
  autoAcceptSession?: boolean
}

export type ThreadMessage = UserMessage | AssistantMessage | SystemMessage

export interface UserMessage {
  readonly role: 'user'
  readonly body: string
  readonly sentAt: string
}

export interface AssistantMessage {
  readonly role: 'assistant'
  body: string
  readonly sentAt: string
  toolCalls?: Array<{ call: ToolCall; result?: ToolResult }>
  metadata?: { sessionId?: string; startedAt?: string; endedAt?: string }
}

export interface SystemMessage {
  readonly role: 'system'
  readonly body: string
  readonly sentAt: string
}

export interface PinToCanvasArgs {
  canvasId: string
  card: {
    title: string
    content?: string
    position?: { x: number; y: number }
    refs?: string[]
  }
}

export type ToolCall =
  | { id: string; kind: 'read_note'; args: { path: string } }
  | { id: string; kind: 'write_note'; args: { path: string; content: string } }
  | { id: string; kind: 'edit_note'; args: { path: string; find: string; replace: string } }
  | { id: string; kind: 'list_vault'; args: { globs?: string[] } }
  | { id: string; kind: 'search_vault'; args: { query: string; paths?: string[] } }
  | { id: string; kind: 'pin_to_canvas'; args: PinToCanvasArgs }
  | { id: string; kind: 'read_canvas'; args: { canvasId: string } }
  | { id: string; kind: 'cli_command'; args: { command: string; cwd: string } }
  | { id: string; kind: `cli_${string}_${string}`; args: Record<string, unknown> }

export type ToolResult =
  | { id: string; ok: true; output: unknown; pendingUserApproval?: boolean }
  | { id: string; ok: false; error: ToolError }

export interface ToolError {
  code: ToolErrorCode
  message: string
  hint?: string
}

export type ToolErrorCode =
  | 'SDK_TIMEOUT'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'FILE_NOT_FOUND'
  | 'PATH_OUT_OF_VAULT'
  | 'EDIT_FIND_NOT_UNIQUE'
  | 'EDIT_FIND_NOT_FOUND'
  | 'CANVAS_NOT_FOUND'
  | 'IO_TRANSIENT'
  | 'IO_FATAL'
