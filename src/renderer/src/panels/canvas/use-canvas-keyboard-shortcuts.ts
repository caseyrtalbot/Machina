import { useEffect, useRef, type RefObject } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import {
  copySelectionToClipboard,
  duplicateSelectionCommand,
  layoutCommand,
  nudgeNodesCommand,
  pasteClipboardCommand,
  removeEdgeCommand,
  removeNodesCommand,
  type CommandStack
} from './canvas-commands'
import { SNAP_GRID_SIZE } from './use-canvas-drag'
import { createNoteAtCursor } from './create-note-at-cursor'

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

/**
 * A visible `role="menu"` element (card/canvas context menu, zoom menu, agent
 * picker) owns the keyboard — its ArrowUp/ArrowDown navigation must not also
 * nudge cards. Zero-size menus are hidden behind a KeepAlive tab; ignore them.
 */
function isMenuOpen(): boolean {
  for (const el of document.querySelectorAll('[role="menu"]')) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return true
  }
  return false
}

/**
 * True while this canvas panel is hidden behind another KeepAlive dock tab
 * (display:none collapses its rect to zero). Every window-level key handler
 * must bail when hidden: with two mounted CanvasViews, a hidden view's handler
 * would build commands from the VISIBLE canvas's state (via the active-store
 * proxy) and push them onto its own stack — replaying one canvas's commands
 * onto another on undo, double-creating notes on `n`, double-advancing j/k.
 */
function isCanvasHidden(containerRef: RefObject<HTMLElement | null>): boolean {
  const rect = containerRef.current?.getBoundingClientRect()
  return !rect || rect.width === 0 || rect.height === 0
}

/**
 * Spatial shortcuts (⌘A/⌘C/⌘V/⌘D, arrow nudge) must not fire while typing,
 * while a menu is open, while a card is locked for interaction, or while the
 * canvas panel is hidden behind another KeepAlive tab (display:none collapses
 * its rect to zero). Exported for tests.
 */
export function isSpatialShortcutBlocked(containerRef: RefObject<HTMLElement | null>): boolean {
  if (isEditingSurfaceActive()) return true
  if (isMenuOpen()) return true
  if (useCanvasStore.getState().lockedCardId) return true
  return isCanvasHidden(containerRef)
}

const ARROW_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 }
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

function noteAnchorPosition(
  containerRef: RefObject<HTMLElement | null>,
  lastMouseClient: { x: number; y: number } | null
): { x: number; y: number } {
  const el = containerRef.current
  if (!el || !lastMouseClient) return viewportCenter(containerRef)
  const rect = el.getBoundingClientRect()
  if (
    lastMouseClient.x < rect.left ||
    lastMouseClient.x > rect.right ||
    lastMouseClient.y < rect.top ||
    lastMouseClient.y > rect.bottom
  ) {
    return viewportCenter(containerRef)
  }
  const vp = useCanvasStore.getState().viewport
  return {
    x: (lastMouseClient.x - rect.left - vp.x) / vp.zoom,
    y: (lastMouseClient.y - rect.top - vp.y) / vp.zoom
  }
}

export function useCanvasKeyboardShortcuts({
  commandStack,
  containerRef,
  setImportOpen
}: CanvasKeyboardShortcutOptions): void {
  // Track last mouse position over the canvas container so `n` anchors the new
  // note to where the cursor actually is, not the viewport center.
  const lastMouseClientRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY }
    }
    el.addEventListener('mousemove', handler)
    return () => el.removeEventListener('mousemove', handler)
  }, [containerRef])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Hidden KeepAlive instances never handle keys (see isCanvasHidden).
      if (isCanvasHidden(containerRef)) return
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
        const { selectedEdgeId, selectedNodeIds } = useCanvasStore.getState()
        if (isEditingSurfaceActive()) return

        if (selectedEdgeId) {
          const cmd = removeEdgeCommand(selectedEdgeId)
          if (cmd) commandStack.current.execute(cmd)
        }
        if (selectedNodeIds.size > 0) {
          const cmd = removeNodesCommand([...selectedNodeIds])
          if (cmd) commandStack.current.execute(cmd)
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

      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isEditingSurfaceActive()) return
        e.preventDefault()
        const position = noteAnchorPosition(containerRef, lastMouseClientRef.current)
        void createNoteAtCursor(position)
      }

      const arrow = ARROW_DELTAS[e.key]
      if (arrow && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isSpatialShortcutBlocked(containerRef)) return
        const { selectedNodeIds } = useCanvasStore.getState()
        if (selectedNodeIds.size === 0) return
        e.preventDefault()
        const step = e.shiftKey ? SNAP_GRID_SIZE : 1
        const cmd = nudgeNodesCommand([...selectedNodeIds], arrow.dx * step, arrow.dy * step)
        if (cmd) commandStack.current.execute(cmd)
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
  }, [commandStack, containerRef])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      // Hidden KeepAlive instances never handle keys: without this gate, a
      // hidden view's ⌘Z replays ITS stack's commands into the visible canvas
      // through the active-store proxy, and the autosaver persists the damage.
      if (isCanvasHidden(containerRef)) return
      // Normalize case: with Shift held, e.key arrives uppercase ('Z', 'E'),
      // so comparing the raw key against lowercase silently kills every
      // shift-modified shortcut in this handler.
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void commandStack.current.undo()
      } else if (key === 'z' && e.shiftKey) {
        e.preventDefault()
        void commandStack.current.redo()
      } else if (key === 'g') {
        if (
          !containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body
        )
          return
        e.preventDefault()
        setImportOpen(true)
      } else if (key === 'e' && e.shiftKey) {
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
      } else if (key === 'a' && !e.shiftKey) {
        if (isSpatialShortcutBlocked(containerRef)) return
        e.preventDefault()
        const { nodes } = useCanvasStore.getState()
        useCanvasStore.getState().setSelection(new Set(nodes.map((n) => n.id)))
      } else if (key === 'd' && !e.shiftKey) {
        if (isSpatialShortcutBlocked(containerRef)) return
        const cmd = duplicateSelectionCommand()
        if (cmd) {
          e.preventDefault()
          commandStack.current.execute(cmd)
        }
      } else if (key === 'c' && !e.shiftKey) {
        // Only claim ⌘C when canvas cards are actually copied; otherwise the
        // native text copy proceeds untouched.
        if (isSpatialShortcutBlocked(containerRef)) return
        if (copySelectionToClipboard() > 0) e.preventDefault()
      } else if (key === 'v' && !e.shiftKey) {
        if (isSpatialShortcutBlocked(containerRef)) return
        const cmd = pasteClipboardCommand()
        if (cmd) {
          e.preventDefault()
          commandStack.current.execute(cmd)
        }
      } else if (key === 'l') {
        e.preventDefault()
        const center = viewportCenter(containerRef)
        if (e.shiftKey) {
          const { artifacts, graph, fileToId } = useVaultStore.getState()
          const fileToIdMap = new Map(Object.entries(fileToId))
          const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
          const cmd = layoutCommand(() =>
            useCanvasStore.getState().applySemanticLayout(center, fileToIdMap, artMap, graph.edges)
          )
          if (cmd) commandStack.current.execute(cmd)
        } else {
          const cmd = layoutCommand(() =>
            useCanvasStore.getState().applyTileLayout('grid-2x2', center)
          )
          if (cmd) commandStack.current.execute(cmd)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandStack, containerRef, setImportOpen])
}
