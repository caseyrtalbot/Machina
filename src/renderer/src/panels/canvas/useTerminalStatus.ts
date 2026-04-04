import { useState, useEffect, useCallback } from 'react'
import type { CanvasNode } from '@shared/canvas-types'
import { withTimeout } from '@renderer/utils/ipc-timeout'

// --- Types ---

export interface TerminalStatus {
  readonly nodeId: string
  readonly sessionId: string
  readonly label: string
  readonly status: 'unknown' | 'idle' | 'busy' | 'error' | 'dead' | 'claude'
  readonly processName: string
}

// --- Constants ---

export const SHELL_SET = new Set(['zsh', 'bash', 'fish', 'sh', 'dash'])

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 2000

// --- Pure functions ---

export function deriveLabel(metadata: Readonly<Record<string, unknown>>): string {
  if (metadata.actionName) return String(metadata.actionName)
  if (metadata.initialCommand === 'claude') return 'Claude'
  if (typeof metadata.initialCwd === 'string') {
    return metadata.initialCwd.split('/').pop() || 'Terminal'
  }
  return 'Terminal'
}

export function deriveStatus(
  sessionId: string,
  settled: ReadonlyMap<string, number>,
  processNames: ReadonlyMap<string, string>,
  metadata: Readonly<Record<string, unknown>>
): TerminalStatus['status'] {
  if (settled.has(sessionId)) {
    return settled.get(sessionId) !== 0 ? 'error' : 'dead'
  }
  if (!processNames.has(sessionId)) {
    return 'unknown'
  }
  if (metadata.initialCommand === 'claude' || metadata.actionId) {
    return 'claude'
  }
  const processName = processNames.get(sessionId) ?? ''
  if (SHELL_SET.has(processName)) {
    return 'idle'
  }
  return 'busy'
}

// --- Hook ---

export function useTerminalStatus(terminalNodes: readonly CanvasNode[]): readonly TerminalStatus[] {
  const [settled, setSettled] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [processNames, setProcessNames] = useState<ReadonlyMap<string, string>>(() => new Map())

  const nodeKey = terminalNodes.map((n) => `${n.id}:${n.content}`).join(',')

  const markSettled = useCallback((sessionId: string, code: number) => {
    setSettled((prev) => new Map([...prev, [sessionId, code]]))
  }, [])

  useEffect(() => {
    let cancelled = false

    const pollAll = async (): Promise<void> => {
      // Read current settled state via setter to avoid stale closures
      let currentSettled: ReadonlyMap<string, number> = new Map()
      setSettled((prev) => {
        currentSettled = prev
        return prev
      })

      const pollable = terminalNodes.filter(
        (n) => n.content !== '' && !currentSettled.has(n.content)
      )

      const results = await Promise.allSettled(
        pollable.map(async (node) => {
          const sessionId = node.content
          const name = await withTimeout(
            window.api.terminal.getProcessName(sessionId as never),
            POLL_TIMEOUT_MS,
            'dock-poll'
          )
          return { sessionId, name }
        })
      )

      if (cancelled) return

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const sessionId = pollable[i].content

        if (result.status === 'fulfilled') {
          const next = result.value.name ?? ''
          setProcessNames((prev) => {
            if (prev.get(sessionId) === next) return prev
            return new Map([...prev, [sessionId, next]])
          })
        } else {
          // Rejected or timed out: only mark dead if not already settled
          setSettled((prev) => {
            if (prev.has(sessionId)) return prev
            return new Map([...prev, [sessionId, 0]])
          })
        }
      }
    }

    // Immediate poll on mount
    pollAll()

    // Periodic polling
    const interval = setInterval(pollAll, POLL_INTERVAL_MS)

    // Exit listener
    const unsubscribe = window.api.on.terminalExit((data: { sessionId: string; code: number }) => {
      if (cancelled) return
      markSettled(data.sessionId, data.code)
    })

    return () => {
      cancelled = true
      clearInterval(interval)
      unsubscribe()
    }
  }, [nodeKey, markSettled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive statuses from state (not refs — React tracks these)
  const statuses: TerminalStatus[] = terminalNodes.map((node) => {
    const sessionId = node.content
    return {
      nodeId: node.id,
      sessionId,
      label: deriveLabel(node.metadata),
      status:
        sessionId === ''
          ? 'unknown'
          : deriveStatus(sessionId, settled, processNames, node.metadata),
      processName: processNames.get(sessionId) ?? ''
    }
  })

  // Sort: dead terminals sink to end, others maintain insertion order
  const alive = statuses.filter((s) => s.status !== 'dead')
  const dead = statuses.filter((s) => s.status === 'dead')

  return [...alive, ...dead]
}
