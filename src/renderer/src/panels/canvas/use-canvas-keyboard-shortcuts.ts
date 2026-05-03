import { useEffect, type RefObject } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import type { CommandStack } from './canvas-commands'

interface CanvasKeyboardShortcutOptions {
  readonly commandStack: { readonly current: CommandStack }
  readonly containerRef: RefObject<HTMLElement | null>
  readonly setImportOpen: (open: boolean) => void
}

function isEditingSurfaceActive(): boolean {
  if (useCanvasStore.getState().focusedTerminalId) return true
  if (document.activeElement?.tagName === 'TEXTAREA') return true
  if (document.activeElement?.tagName === 'INPUT') return true
  if ((document.activeElement as HTMLElement | null)?.isContentEditable) return true
  if (document.activeElement?.closest('.cm-editor')) return true
  return false
}

function viewportCenter(containerRef: RefObject<HTMLElement | null>): { x: number; y: number } {
  const vp = useCanvasStore.getState().viewport
  const w = containerRef.current?.clientWidth ?? 1920
  const h = containerRef.current?.clientHeight ?? 1080
  return {
    x: (-vp.x + w / 2) / vp.zoom,
    y: (-vp.y + h / 2) / vp.zoom
  }
}

export function useCanvasKeyboardShortcuts({
  commandStack,
  containerRef,
  setImportOpen
}: CanvasKeyboardShortcutOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault()
        if (e.shiftKey) {
          useCanvasStore.getState().saveFocusFrame(e.key)
        } else {
          useCanvasStore.getState().jumpToFocusFrame(e.key)
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedEdgeId, removeEdge, selectedNodeIds, removeNode } =
          useCanvasStore.getState()
        if (isEditingSurfaceActive()) return

        if (selectedEdgeId) removeEdge(selectedEdgeId)
        if (selectedNodeIds.size > 0) {
          for (const id of selectedNodeIds) removeNode(id)
        }
      }

      if (e.key === 'j' || e.key === 'k') {
        if (isEditingSurfaceActive()) return

        e.preventDefault()
        if (e.key === 'j') {
          useCanvasStore.getState().focusNextCard()
        } else {
          useCanvasStore.getState().focusPrevCard()
        }
      }

      if (e.key === 'Escape') {
        const { lockedCardId } = useCanvasStore.getState()
        if (lockedCardId) {
          useCanvasStore.getState().unlockCard()
        } else {
          useCanvasStore.getState().setFocusedCard(null)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void commandStack.current.undo()
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        void commandStack.current.redo()
      } else if (e.key === 'g') {
        if (
          !containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body
        )
          return
        e.preventDefault()
        setImportOpen(true)
      } else if (e.key === 'e' && e.shiftKey) {
        e.preventDefault()
        const { splitFilePath: sp } = useCanvasStore.getState()
        if (sp) {
          useCanvasStore.getState().closeSplit()
        } else {
          const focusedId = useCanvasStore.getState().focusedCardId
          const focusedNode = focusedId
            ? useCanvasStore.getState().nodes.find((n) => n.id === focusedId)
            : null
          if (focusedNode?.content) {
            useCanvasStore.getState().openSplit(focusedNode.content)
          }
        }
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        const center = viewportCenter(containerRef)
        if (e.shiftKey) {
          const { artifacts, graph, fileToId } = useVaultStore.getState()
          const fileToIdMap = new Map(Object.entries(fileToId))
          const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
          useCanvasStore.getState().applySemanticLayout(center, fileToIdMap, artMap, graph.edges)
        } else {
          useCanvasStore.getState().applyTileLayout('grid-2x2', center)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandStack, containerRef, setImportOpen])
}
