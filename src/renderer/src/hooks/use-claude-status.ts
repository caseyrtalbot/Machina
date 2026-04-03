import { useEffect } from 'react'
import { useClaudeStatusStore } from '../store/claude-status-store'
import type { ClaudeStatus } from '@shared/claude-status-types'

/** Initialize Claude status: fetch once, subscribe to push updates. Call from App.tsx. */
export function useClaudeStatusInit(): void {
  useEffect(() => {
    void window.api.claude.getStatus().then((status) => {
      useClaudeStatusStore.getState().setStatus(status)
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
