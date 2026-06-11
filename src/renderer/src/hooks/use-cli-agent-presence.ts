import { useEffect, useState } from 'react'
import type { CLIAgentSessionState, CLIAgentSessionStatus } from '@shared/cli-agent-session-types'

/**
 * Agent presence on terminal sessions (refactor item 3.12).
 *
 * Folds `cli-agent:session-status-changed` / `cli-agent:context-updated`
 * events (emitted by CLIAgentSessionListener in the main process) into a
 * per-session map of which CLI agent (claude/codex/gemini) is active and in
 * what state. Entries clear when the underlying PTY session exits.
 */

export interface CLIAgentPresence {
  readonly agentId: string
  readonly status: CLIAgentSessionState
}

export type CLIAgentPresenceMap = Readonly<Record<string, CLIAgentPresence>>

/** Fold one session-status/context event into the map. Returns the same map when nothing changed. */
export function foldAgentEvent(
  map: CLIAgentPresenceMap,
  event: CLIAgentSessionStatus
): CLIAgentPresenceMap {
  const prev = map[event.sessionId]
  if (prev && prev.agentId === event.agentId && prev.status === event.status) return map
  return { ...map, [event.sessionId]: { agentId: event.agentId, status: event.status } }
}

/** Drop a session's presence (PTY exited). Returns the same map when the session is unknown. */
export function clearSessionPresence(
  map: CLIAgentPresenceMap,
  sessionId: string
): CLIAgentPresenceMap {
  if (!(sessionId in map)) return map
  const { [sessionId]: _removed, ...rest } = map
  return rest
}

/** Live per-session CLI agent presence, keyed by terminal sessionId. */
export function useCliAgentPresence(): CLIAgentPresenceMap {
  const [map, setMap] = useState<CLIAgentPresenceMap>({})

  useEffect(() => {
    const fold = (event: CLIAgentSessionStatus): void => setMap((m) => foldAgentEvent(m, event))
    const offStatus = window.api.on.cliAgentSessionStatus(fold)
    const offContext = window.api.on.cliAgentContextUpdated(fold)
    const offExit = window.api.on.terminalExit(({ sessionId }) =>
      setMap((m) => clearSessionPresence(m, sessionId))
    )
    return () => {
      offStatus()
      offContext()
      offExit()
    }
  }, [])

  return map
}
