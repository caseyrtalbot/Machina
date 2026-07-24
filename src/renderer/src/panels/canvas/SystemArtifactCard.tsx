import { useCallback, memo } from 'react'
import { logError } from '../../utils/error-logger'
import { CardShell } from './CardShell'
import { useCanvas, useCanvasApi } from './canvas-store-context'
import { useVaultStore } from '../../store/vault-store'
import { getArtifactColor } from '../../design/tokens'
import { openArtifactInEditor } from '../../system-artifacts/system-artifact-runtime'
import { restorePatternSnapshot } from './workbench-artifact-placement'
import type { CanvasNode } from '@shared/canvas-types'
import type { SystemArtifactKind } from '@shared/system-artifacts'

interface SystemArtifactCardProps {
  node: CanvasNode
}

const KIND_ICONS: Record<SystemArtifactKind, string> = {
  session: 'S',
  pattern: 'P',
  tension: 'T'
}

const KIND_LABELS: Record<SystemArtifactKind, string> = {
  session: 'Session',
  pattern: 'Pattern',
  tension: 'Tension'
}

function StatusPill({
  status,
  accentColor
}: {
  readonly status: string
  readonly accentColor: string
}) {
  return (
    <span
      className="te-sysart-status"
      style={{
        color: accentColor,
        backgroundColor: accentColor + '14',
        border: `1px solid ${accentColor}24`
      }}
    >
      {status}
    </span>
  )
}

function StatChip({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <span className="te-sysart-stat">
      {value} {label}
    </span>
  )
}

export function SystemArtifactCard({ node }: SystemArtifactCardProps) {
  const meta = node.metadata as {
    artifactKind?: SystemArtifactKind
    artifactId?: string
    status?: string
    filePath?: string
    summary?: string
    signal?: string
    fileRefCount?: number
    question?: string
    hasSnapshot?: boolean
    snapshotPath?: string
    commandCount?: number
    fileTouchCount?: number
  }

  const kind = meta.artifactKind ?? 'session'
  const status = meta.status ?? ''
  const summary = meta.summary ?? ''
  const filePath = meta.filePath ?? ''
  const accentColor = getArtifactColor(kind)

  const canvas = useCanvasApi()
  const removeNode = useCanvas((s) => s.removeNode)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  const handleClose = useCallback(() => {
    removeNode(node.id)
  }, [node.id, removeNode])

  const handleOpenInEditor = useCallback(() => {
    if (filePath) {
      openArtifactInEditor(filePath)
    }
  }, [filePath])

  const handleRestore = useCallback(() => {
    if (meta.snapshotPath && vaultPath) {
      restorePatternSnapshot(canvas, meta.snapshotPath, vaultPath).catch((err) =>
        logError('snapshot-restore', err)
      )
    }
  }, [meta.snapshotPath, vaultPath, canvas])

  return (
    <CardShell
      node={node}
      title={node.content || meta.artifactId || KIND_LABELS[kind]}
      onClose={handleClose}
      onOpenInEditor={filePath ? handleOpenInEditor : undefined}
    >
      <div className="te-sysart-root">
        {/* Header: kind badge + status */}
        <div className="te-sysart-header">
          <span
            className="te-sysart-kind-icon"
            style={{ backgroundColor: accentColor + '18', color: accentColor }}
          >
            {KIND_ICONS[kind]}
          </span>
          <span className="te-sysart-kind-label" style={{ color: accentColor }}>
            {KIND_LABELS[kind]}
          </span>
          {status && <StatusPill status={status} accentColor={accentColor} />}
        </div>

        {/* Summary or question */}
        {kind === 'tension' && meta.question ? (
          <p className="te-sysart-question">{meta.question}</p>
        ) : summary ? (
          <p className="te-sysart-summary">{summary}</p>
        ) : null}

        {/* Stat chips */}
        <div className="te-sysart-stats">
          {kind === 'session' && meta.fileTouchCount != null && meta.fileTouchCount > 0 && (
            <StatChip label="files" value={meta.fileTouchCount} />
          )}
          {kind === 'session' && meta.commandCount != null && meta.commandCount > 0 && (
            <StatChip label="cmds" value={meta.commandCount} />
          )}
          {meta.fileRefCount != null && meta.fileRefCount > 0 && (
            <StatChip label="refs" value={meta.fileRefCount} />
          )}
          {kind === 'pattern' && meta.hasSnapshot && (
            <button
              onClick={handleRestore}
              className="te-sysart-restore"
              style={{
                backgroundColor: accentColor + '14',
                color: accentColor,
                border: `1px solid ${accentColor}24`
              }}
              title="Restore this pattern's saved canvas layout"
            >
              Restore
            </button>
          )}
          {meta.signal && meta.signal !== 'untested' && <StatChip label="" value={meta.signal} />}
        </div>
      </div>
    </CardShell>
  )
}

export default memo(SystemArtifactCard)
