import { useClaudeStatusStore } from '../store/claude-status-store'
import type { ClaudeStatus } from '@shared/claude-status-types'

/** Selector hook for Claude status. */
export function useClaudeStatus(): ClaudeStatus {
  return useClaudeStatusStore((s) => s.status)
}
