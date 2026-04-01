import { useCallback, memo } from 'react'
import { logError } from '../../utils/error-logger'
import { CardShell } from '../canvas/CardShell'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { colors, getArtifactColor, typography } from '../../design/tokens'
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
      className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
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
    <span
      className="px-1.5 py-0.5 rounded text-[10px]"
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        color: colors.text.muted,
        fontFamily: typography.fontFamily.mono
      }}
    >
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

  const removeNode = useCanvasStore((s) => s.removeNode)
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
      restorePatternSnapshot(meta.snapshotPath, vaultPath).catch((err) =>
        logError('snapshot-restore', err)
      )
    }
  }, [meta.snapshotPath, vaultPath])

  return (
    <CardShell
      node={node}
      title={node.content || meta.artifactId || KIND_LABELS[kind]}
      onClose={handleClose}
      onOpenInEditor={filePath ? handleOpenInEditor : undefined}
    >
      <div className="p-3 space-y-2">
        {/* Header: kind badge + status */}
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 flex items-center justify-center rounded text-[10px] font-bold"
            style={{
              width: 24,
              height: 24,
              backgroundColor: accentColor + '18',
              color: accentColor,
              fontFamily: typography.fontFamily.mono
            }}
          >
            {KIND_ICONS[kind]}
          </span>
          <span className="text-[11px] font-medium" style={{ color: accentColor }}>
            {KIND_LABELS[kind]}
          </span>
          {status && <StatusPill status={status} accentColor={accentColor} />}
        </div>

        {/* Summary or question */}
        {kind === 'tension' && meta.question ? (
          <p
            className="text-xs leading-relaxed line-clamp-2 italic"
            style={{ color: colors.text.secondary }}
          >
            {meta.question}
          </p>
        ) : summary ? (
          <p
            className="text-xs leading-relaxed line-clamp-2"
            style={{ color: colors.text.secondary }}
          >
            {summary}
          </p>
        ) : null}

        {/* Stat chips */}
        <div className="flex flex-wrap gap-1">
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
              className="px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors"
              style={{
                backgroundColor: accentColor + '14',
                color: accentColor,
                border: `1px solid ${accentColor}24`,
                fontFamily: typography.fontFamily.mono
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
