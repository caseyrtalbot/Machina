import { lazy, Suspense } from 'react'
import { LoadingState } from '../../components/emptystate/LoadingState'
import type { DockTab } from '@shared/dock-types'

const LazyCanvasView = lazy(() =>
  import('../canvas/CanvasView').then((m) => ({ default: m.CanvasView }))
)
const LazyEditorAdapter = lazy(() =>
  import('./dock-adapters/EditorDockAdapter').then((m) => ({ default: m.EditorDockAdapter }))
)
const LazyGraph = lazy(() =>
  import('../graph/GraphViewShell').then((m) => ({ default: m.GraphViewShell }))
)
const LazyGhosts = lazy(() =>
  import('../ghosts/GhostPanel').then((m) => ({ default: m.GhostPanel }))
)
const LazyHealth = lazy(() =>
  import('../health/HealthPanel').then((m) => ({ default: m.HealthPanel }))
)

export function DockTabContent({ tab }: { readonly tab: DockTab }) {
  return (
    <Suspense fallback={<LoadingState label={`loading ${tab.kind}…`} padding={24} />}>
      {renderTab(tab)}
    </Suspense>
  )
}

function renderTab(tab: DockTab) {
  switch (tab.kind) {
    case 'canvas':
      return <LazyCanvasView canvasId={tab.id} />
    case 'editor':
      return <LazyEditorAdapter />
    case 'graph':
      return <LazyGraph />
    case 'ghosts':
      return <LazyGhosts />
    case 'health':
      return <LazyHealth />
  }
}
