import { useEffect } from 'react'
import { useClaudeStatusStore } from '../store/claude-status-store'
import type { ClaudeStatus } from '@shared/claude-status-types'

/** Initialize Claude status: fetch once, subscribe to push updates. Call from App.tsx. */
export function useClaudeStatusInit(): void {
  useEffect(() => {
    // Resolve the native API key flag before pushing the first status update
    // so the auto-show gate sees the correct value on first paint. There's no
    // change event for the key today, so we sample it once at init; the
    // settings panel can flip the flag explicitly when the user updates it.
    void window.api.agentNative.hasKey().then((hasKey) => {
      useClaudeStatusStore.getState().setNativeKeyConfigured(hasKey)
      void window.api.claude.getStatus().then((status) => {
        useClaudeStatusStore.getState().setStatus(status)
      })
    })
    const unsub = window.api.on.claudeStatusChanged((status) => {
      useClaudeStatusStore.getState().setStatus(status)
    })
    return unsub
  }, [])
}

/** Selector hook for Claude status. */
export function useClaudeStatus(): ClaudeStatus {
  return useClaudeStatusStore((s) => s.status)
}
