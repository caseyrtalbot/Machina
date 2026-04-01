import { useCallback, memo } from 'react'
import { CardShell } from '../canvas/CardShell'
import { useCanvasStore } from '../../store/canvas-store'
import { colors, typography } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import './workbench-animations.css'

interface WorkbenchFileCardProps {
  node: CanvasNode
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  typescriptreact: '#3178c6',
  javascript: '#f7df1e',
  javascriptreact: '#61dafb',
  json: '#e6a817',
  css: '#a855f7',
  html: '#e34f26',
  markdown: '#94a3b8',
  python: '#3776ab',
  rust: '#dea584',
  go: '#00add8',
  shell: '#94e2d5'
}

function getFileIcon(language: string): string {
  const icons: Record<string, string> = {
    typescript: 'TS',
    typescriptreact: 'TX',
    javascript: 'JS',
    javascriptreact: 'JX',
    json: '{}',
    css: '#',
    html: '<>',
    markdown: 'MD',
    python: 'PY',
    rust: 'RS',
    go: 'GO',
    shell: 'SH'
  }
  return icons[language] ?? language.slice(0, 2).toUpperCase()
}

export function WorkbenchFileCard({ node }: WorkbenchFileCardProps) {
  const meta = node.metadata
  const relativePath = (meta?.relativePath as string) ?? node.content
  const language = (meta?.language as string) ?? 'unknown'
  const touchCount = (meta?.touchCount as number) ?? 0
  const isActive = meta?.isActive === true

  const removeNode = useCanvasStore((s) => s.removeNode)

  const handleClose = useCallback(() => {
    removeNode(node.id)
  }, [node.id, removeNode])

  const fileName = relativePath.split('/').pop() ?? relativePath
  const dirPath = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : ''

  const langColor = LANGUAGE_COLORS[language] ?? colors.text.muted

  return (
    <CardShell node={node} title={fileName} onClose={handleClose}>
      <div
        className="flex items-center gap-2 px-2.5 py-2 h-full workbench-file-card-enter"
        style={{
          boxShadow: isActive ? `0 0 12px 2px ${langColor}44` : undefined,
          transition: 'box-shadow 300ms ease'
        }}
      >
        {/* Language icon */}
        <div
          className="shrink-0 flex items-center justify-center rounded text-[10px] font-bold"
          style={{
            width: 28,
            height: 28,
            backgroundColor: langColor + '18',
            color: langColor,
            fontFamily: typography.fontFamily.mono
          }}
        >
          {getFileIcon(language)}
        </div>

        {/* File info */}
        <div className="min-w-0 flex-1">
          <div
            className="text-xs font-semibold truncate"
            style={{ color: colors.text.primary }}
            title={relativePath}
          >
            {fileName}
          </div>
          {dirPath && (
            <div className="text-[10px] truncate mt-0.5" style={{ color: colors.text.muted }}>
              {dirPath}
            </div>
          )}
        </div>

        {/* Touch count badge */}
        {touchCount > 0 && (
          <div
            className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold"
            style={{
              minWidth: 20,
              height: 20,
              padding: '0 5px',
              backgroundColor: colors.bg.elevated,
              color: touchCount >= 5 ? colors.accent.default : colors.text.secondary,
              fontFamily: typography.fontFamily.mono
            }}
          >
            {touchCount}
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default memo(WorkbenchFileCard)
