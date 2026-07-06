import type { Thread } from '@shared/thread-types'
import type { AgentIdentity } from '@shared/agent-identity'
import type { DockTab } from '@shared/dock-types'
import { withTimeout } from '../utils/ipc-timeout'

/**
 * AgentTransport (2.2): one command-side interface over the two agent
 * back-ends — the in-app Anthropic SDK agent ('machina-native') and the CLI
 * thread spawner ('cli-claude' / 'cli-codex' / 'cli-gemini'; gemini stays in
 * the CLI registry without growing its surface). thread-store routes every
 * agent-specific call through `transportFor(agent)` instead of branching on
 * `agent !== 'machina-native'` at each call site.
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

export interface SendTurnContext {
  readonly vaultPath: string
  /** Prior turns, native-format. CLI transports ignore this (the CLI session
   * holds its own history). */
  readonly historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  /** Dock tabs at run start, for the native agent's dock tools. */
  readonly dockTabsSnapshot: ReadonlyArray<DockTab>
}

export type SendTurnResult =
  /** Turn accepted; `runId` is set for back-ends with abortable runs. */
  | { ok: true; runId?: string }
  /** Turn never started — `message` is the user-facing system message. */
  | { ok: false; message: string }

export interface AgentTransport {
  /** Start the per-thread session, if the back-end needs one. */
  start(thread: Thread, vaultPath: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** Deliver one user turn. Resolves when the turn is accepted, not finished. */
  sendTurn(thread: Thread, text: string, ctx: SendTurnContext): Promise<SendTurnResult>
  /** Cancel the in-flight turn. `runId` comes from the matching sendTurn. */
  cancel(thread: Thread, runId: string | undefined): Promise<void>
  /** Tear down per-thread resources on thread deletion. */
  close(threadId: string): Promise<void>
}

const nativeTransport: AgentTransport = {
  start: async () => ({ ok: true }),

  sendTurn: async (thread, text, ctx) => {
    try {
      const { runId } = await withTimeout(
        window.api.agentNative.run({
          vaultPath: ctx.vaultPath,
          threadId: thread.id,
          model: thread.model,
          // The system prompt is owned by the main process (default +
          // .machina/agent-prompt.md override). The field survives in the IPC
          // contract because ipc-channels.ts belongs to concurrent refactor
          // items; main ignores it. TODO(2.3/2.6): drop from the channel.
          systemPrompt: '',
          userMessage: text,
          historyMessages: ctx.historyMessages,
          autoAccept: thread.autoAcceptSession ?? false,
          dockTabsSnapshot: ctx.dockTabsSnapshot
        }),
        AGENT_RUN_START_TIMEOUT_MS,
        `agent-native:run ${thread.id}`
      )
      return { ok: true, runId }
    } catch (err) {
      // The turn never started (timeout or IPC failure). Tradeoff: run()
      // returns the runId synchronously today, so the only way to time out is
      // a hung/contended main process. If run() were merely slow and resolved
      // just after 15s, its late runId is dropped here — strictly better than
      // the prior infinite wedge, but the rare orphaned run would not be
      // Stop-abortable. Acceptable until run() can actually block.
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, message: `Agent run failed to start: ${message}` }
    }
  },

  cancel: async (_thread, runId) => {
    if (runId) await window.api.agentNative.abort(runId)
  },

  close: async () => {}
}

const cliTransport: AgentTransport = {
  start: async (thread, vaultPath) => {
    const result = await window.api.cliThread.spawn({
      threadId: thread.id,
      identity: thread.agent,
      cwd: vaultPath,
      // Harness attribution (workstation step 6): the slug rides the spawn so
      // turn windows and commit trailers carry it. Absent → identity.
      ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {})
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  },

  sendTurn: async (thread, text, ctx) => {
    const res = await window.api.cliThread.input({
      threadId: thread.id,
      identity: thread.agent,
      text,
      cwd: ctx.vaultPath,
      // Re-sent per turn: the spawner map is in-memory, so a relaunched app's
      // spawn-on-demand path needs the persisted slug again (step 6).
      ...(thread.agentId !== undefined ? { agentId: thread.agentId } : {})
    })
    return res.ok
      ? { ok: true }
      : {
          ok: false,
          message:
            'Message not delivered: the CLI session could not be started. Check that the agent CLI is installed, then try again.'
        }
  },

  cancel: async (thread) => {
    await window.api.cliThread.cancel(thread.id)
  },

  close: async (threadId) => {
    await window.api.cliThread.close(threadId)
  }
}

export function transportFor(agent: AgentIdentity): AgentTransport {
  return agent === 'machina-native' ? nativeTransport : cliTransport
}
