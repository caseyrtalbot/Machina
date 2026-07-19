import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DockTabContent } from '../DockTabContent'
import type { DockTab } from '@shared/dock-types'

/**
 * Render-dispatch half of the `kind:'terminal'` retirement (Phase 3 step 3):
 * every REMAINING DockTab kind lazily mounts its surface, and the dispatch
 * switch is exhaustive over the shrunken union (the type-level half — the
 * variant no longer compiling — is pinned in dock-store.test.ts). A terminal
 * surface can only mount via the strip or ThreadPanel's agent surface now.
 */
vi.mock('../../canvas/CanvasView', () => ({
  CanvasView: ({ canvasId }: { canvasId: string }) => (
    <div data-testid="mock-canvas">{canvasId}</div>
  )
}))
vi.mock('../dock-adapters/EditorDockAdapter', () => ({
  // The singleton editor surface takes no props — note identity lives in
  // editor-store, not on the dock tab.
  EditorDockAdapter: () => <div data-testid="mock-editor" />
}))
vi.mock('../dock-adapters/TerminalDockAdapter', () => ({
  TerminalDockAdapter: () => <div data-testid="mock-terminal" />
}))
vi.mock('../../graph/GraphViewShell', () => ({
  GraphViewShell: () => <div data-testid="mock-graph" />
}))
vi.mock('../../ghosts/GhostPanel', () => ({
  GhostPanel: () => <div data-testid="mock-ghosts" />
}))
vi.mock('../../health/HealthPanel', () => ({
  HealthPanel: () => <div data-testid="mock-health" />
}))

describe('DockTabContent render dispatch (terminal variant retired)', () => {
  const cases: ReadonlyArray<{ tab: DockTab; testId: string; content?: string }> = [
    { tab: { kind: 'canvas', id: 'c1' }, testId: 'mock-canvas', content: 'c1' },
    { tab: { kind: 'editor' }, testId: 'mock-editor' },
    { tab: { kind: 'graph' }, testId: 'mock-graph' },
    { tab: { kind: 'ghosts' }, testId: 'mock-ghosts' },
    { tab: { kind: 'health' }, testId: 'mock-health' }
  ]

  it.each(cases)('renders the $tab.kind surface', async ({ tab, testId, content }) => {
    const { unmount } = render(<DockTabContent tab={tab} />)
    const el = await screen.findByTestId(testId)
    if (content !== undefined) expect(el.textContent).toBe(content)
    // The dock never mounts a TerminalDockAdapter for any tab kind.
    expect(screen.queryByTestId('mock-terminal')).toBeNull()
    unmount()
  })
})
