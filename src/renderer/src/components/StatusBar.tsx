import { useVaultStore } from '../store/vault-store'
import { useEditorStore } from '../store/editor-store'
import { useGraphStore } from '../store/graph-store'
import { colors } from '../design/tokens'

interface EditorStatusProps {
  content: string
  cursorLine: number
  cursorCol: number
}

function EditorStatus({ content, cursorLine, cursorCol }: EditorStatusProps) {
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  return (
    <>
      <span>
        Ln {cursorLine}, Col {cursorCol}
      </span>
      <span className="mx-2">&middot;</span>
      <span>{wordCount} words</span>
      <span className="mx-2">&middot;</span>
      <span>UTF-8</span>
    </>
  )
}

interface GraphStatusProps {
  nodeCount: number
  edgeCount: number
  selectedNodeName: string | null
}

function GraphStatus({ nodeCount, edgeCount, selectedNodeName }: GraphStatusProps) {
  return (
    <>
      <span>{nodeCount} nodes</span>
      <span className="mx-2">&middot;</span>
      <span>{edgeCount} edges</span>
      {selectedNodeName && (
        <>
          <span className="mx-2">&middot;</span>
          <span>{selectedNodeName}</span>
        </>
      )}
    </>
  )
}

export function StatusBar() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const fileCount = useVaultStore((s) => s.files.length)
  const graphNodes = useVaultStore((s) => s.graph.nodes)
  const graphEdges = useVaultStore((s) => s.graph.edges)

  const content = useEditorStore((s) => s.content)
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const cursorCol = useEditorStore((s) => s.cursorCol)

  const contentView = useGraphStore((s) => s.contentView)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)

  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'

  const selectedNodeName = selectedNodeId
    ? (graphNodes.find((n) => n.id === selectedNodeId)?.title ?? null)
    : null

  return (
    <div
      className="h-6 flex items-center px-3 text-[11px] border-t flex-shrink-0"
      style={{
        backgroundColor: colors.bg.surface,
        color: colors.text.muted,
        borderColor: colors.border.default
      }}
    >
      <div className="flex items-center flex-1">
        <span>{vaultName}</span>
        <span className="mx-2">&middot;</span>
        <span>{fileCount} notes</span>
      </div>
      <div className="flex items-center">
        {contentView === 'editor' && (
          <EditorStatus content={content} cursorLine={cursorLine} cursorCol={cursorCol} />
        )}
        {contentView === 'graph' && (
          <GraphStatus
            nodeCount={graphNodes.length}
            edgeCount={graphEdges.length}
            selectedNodeName={selectedNodeName}
          />
        )}
      </div>
    </div>
  )
}
