import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { getCanvasStore, type CanvasStore, type CanvasStoreApi } from '../../store/canvas-store'

/**
 * Per-canvas store binding (Phase 1 step 1: replaces the active-canvas proxy).
 * CanvasView provides its canvasId here; everything rendered under it reads
 * THIS canvas's store — never "the canvas the user last looked at". Code
 * outside the canvas tree must resolve an explicit canvas (see
 * `getFocusedCanvasId` in dock-store) or disable itself.
 */
interface CanvasContextValue {
  readonly canvasId: string
  readonly store: CanvasStoreApi
}

const CanvasStoreContext = createContext<CanvasContextValue | null>(null)

export function CanvasStoreProvider({
  canvasId,
  children
}: {
  readonly canvasId: string
  readonly children?: ReactNode
}): React.ReactElement {
  const value = useMemo(() => ({ canvasId, store: getCanvasStore(canvasId) }), [canvasId])
  return <CanvasStoreContext.Provider value={value}>{children}</CanvasStoreContext.Provider>
}

function useCanvasCtx(): CanvasContextValue {
  const ctx = useContext(CanvasStoreContext)
  if (!ctx) throw new Error('canvas hooks require a <CanvasStoreProvider> ancestor')
  return ctx
}

/** Reactive selector against this canvas's store (replaces `useCanvasStore(sel)`). */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its hooks are one unit
export function useCanvas<T>(selector: (state: CanvasStore) => T): T {
  return useStore(useCanvasCtx().store, selector)
}

/** Imperative handle for callbacks (replaces `useCanvasStore.getState()` chains). */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its hooks are one unit
export function useCanvasApi(): CanvasStoreApi {
  return useCanvasCtx().store
}

// eslint-disable-next-line react-refresh/only-export-components -- provider + its hooks are one unit
export function useCanvasId(): string {
  return useCanvasCtx().canvasId
}
