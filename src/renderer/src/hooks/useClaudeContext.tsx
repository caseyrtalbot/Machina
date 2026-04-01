import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { logError } from '../utils/error-logger'
import { useCanvasStore } from '../store/canvas-store'
import { useVaultStore } from '../store/vault-store'
import { colors, typography } from '../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import { TE_DIR } from '@shared/constants'

export interface ClaudeContextResult {
  /** JSX for the title bar context summary. null for non-Claude cards. */
  readonly contextBadge: ReactNode
  /** Number of file cards Claude can see. */
  readonly contextCardCount: number
  /** Whether context injection failed (sticky until card restart). */
  readonly contextError: boolean
  /** Mark context injection as failed (sticky). */
  readonly markError: () => void
}

/**
 * Manages spatial context for Claude terminal cards.
 *
 * Writes a context file listing vault file paths on the canvas.
 * Claude reads the actual files directly rather than receiving
 * pre-digested snippets in the system prompt.
 */
export function useClaudeContext(node: CanvasNode, isClaudeCard: boolean): ClaudeContextResult {
  const [contextCardCount, setContextCardCount] = useState(0)
  const [contextError, setContextError] = useState(false)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const vaultPathRef = useRef(vaultPath)
  vaultPathRef.current = vaultPath

  // Auto-notify: rewrite context file when canvas nodes change.
  // Fingerprint tracks non-terminal node IDs only (not positions, not edges).
  useEffect(() => {
    if (!isClaudeCard) return

    const getFingerprint = () => {
      const { nodes } = useCanvasStore.getState()
      return nodes
        .filter((n) => n.id !== node.id && n.type !== 'terminal')
        .map((n) => n.id)
        .sort()
        .join(',')
    }
    let prevFingerprint = getFingerprint()
    let lastNodesRef = useCanvasStore.getState().nodes

    const unsub = useCanvasStore.subscribe((state) => {
      if (state.nodes === lastNodesRef) return
      lastNodesRef = state.nodes

      const curFingerprint = getFingerprint()
      if (curFingerprint === prevFingerprint) return
      prevFingerprint = curFingerprint

      import('../engine/context-serializer')
        .then(({ buildCanvasContext }) => {
          const { nodes } = useCanvasStore.getState()
          const contextFilePath = vaultPathRef.current
            ? `${vaultPathRef.current}/${TE_DIR}/context-${node.id}.txt`
            : undefined
          const result = buildCanvasContext(node.id, nodes, { contextFilePath })
          if (result.text && vaultPathRef.current) {
            window.api.fs.writeFile(contextFilePath!, result.text).catch(console.error)
          }
          setContextCardCount(result.fileCount)
        })
        .catch(console.error)
    })

    return () => unsub()
  }, [isClaudeCard, node.id])

  // Clean up context file on unmount
  useEffect(() => {
    if (!isClaudeCard) return
    return () => {
      const currentVaultPath = vaultPathRef.current ?? useVaultStore.getState().vaultPath
      if (currentVaultPath) {
        const contextPath = `${currentVaultPath}/${TE_DIR}/context-${node.id}.txt`
        window.api.fs
          .deleteFile(contextPath)
          .catch((err) => logError('claude-context-cleanup', err))
      }
    }
  }, [isClaudeCard, node.id])

  const markError = useCallback(() => {
    setContextError(true)
  }, [])

  const contextBadge = isClaudeCard ? (
    <span
      className="flex items-center gap-1 shrink-0 ml-2"
      title={
        contextError
          ? 'Context injection failed. Restart this Claude card to retry.'
          : `Claude sees ${contextCardCount} files on canvas`
      }
    >
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          width: 6,
          height: 6,
          backgroundColor: contextError ? '#f59e0b' : colors.text.secondary
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: colors.text.muted,
          fontFamily: typography.fontFamily.mono
        }}
      >
        {contextCardCount}
      </span>
    </span>
  ) : null

  return { contextBadge, contextCardCount, contextError, markError }
}
