import { useCanvasStore } from '../../store/canvas-store'

type FsReader = (path: string) => Promise<string>

const defaultFsReader: FsReader = (path) => window.api.fs.readFile(path)

/**
 * Load a pattern's saved canvas snapshot and merge its nodes/edges
 * into the current canvas. Used by SystemArtifactCard's restore action.
 */
export async function restorePatternSnapshot(
  snapshotPath: string,
  vaultPath: string,
  reader: FsReader = defaultFsReader
): Promise<void> {
  if (!snapshotPath) return

  const absolutePath = vaultPath + '/' + snapshotPath

  let content: string
  try {
    content = await reader(absolutePath)
  } catch {
    return
  }

  const { deserializeCanvas } = await import('../canvas/canvas-io')
  const snapshot = deserializeCanvas(content)

  if (snapshot.nodes.length === 0 && snapshot.edges.length === 0) return

  const store = useCanvasStore.getState()
  const existingNodeIds = new Set(store.nodes.map((n) => n.id))
  const existingEdgeIds = new Set(store.edges.map((e) => e.id))

  const newNodes = snapshot.nodes.filter((n) => !existingNodeIds.has(n.id))
  const newEdges = snapshot.edges.filter((e) => !existingEdgeIds.has(e.id))

  if (newNodes.length === 0 && newEdges.length === 0) return

  useCanvasStore.getState().addNodesAndEdges(newNodes, newEdges)
}
