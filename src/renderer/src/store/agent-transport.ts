import type { Thread } from '@shared/thread-types'
import type { AgentIdentity } from '@shared/agent-identity'
import type { DockTab } from '@shared/dock-types'
import { withTimeout } from '../utils/ipc-timeout'
import { useCliSessionStore } from './cli-session-store'
import { threadRuntimeIsClosed } from './agent-dispatch-store'

/**
 * AgentTransport (2.2): one command-side interface over the two agent
 * back-ends — the in-app Anthropic SDK agent ('machina-native') and the CLI
 * thread spawner ('cli-claude' / 'cli-codex' / 'cli-gemini' / 'cli-raw';
 * gemini stays in the CLI registry without growing its surface; ad-hoc raw is
 * terminal-only while a harness-bound raw thread may send through its stored
 * invocation template). thread-store
 * routes every agent-specific call through `transportFor(agent)` instead of
 * branching on `agent !== 'machina-native'` at each call site.
 *
 * Events deliberately stay out of this interface: both back-ends push results
 * over main→renderer IPC events (`agent-native:event`, `thread:cli-message`),
 * consumed centrally by use-thread-streaming. The transport covers the
 * renderer→main command side only.
 */

// run() resolves once the main process has accepted the request and produced a
// runId; model output streams later over agent-native:event. Bound only that
// call-to-runId latency so a stalled IPC can't leave the input bar wedged.
const AGENT_RUN_START_TIMEOUT_MS = 15_000
const CLI_IPC_TIMEOUT_MS = 15_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface SendTurnContext {
  readonly vaultPath: string
  /** Prior turns, native-format. CLI transports ignore this (the CLI session
   * holds its own history). */
  readonly historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  /** Dock tabs at run start, for the native agent's dock tools. */
  readonly dockTabsSnapshot: ReadonlyArray<DockTab>
}

export type DispatchStatus = 'accepted' | 'refused' | 'indeterminate'
export type DispatchSettlement =
  | { status: 'accepted'; runId?: string }
  | { status: 'refused' | 'indeterminate' }

export type SendTurnResult =
  /** Turn accepted; `runId` is set for back-ends with abortable runs. */
  | { status: 'accepted'; runId?: string }
  /** Main explicitly refused before input, so retrying is safe. */
  | { status: 'refused'; message: string }
  /** IPC did not settle; the non-cancelling operation may still complete. */
  | { status: 'indeterminate'; message: string; settlement: Promise<DispatchSettlement> }

export type SessionStartResult =
  | { status: 'accepted' }
  | { status: 'refused'; message: string }
  | { status: 'indeterminate'; message: string; settlement: Promise<DispatchSettlement> }

export interface AgentTransport {
  /** Start the per-thread session, if the back-end needs one. */
  start(thread: Thread, vaultPath: string): Promise<SessionStartResult>
  /** Deliver one user turn. Resolves when the turn is accepted, not finished. */
  sendTurn(thread: Thread, text: string, ctx: SendTurnContext): Promise<SendTurnResult>
  /** Request cancellation. Completion/error events prove settlement. */
  cancel(thread: Thread, runId: string | undefined): Promise<void>
  /** Tear down per-thread resources on thread deletion. */
  close(threadId: string): Promise<void>
}

const nativeTransport: AgentTransport = {
  start: async () => ({ status: 'accepted' }),

  sendTurn: async (thread, text, ctx) => {
    let operation: ReturnType<typeof window.api.agentNative.run> | undefined
    try {
      operation = window.api.agentNative.run({
        vaultPath: ctx.vaultPath,
        threadId: thread.id,
        model: thread.model,
        // The system prompt is owned by the main process (default +
        // .machina/agent-prompt.md override). Main ignores this legacy field.
        systemPrompt: '',
        userMessage: text,
        historyMessages: ctx.historyMessages,
        autoAccept: thread.autoAcceptSession ?? false,
        dockTabsSnapshot: ctx.dockTabsSnapshot
      })
      const { runId } = await withTimeout(
        operation,
        AGENT_RUN_START_TIMEOUT_MS,
        `agent-native:run ${thread.id}`
      )
      return { status: 'accepted', runId }
    } catch (err) {
      return {
        status: 'indeterminate',
        message: `Agent delivery status is unknown: ${errorMessage(err)}. The run may still execute; do not retry this turn. Stop cannot confirm cancellation before the run appears; wait for the thread to settle.`,
        settlement:
          operation?.then<DispatchSettlement, DispatchSettlement>(
            ({ runId }) => ({ status: 'accepted', runId }),
            () => ({ status: 'indeterminate' })
          ) ?? Promise.resolve({ status: 'indeterminate' })
      }
    }
  },

  cancel: async (_thread, runId) => {
    if (runId) await window.api.agentNative.abort(runId)
  },

  close: async () => {}
}

