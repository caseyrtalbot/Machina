import { useState, useCallback, memo, useMemo } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useEditorStore } from '../../store/editor-store'
import { CardShell } from './CardShell'
import { RichTextCardEditor } from './RichTextCardEditor'
import { SavedToBadge } from './SavedToBadge'
import { ClusterCaptureButton } from './ClusterCaptureButton'
import { useSaveTextCard } from './useSaveTextCard'
import { hashContent } from './text-card-save'
import { useCommandStack } from './command-stack-context'
import { captureClusterFromRoot } from './cluster-capture-handler'
import type { CanvasNode } from '@shared/canvas-types'

interface TextCardProps {
  readonly node: CanvasNode
}

function TextCardImpl({ node }: TextCardProps) {
  const [editing, setEditing] = useState(false)
  const [committedContent, setCommittedContent] = useState(node.content)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const openInEditor = useEditorStore((s) => s.setActiveNote)
  const commandStack = useCommandStack()
  const edges = useCanvasStore((s) => s.edges)
  const allNodes = useCanvasStore((s) => s.nodes)

  const clusterId = typeof node.metadata.cluster_id === 'string' ? node.metadata.cluster_id : null
  const clusterHasMembers = useMemo(() => {
    if (!clusterId) return false
    return edges.some(
      (e) =>
        (e.fromNode === node.id && allNodes.some((n) => n.id === e.toNode)) ||
        (e.toNode === node.id && allNodes.some((n) => n.id === e.fromNode))
    )
  }, [clusterId, edges, allNodes, node.id])

  const handleCaptureCluster = useCallback(async () => {
    if (!commandStack) return
    setErrorMsg(null)
    const r = await captureClusterFromRoot(node.id, allNodes, edges, commandStack)
    if (!r.ok) {
      setErrorMsg(r.reason)
      window.setTimeout(() => setErrorMsg(null), 4000)
    }
  }, [commandStack, node.id, allNodes, edges])

  const { saveQuick } = useSaveTextCard()

  const savedToPath =
    typeof node.metadata.savedToPath === 'string' ? node.metadata.savedToPath : null
  const savedHash =
    typeof node.metadata.savedContentHash === 'string' ? node.metadata.savedContentHash : null
  const currentHash = useMemo(() => hashContent(node.content), [node.content])
  const showBadge = savedToPath !== null && savedHash === currentHash

  const handleChange = useCallback(
    (markdown: string) => {
      updateContent(node.id, markdown)
    },
    [node.id, updateContent]
  )

  const handleExit = useCallback(
    (commit: boolean) => {
      setEditing(false)
      if (commit) setCommittedContent(node.content)
      else updateContent(node.id, committedContent)
    },
    [node.id, node.content, committedContent, updateContent]
  )

  const handleSaveShortcut = useCallback(async () => {
    setErrorMsg(null)
    const r = await saveQuick(node.id)
    if (!r.ok) {
      setErrorMsg(r.error)
      window.setTimeout(() => setErrorMsg(null), 4000)
    }
  }, [node.id, saveQuick])

  const handleHeaderSaveClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      await handleSaveShortcut()
    },
    [handleSaveShortcut]
  )

  const handleBadgeOpen = useCallback(() => {
    if (savedToPath) openInEditor(savedToPath)
  }, [savedToPath, openInEditor])

  const headerActions = (
    <div className="flex items-center gap-1">
      <ClusterCaptureButton
        clusterId={clusterId}
        hasMembers={clusterHasMembers}
        onCapture={handleCaptureCluster}
      />
      <button
        type="button"
        onClick={handleHeaderSaveClick}
        title="Save to vault (Cmd+Shift+S)"
        className="text-xs px-1"
        style={{ opacity: 0.7, cursor: 'pointer' }}
        data-testid="text-card-save-button"
      >
        ⤓
      </button>
    </div>
  )

  const title =
    node.content
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.slice(0, 30) || 'Text'

  return (
    <CardShell
      node={node}
      title={title}
      onClose={() => removeNode(node.id)}
      headerActions={headerActions}
    >
      <div
        className="flex flex-col h-full"
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
      >
        <div className="flex-1 min-h-0">
          <RichTextCardEditor
            value={node.content}
            editing={editing}
            onChange={handleChange}
            onExit={handleExit}
            onSaveShortcut={handleSaveShortcut}
          />
        </div>
        <div className="px-2 pb-1 flex items-center justify-between gap-2 min-h-[18px]">
          {showBadge && savedToPath ? (
            <SavedToBadge relativePath={savedToPath} onOpen={handleBadgeOpen} />
          ) : (
            <span />
          )}
          {errorMsg && (
            <span className="text-[10px]" style={{ color: '#c44' }} role="alert">
              {errorMsg}
            </span>
          )}
        </div>
      </div>
    </CardShell>
  )
}

export const TextCard = memo(TextCardImpl)
export default TextCard
