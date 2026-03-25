import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasFile, createCanvasNode } from '@shared/canvas-types'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useWorkbenchStore } from '../../store/workbench-store'
import { useTabStore } from '../../store/tab-store'
import { useWorkbenchActionStore } from '../../store/workbench-actions-store'
import type { ElectronApi } from '../../../../preload/index'

vi.mock('../canvas/CanvasSurface', () => ({
  CanvasSurface: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workbench-surface">{children}</div>
  )
}))

vi.mock('../canvas/CanvasMinimap', () => ({
  CanvasMinimap: () => null
}))

vi.mock('../canvas/EdgeLayer', () => ({
  EdgeLayer: () => null
}))

vi.mock('../canvas/CardShellSkeleton', () => ({
  CardShellSkeleton: () => null
}))

vi.mock('../canvas/CardLodPreview', () => ({
  CardLodPreview: () => null
}))

vi.mock('../canvas/card-registry', () => ({
  LazyCards: {}
}))

vi.mock('../canvas/use-canvas-culling', () => ({
  useViewportCulling: <T,>(nodes: readonly T[]) => nodes
}))

vi.mock('../canvas/use-canvas-lod', () => ({
  getLodLevel: () => 'full'
}))

vi.mock('../../hooks/useProjectActivity', () => ({
  useProjectActivity: vi.fn()
}))

vi.mock('../../hooks/useSessionThread', () => ({
  useSessionThread: vi.fn(() => ({
    milestones: [],
    expandedIds: new Set<string>(),
    isLive: false,
    toggle: vi.fn(),
    clear: vi.fn()
  }))
}))

vi.mock('./SessionThreadPanel', () => ({
  SessionThreadPanel: () => null
}))

vi.mock('./workbench-layout', () => ({
  layoutWorkbench: vi.fn(() => ({ nodes: [], labels: [] }))
}))

vi.mock('./workbench-migration', () => ({
  migrateWorkbenchFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../canvas/canvas-io', () => ({
  saveCanvas: vi.fn().mockResolvedValue(undefined),
  serializeCanvas: vi.fn(() => '{}')
}))

vi.mock('../../system-artifacts/system-artifact-runtime', () => ({
  createAndOpenSystemArtifact: vi.fn(),
  openArtifactInEditor: vi.fn()
}))

import { WorkbenchPanel } from './WorkbenchPanel'
import { saveCanvas } from '../canvas/canvas-io'

const parseSessions = vi.fn(async () => [])
const watchStart = vi.fn(async () => undefined)
const watchStop = vi.fn(async () => undefined)
const fileExists = vi.fn(async () => false)

class ResizeObserverMock {
  observe(): void {
    return undefined
  }

  disconnect(): void {
    return undefined
  }
}

describe('WorkbenchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    useVaultStore.setState({
      vaultPath: '/vault',
      config: null,
      state: null,
      files: [],
      systemFiles: [],
      artifacts: [],
      graph: { nodes: [], edges: [] },
      parseErrors: [],
      fileToId: {},
      artifactPathById: {},
      discoveredTypes: [],
      activeWorkspace: null,
      isLoading: false
    })

    useWorkbenchStore.setState({
      cachedData: null,
      canvasPath: '',
      projectPath: null
    })

    useWorkbenchActionStore.getState().reset()

    useTabStore.setState({
      tabs: [
        { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
        { id: 'canvas', type: 'canvas', label: 'Vault Canvas', closeable: true },
        { id: 'workbench', type: 'workbench', label: 'Workbench', closeable: true }
      ],
      activeTabId: 'workbench'
    })

    useCanvasStore.getState().loadCanvas('/vault/Untitled.canvas', {
      ...createCanvasFile(),
      nodes: [createCanvasNode('text', { x: 12, y: 24 })]
    })
    ;(window as { api: ElectronApi }).api = {
      fs: {
        fileExists
      },
      workbench: {
        parseSessions,
        watchStart,
        watchStop
      },
      on: {
        sessionDetected: () => () => {}
      }
    } as unknown as ElectronApi
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('restores the vault canvas when the workbench tab becomes inactive', async () => {
    render(<WorkbenchPanel />)

    await waitFor(() => {
      expect(useCanvasStore.getState().filePath).toBe('/vault/.machina-workbench.json')
    })
    expect(parseSessions).toHaveBeenCalledTimes(1)
    expect(watchStart).toHaveBeenCalledWith('/vault')

    act(() => {
      useTabStore.setState({ activeTabId: 'canvas' })
    })

    await waitFor(() => {
      expect(useCanvasStore.getState().filePath).toBe('/vault/Untitled.canvas')
    })
    expect(watchStop).toHaveBeenCalledTimes(1)
    expect(saveCanvas).toHaveBeenCalledWith('/vault/.machina-workbench.json', expect.any(Object))

    act(() => {
      useTabStore.setState({ activeTabId: 'workbench' })
    })

    await waitFor(() => {
      expect(useCanvasStore.getState().filePath).toBe('/vault/.machina-workbench.json')
    })
    expect(parseSessions).toHaveBeenCalledTimes(1)
    expect(watchStart).toHaveBeenCalledTimes(2)
  })
})
