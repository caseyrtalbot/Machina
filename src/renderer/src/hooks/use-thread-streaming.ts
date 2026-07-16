import { useEffect } from 'react'
import type { CanvasNode } from '@shared/canvas-types'
import type { ThreadMessage, ToolCall } from '@shared/thread-types'
// Loads the thread:changed subscription app-wide (P3 step 4): main-persisted
// appends reconcile the open thread from disk; this hook itself is
// display-only (its thread:save calls are metadata merges for cli threads).
import '../store/thread-sync'
import { useThreadStore } from '../store/thread-store'
import { useDockStore } from '../store/dock-store'
import { AUTH_ERROR_BODY } from '../panels/agent-shell/ThreadMessage'

export function useThreadStreaming(): void {
  const append = useThreadStore((s) => s.appendAssistantStreamChunk)
  const startToolCall = useThreadStore((s) => s.startPendingToolCall)
  const appendToolCall = useThreadStore((s) => s.appendPendingToolCall)
  const finalize = useThreadStore((s) => s.finalizeAssistantMessage)
  const appendCliMessage = useThreadStore((s) => s.appendCliMessage)
  const setRunId = useThreadStore((s) => s.setRunId)
  const addDockTab = useDockStore((s) => s.addDockTab)
  const removeDockTab = useDockStore((s) => s.removeDockTab)

  useEffect(() => {
    const off = window.api.on.agentNativeEvent((evt) => {
      if (evt.kind === 'text') {
        append(evt.threadId, evt.runId, evt.text)
      } else if (evt.kind === 'tool_pending_approval') {
        const call = pendingPreviewToCall(evt.toolUseId, evt)
        if (call) startToolCall(evt.threadId, call)
      } else if (evt.kind === 'tool_call_persisted') {
        appendToolCall(evt.threadId, evt.call, evt.result)
        // The model resumes prose after tool results with no separator in the
        // stream, gluing sentences together ("...topic.Good - I can see...").
        // Join segments as paragraphs; CLI deltas embed this joiner already.
        const buffered = useThreadStore.getState().streamingByThreadId[evt.threadId] ?? ''
        if (buffered.length > 0 && !buffered.endsWith('\n\n')) {
          append(evt.threadId, evt.runId, buffered.endsWith('\n') ? '\n' : '\n\n')
        }
        if (evt.call.kind === 'pin_to_canvas' && evt.result.ok) {
          const out = evt.result.output as { cardId?: string; node?: CanvasNode } | null
          window.dispatchEvent(
            new CustomEvent('machina:canvas:card-added', {
              detail: {
                canvasId: evt.call.args.canvasId,
                cardId: out?.cardId ?? '',
                node: out?.node
              }
            })
          )
        }
      } else if (evt.kind === 'message_end') {
        void finalize(evt.threadId)
      } else if (evt.kind === 'error') {
        if (evt.code === 'AUTH') {
          // Auth failures get a real system message with a Settings action
          // (rendered by ThreadMessage) instead of a raw [error: AUTH] dump.
          const sysMsg: ThreadMessage = {
            role: 'system',
            body: AUTH_ERROR_BODY,
            sentAt: new Date().toISOString()
          }
          const st = useThreadStore.getState()
          const hasPartial =
            (st.streamingByThreadId[evt.threadId] ?? '').length > 0 ||
            (st.pendingToolCallsByThreadId[evt.threadId] ?? []).length > 0
          void (async () => {
            // Materialize any partial turn first so its text isn't dropped;
            // otherwise just clear the run id (finalize would append an
            // empty assistant message).
            if (hasPartial) await finalize(evt.threadId)
            else setRunId(evt.threadId, null)
            await appendCliMessage(evt.threadId, sysMsg)
          })()
        } else {
          // Non-auth failures also get a real system message instead of
          // bracket-garbage text glued into the assistant body.
          const sysMsg: ThreadMessage = {
            role: 'system',
            body: `The agent run failed (${evt.code}): ${evt.message}`,
            sentAt: new Date().toISOString()
          }
          const st = useThreadStore.getState()
          const hasPartial =
            (st.streamingByThreadId[evt.threadId] ?? '').length > 0 ||
            (st.pendingToolCallsByThreadId[evt.threadId] ?? []).length > 0
          void (async () => {
            // Materialize any partial turn first so its text isn't dropped;
            // otherwise just clear the run id (finalize would append an
            // empty assistant message).
            if (hasPartial) await finalize(evt.threadId)
            else setRunId(evt.threadId, null)
            await appendCliMessage(evt.threadId, sysMsg)
          })()
        }
      }
    })
    return off
  }, [append, startToolCall, appendToolCall, finalize, appendCliMessage, setRunId])

  useEffect(() => {
    const off = window.api.on.threadCliMessage((evt) => {
      const m = evt.message
      // Wire contract with CliAgentThreadBridge: interim streaming deltas are
      // assistant messages WITHOUT toolCalls; the final message always carries
      // toolCalls (the cli_command entry at minimum) and its body extends the
      // concatenation of the deltas.
      if (m.role === 'assistant' && m.toolCalls === undefined) {
        // Deltas arrive with the '\n\n' segment joiner already embedded, so a
        // plain append keeps the buffer an exact prefix of the final body.
        const key = cliRunKey(evt.threadId, m)
        if (useThreadStore.getState().runIdByThreadId[evt.threadId] !== key) {
          setRunId(evt.threadId, key)
        }
        append(evt.threadId, key, m.body)
        return
      }
      const st = useThreadStore.getState()
      const buffered = st.streamingByThreadId[evt.threadId] ?? ''
      if (m.role === 'assistant' && buffered.length > 0 && m.body.startsWith(buffered)) {
        // A streamed turn: route through the native finalize path so the
        // streaming buffer and run id are cleared atomically with the append.
        const key = st.runIdByThreadId[evt.threadId]
        const remainder = m.body.slice(buffered.length)
        if (remainder.length > 0 && key !== undefined) append(evt.threadId, key, remainder)
        for (const tc of m.toolCalls ?? []) {
          if (tc.result) appendToolCall(evt.threadId, tc.call, tc.result)
          else startToolCall(evt.threadId, tc.call)
        }
        void finalize(evt.threadId)
        return
      }
      // No interim deltas were streamed (plain-text agents, or the whole
      // reply arrived in the completion pass): append the message as-is.
      void appendCliMessage(evt.threadId, m)
    })
    return off
  }, [append, setRunId, startToolCall, appendToolCall, finalize, appendCliMessage])

  useEffect(() => {
    const off = window.api.on.agentNativeDockAction((evt) => {
      const active = useThreadStore.getState().activeThreadId
      if (active !== evt.threadId) return
      if (evt.action === 'open') addDockTab(evt.tab)
      else if (evt.action === 'close') removeDockTab(evt.index)
    })
    return off
  }, [addDockTab, removeDockTab])
}

/** Stable per-turn streaming key for a CLI thread (one PTY block = one turn). */
function cliRunKey(threadId: string, m: ThreadMessage): string {
  const meta = m.role === 'assistant' ? m.metadata : undefined
  return `cli:${meta?.sessionId ?? threadId}:${meta?.startedAt ?? ''}`
}

function pendingPreviewToCall(
  id: string,
  evt:
    | { approvalKind: 'write_note'; preview: { path: string; content: string } }
    | { approvalKind: 'edit_note'; preview: { path: string; find: string; replace: string } }
): ToolCall | null {
  if (evt.approvalKind === 'write_note') {
    return {
      id,
      kind: 'write_note',
      args: { path: evt.preview.path, content: evt.preview.content }
    }
  }
  if (evt.approvalKind === 'edit_note') {
    return {
      id,
      kind: 'edit_note',
      args: { path: evt.preview.path, find: evt.preview.find, replace: evt.preview.replace }
    }
  }
  return null
}