const cliTransport: AgentTransport = {
  start: async (thread, vaultPath) => {
    let operation: ReturnType<typeof window.api.cliThread.spawn> | undefined
    try {
      operation = window.api.cliThread.spawn({
        threadId: thread.id,
        identity: thread.agent,
        cwd: vaultPath,
        model: thread.model,
        ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {})
      })
      const result = await withTimeout(
        operation,
        CLI_IPC_TIMEOUT_MS,
        `cli-thread:spawn ${thread.id}`
      )
      // The session id is the renderer authority for the raw projection.
      if (result.ok && !threadRuntimeIsClosed(thread.id))
        useCliSessionStore.getState().seed(thread.id, result.sessionId)
      return result.ok ? { status: 'accepted' } : { status: 'refused', message: result.error }
    } catch (error) {
      return {
        status: 'indeterminate',
        message: `CLI session start status is unknown: ${errorMessage(error)}. A session may still appear; do not create another thread until you inspect this one.`,
        settlement:
          operation?.then<DispatchSettlement, DispatchSettlement>(
            (result) => {
              if (result.ok && !threadRuntimeIsClosed(thread.id))
                useCliSessionStore.getState().seed(thread.id, result.sessionId)
              return { status: result.ok ? 'accepted' : 'refused' }
            },
            () => ({ status: 'indeterminate' })
          ) ?? Promise.resolve({ status: 'indeterminate' })
      }
    }
  },

  sendTurn: async (thread, text, ctx) => {
    let operation: ReturnType<typeof window.api.cliThread.input> | undefined
    try {
      operation = window.api.cliThread.input({
        threadId: thread.id,
        identity: thread.agent,
        text,
        cwd: ctx.vaultPath,
        model: thread.model,
        ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {})
      })
      const res = await withTimeout(operation, CLI_IPC_TIMEOUT_MS, `cli-thread:input ${thread.id}`)
      return res.ok
        ? { status: 'accepted' }
        : {
            status: 'refused',
            message:
              thread.agent === 'cli-raw'
                ? thread.agentId !== undefined
                  ? 'Message not delivered: the bound raw harness invocation was refused or could not start. Check its invocation template and harness diagnostics, then try again.'
                  : 'Message not delivered: ad-hoc raw sessions have no structured input. Interact via the terminal.'
                : 'Message not delivered: the CLI session could not be started. Check that the agent CLI is installed, then try again.'
          }
    } catch (error) {
      return {
        status: 'indeterminate',
        message: `CLI delivery status is unknown: ${errorMessage(error)}. The command may still execute; do not retry this turn. Stop only sends an interrupt and cannot cancel the pending delivery; wait for the thread to settle.`,
        settlement:
          operation?.then<DispatchSettlement, DispatchSettlement>(
            (result) => ({ status: result.ok ? 'accepted' : 'refused' }),
            () => ({ status: 'indeterminate' })
          ) ?? Promise.resolve({ status: 'indeterminate' })
      }
    }
  },

  cancel: async (thread) => {
    await window.api.cliThread.cancel(thread.id)
  },

  close: async (threadId) => {
    await window.api.cliThread.close(threadId)
    // Thread deleted: forget the projection binding (the PTY was killed).
    useCliSessionStore.getState().drop(threadId)
  }
}

export function transportFor(agent: AgentIdentity): AgentTransport {
  return agent === 'machina-native' ? nativeTransport : cliTransport
}
