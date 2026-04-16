import type { AgentStreamEvent, AgentStreamPhase } from '@shared/agent-action-types'

export interface StreamState {
  readonly phase: AgentStreamPhase
  readonly thinking: string
  readonly visibleText: string
  readonly rawText: string
  readonly fenceHidden: boolean
  readonly opCount: number | null
}

export function initialStreamState(): StreamState {
  return {
    phase: 'starting',
    thinking: '',
    visibleText: '',
    rawText: '',
    fenceHidden: false,
    opCount: null
  }
}

// Matches ```json or bare ``` at line start, followed by whitespace or end.
// We scan the full raw buffer (not just the tail) so a fence that arrives
// *with* trailing JSON content in the same delta as the fence marker is still detected.
const FENCE_RE = /(^|\n)```(?:json)?(?=\s|$)/

export function reduceStream(state: StreamState, ev: AgentStreamEvent): StreamState {
  switch (ev.kind) {
    case 'phase':
      return {
        ...state,
        phase: ev.phase,
        opCount: ev.phase === 'materializing' ? (ev.count ?? state.opCount) : state.opCount
      }

    case 'thinking-delta':
      return { ...state, thinking: state.thinking + ev.text }

    case 'text-delta': {
      const nextRaw = state.rawText + ev.text
      if (state.fenceHidden) {
        return { ...state, rawText: nextRaw }
      }
      const match = FENCE_RE.exec(nextRaw)
      if (match) {
        const fenceStartInRaw = match.index + match[1].length
        const visibleCut = nextRaw.slice(0, fenceStartInRaw)
        return {
          ...state,
          rawText: nextRaw,
          visibleText: visibleCut,
          fenceHidden: true
        }
      }
      return {
        ...state,
        rawText: nextRaw,
        visibleText: state.visibleText + ev.text
      }
    }
  }
}
