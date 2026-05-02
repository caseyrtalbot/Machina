// Parking lot for Task 7.3 — helpers that the agent shell will rewire when
// the workbench/canvas/graph/ghosts/health surfaces gain native agent-shell
// entrypoints. None of these are mounted today; they are kept here so the
// next phase can re-import them by name without re-deriving the wiring.
//
// This file intentionally lives outside `App.tsx` so the legacy panel imports
// and Zustand selectors do not bloat the active app shell. The mixed
// component/helper exports are intentional for the parking-lot lifetime;
// fast-refresh is irrelevant for code that is not mounted.
/* eslint-disable react-refresh/only-export-components */

import { lazy, Suspense, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { logError } from './utils/error-logger'
import { colors } from './design/tokens'
import { EditorSplitView } from './panels/editor/EditorSplitView'
import { useTabStore } from './store/tab-store'
import type { TabType } from './store/tab-store'
import { useEditorStore } from './store/editor-store'
import { useVaultStore } from './store/vault-store'
import type { SystemArtifactListItem } from './panels/sidebar/Sidebar'

const LazyCanvasView = lazy(() =>
  import('./panels/canvas/CanvasView').then((module) => ({ default: module.CanvasView }))
)

const LazyWorkbenchPanel = lazy(() =>
  import('./panels/workbench/WorkbenchPanel').then((module) => ({
    default: module.WorkbenchPanel
  }))
)
const LazyGraphPanel = lazy(() =>
  import('./panels/graph/GraphViewShell').then((module) => ({ default: module.GraphViewShell }))
)
const LazyGhostPanel = lazy(() =>
  import('./panels/ghosts/GhostPanel').then((module) => ({ default: module.GhostPanel }))
)
const LazyHealthPanel = lazy(() =>
  import('./panels/health/HealthPanel').then((module) => ({ default: module.HealthPanel }))
)

export async function openArtifactInEditorOnDemand(path: string, title?: string): Promise<void> {
  const { openArtifactInEditor } = await import('./system-artifacts/system-artifact-runtime')
  openArtifactInEditor(path, title)
}

export async function placeSystemArtifactOnWorkbench(
  item: SystemArtifactListItem,
  vaultPath: string | null
): Promise<void> {
  const { placeArtifactOnWorkbench, enrichPlacedArtifact } =
    await import('./panels/workbench/workbench-artifact-placement')
  const nodeId = placeArtifactOnWorkbench(item)
  if (nodeId && vaultPath) {
    void enrichPlacedArtifact(nodeId, item, vaultPath).catch((err) =>
      logError('enrich-artifact', err)
    )
  }
}

/** Wrapper that keeps its children mounted but hidden when inactive. */
export function KeepAliveSlot({
  active,
  children
}: {
  readonly active: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div className="h-full w-full" style={{ display: active ? 'contents' : 'none' }}>
      {children}
    </div>
  )
}

function PanelLoadingFallback({ label }: { readonly label: string }) {
  return (
    <div
      className="h-full w-full flex items-center justify-center"
      style={{ color: colors.text.muted }}
    >
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ContentArea() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeType = activeTab?.type ?? 'editor'
  const setActiveNote = useEditorStore((s) => s.setActiveNote)

  const openTypes = useMemo(() => new Set(tabs.map((t) => t.type)), [tabs])
  const [mountedTypes, setMountedTypes] = useState<ReadonlySet<TabType>>(
    () => new Set([activeType])
  )

  useEffect(() => {
    startTransition(() => {
      setMountedTypes((prev) => {
        if (prev.has(activeType)) return prev
        const next = new Set(prev)
        next.add(activeType)
        return next
      })
    })
  }, [activeType])

  const handleNavigate = useCallback(
    (id: string) => {
      // Resolve artifact ID to file path via the vault's fileToId reverse lookup.
      const fileToId = useVaultStore.getState().fileToId
      const path = Object.entries(fileToId).find(([, v]) => v === id)?.[0] ?? null
      setActiveNote(path)
    },
    [setActiveNote]
  )

  return (
    <div className="h-full overflow-hidden">
      {openTypes.has('editor') && (
        <KeepAliveSlot active={activeType === 'editor'}>
          <EditorSplitView onNavigate={handleNavigate} />
        </KeepAliveSlot>
      )}
      {openTypes.has('canvas') && mountedTypes.has('canvas') && (
        <KeepAliveSlot active={activeType === 'canvas'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading vault canvas..." />}>
            <LazyCanvasView />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('workbench') && mountedTypes.has('workbench') && (
        <KeepAliveSlot active={activeType === 'workbench'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading workbench..." />}>
            <LazyWorkbenchPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('graph') && mountedTypes.has('graph') && (
        <KeepAliveSlot active={activeType === 'graph'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading graph..." />}>
            <LazyGraphPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('ghosts') && mountedTypes.has('ghosts') && (
        <KeepAliveSlot active={activeType === 'ghosts'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading ghosts..." />}>
            <LazyGhostPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('health') && mountedTypes.has('health') && (
        <KeepAliveSlot active={activeType === 'health'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading health..." />}>
            <LazyHealthPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
    </div>
  )
}
