import { useEffect } from 'react'
import type { ToolCall } from '@shared/thread-types'
import { useThreadStore } from '../store/thread-store'

export function useThreadStreaming(): void {
  const append = useThreadStore((s) => s.appendAssistantStreamChunk)
  const startToolCall = useThreadStore((s) => s.startPendingToolCall)
  const appendToolCall = useThreadStore((s) => s.appendPendingToolCall)
  const finalize = useThreadStore((s) => s.finalizeAssistantMessage)
  const appendCliMessage = useThreadStore((s) => s.appendCliMessage)

  useEffect(() => {
    const off = window.api.on.agentNativeEvent((evt) => {
      if (evt.kind === 'text') {
        append(evt.threadId, evt.text)
      } else if (evt.kind === 'tool_pending_approval') {
        const call = pendingPreviewToCall(evt.toolUseId, evt)
        if (call) startToolCall(evt.threadId, call)
      } else if (evt.kind === 'tool_call_persisted') {
        appendToolCall(evt.threadId, evt.call, evt.result)
        if (evt.call.kind === 'pin_to_canvas' && evt.result.ok) {
          const out = evt.result.output as { cardId?: string } | null
          window.dispatchEvent(
            new CustomEvent('machina:canvas:card-added', {
              detail: { canvasId: evt.call.args.canvasId, cardId: out?.cardId ?? '' }
            })
          )
        }
      } else if (evt.kind === 'message_end') {
        void finalize(evt.threadId)
      } else if (evt.kind === 'error') {
        append(evt.threadId, `\n\n[error: ${evt.code}] ${evt.message}\n`)
        void finalize(evt.threadId)
      }
    })
    return off
  }, [append, startToolCall, appendToolCall, finalize])

  useEffect(() => {
    const off = window.api.on.threadCliMessage((evt) => {
      void appendCliMessage(evt.threadId, evt.message)
    })
    return off
  }, [appendCliMessage])
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
