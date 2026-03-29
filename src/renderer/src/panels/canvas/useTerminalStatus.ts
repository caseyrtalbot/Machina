import { useState, useEffect, useRef, useCallback } from 'react'
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
  if (metadata.initialCommand === 'claude') {
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
  const settledRef = useRef<Map<string, number>>(new Map())
  const processNamesRef = useRef<Map<string, string>>(new Map())
  const [, setRenderTick] = useState(0)

  const triggerRender = useCallback(() => {
    setRenderTick((prev) => prev + 1)
  }, [])

  const nodeKey = terminalNodes.map((n) => n.id).join(',')

  useEffect(() => {
    let cancelled = false

    const pollAll = async (): Promise<void> => {
      const pollable = terminalNodes.filter(
        (n) => n.content !== '' && !settledRef.current.has(n.content)
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

      let changed = false
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const sessionId = pollable[i].content

        if (settledRef.current.has(sessionId)) continue

        if (result.status === 'fulfilled') {
          const prev = processNamesRef.current.get(sessionId)
          const next = result.value.name ?? ''
          if (prev !== next) {
            processNamesRef.current = new Map(processNamesRef.current).set(sessionId, next)
            changed = true
          }
        } else {
          // Rejected or timed out: mark as dead
          settledRef.current = new Map(settledRef.current).set(sessionId, 0)
          changed = true
        }
      }

      if (changed) triggerRender()
    }

    // Immediate poll on mount
    pollAll()

    // Periodic polling
    const interval = setInterval(pollAll, POLL_INTERVAL_MS)

    // Exit listener
    const unsubscribe = window.api.on.terminalExit((data: { sessionId: string; code: number }) => {
      if (cancelled) return
      settledRef.current = new Map(settledRef.current).set(data.sessionId, data.code)
      triggerRender()
    })

    return () => {
      cancelled = true
      clearInterval(interval)
      unsubscribe()
    }
  }, [nodeKey, triggerRender]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive statuses from current ref state
  const statuses: TerminalStatus[] = terminalNodes.map((node) => {
    const sessionId = node.content
    return {
      nodeId: node.id,
      sessionId,
      label: deriveLabel(node.metadata),
      status:
        sessionId === ''
          ? 'unknown'
          : deriveStatus(sessionId, settledRef.current, processNamesRef.current, node.metadata),
      processName: processNamesRef.current.get(sessionId) ?? ''
    }
  })

  // Sort: dead terminals sink to end, others maintain insertion order
  const alive = statuses.filter((s) => s.status !== 'dead')
  const dead = statuses.filter((s) => s.status === 'dead')

  return [...alive, ...dead]
}
