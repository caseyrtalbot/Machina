import { lazy, Suspense } from 'react'
import type { DockTab } from '@shared/dock-types'
import { colors, typography } from '../../design/tokens'

const LazyCanvasView = lazy(() =>
  import('../canvas/CanvasView').then((m) => ({ default: m.CanvasView }))
)
const LazyEditorAdapter = lazy(() =>
  import('./dock-adapters/EditorDockAdapter').then((m) => ({ default: m.EditorDockAdapter }))
)
const LazyTerminalAdapter = lazy(() =>
  import('./dock-adapters/TerminalDockAdapter').then((m) => ({ default: m.TerminalDockAdapter }))
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
    <Suspense
      fallback={
        <div
          style={{
            padding: 24,
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform
          }}
        >
          loading {tab.kind}…
        </div>
      }
    >
      {renderTab(tab)}
    </Suspense>
  )
}

function renderTab(tab: DockTab) {
  switch (tab.kind) {
    case 'canvas':
      return <LazyCanvasView canvasId={tab.id} />
    case 'editor':
      return <LazyEditorAdapter initialPath={tab.path} />
    case 'terminal':
      return <LazyTerminalAdapter sessionId={tab.sessionId} />
    case 'graph':
      return <LazyGraph />
    case 'ghosts':
      return <LazyGhosts />
    case 'health':
      return <LazyHealth />
  }
}
