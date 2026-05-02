import { useEffect } from 'react'
import { useThreadStore } from '../store/thread-store'

export function useThreadStreaming(): void {
  const append = useThreadStore((s) => s.appendAssistantStreamChunk)
  const finalize = useThreadStore((s) => s.finalizeAssistantMessage)

  useEffect(() => {
    const off = window.api.on.agentNativeEvent((evt) => {
      if (evt.kind === 'text') {
        append(evt.threadId, evt.text)
      } else if (evt.kind === 'message_end') {
        void finalize(evt.threadId)
      } else if (evt.kind === 'error') {
        append(evt.threadId, `\n\n[error: ${evt.code}] ${evt.message}\n`)
        void finalize(evt.threadId)
      }
    })
    return off
  }, [append, finalize])
}
