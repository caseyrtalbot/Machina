import { useEffect, useRef } from 'react'
import { useCanvasStore } from '../store/canvas-store'
import { createCanvasNode } from '@shared/canvas-types'

const GLOW_DURATION_MS = 4000

/**
 * Subscribes to project file change IPC events and drives card glow animations.
 * When a file change matches a project-file canvas node, that node's metadata.isActive
 * is set to true for GLOW_DURATION_MS, then reset to false. Also increments touchCount.
 *
 * If a changed file has no card yet, a new project-file node is created.
 */
export function useProjectActivity(enabled: boolean, projectPath: string | null): void {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (!enabled || !projectPath) return
    if (typeof window.api?.on?.projectFileChanged !== 'function') return

    const unsub = window.api.on.projectFileChanged((event) => {
      if (event.event === 'unlink') return

      const store = useCanvasStore.getState()
      const nodes = store.nodes

      // Find matching project-file node by relative path in content
      const matchedNode = nodes.find(
        (n) => n.type === 'project-file' && n.content === event.relativePath
      )

      if (matchedNode) {
        // Activate glow and increment touch count
        const currentTouchCount = (matchedNode.metadata?.touchCount as number) ?? 0
        store.updateNodeMetadata(matchedNode.id, {
          isActive: true,
          touchCount: currentTouchCount + 1
        })

        // Clear existing timer and set new deactivation
        const existing = timersRef.current.get(matchedNode.id)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
          useCanvasStore.getState().updateNodeMetadata(matchedNode.id, { isActive: false })
          timersRef.current.delete(matchedNode.id)
        }, GLOW_DURATION_MS)

        timersRef.current.set(matchedNode.id, timer)
      } else {
        // Find a good position for the new card (after existing project-file nodes)
        const projectFileNodes = nodes.filter((n) => n.type === 'project-file')
        const lastNode = projectFileNodes[projectFileNodes.length - 1]
        const x = lastNode ? lastNode.position.x : 700
        const y = lastNode ? lastNode.position.y + lastNode.size.height + 12 : 0

        const ext = event.relativePath.split('.').pop()?.toLowerCase() ?? ''
        const langMap: Record<string, string> = {
          ts: 'typescript',
          tsx: 'typescriptreact',
          js: 'javascript',
          jsx: 'javascriptreact',
          json: 'json',
          css: 'css',
          md: 'markdown'
        }

        const newNode = createCanvasNode(
          'project-file',
          { x, y },
          {
            size: { width: 240, height: 80 },
            content: event.relativePath,
            metadata: {
              relativePath: event.relativePath,
              language: langMap[ext] ?? ext,
              touchCount: 1,
              lastTouchedBy: null,
              isActive: true
            }
          }
        )

        store.addNode(newNode)

        const timer = setTimeout(() => {
          useCanvasStore.getState().updateNodeMetadata(newNode.id, { isActive: false })
          timersRef.current.delete(newNode.id)
        }, GLOW_DURATION_MS)

        timersRef.current.set(newNode.id, timer)
      }
    })

    return () => {
      unsub()
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()

      // Deactivate all project-file nodes
      const nodes = useCanvasStore.getState().nodes
      for (const node of nodes) {
        if (node.type === 'project-file' && node.metadata?.isActive) {
          useCanvasStore.getState().updateNodeMetadata(node.id, { isActive: false })
        }
      }
    }
  }, [enabled, projectPath])
}
