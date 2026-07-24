import { useCallback, memo } from 'react'
import { CardShell } from './CardShell'
import { useCanvas } from './canvas-store-context'
import { colors, LANGUAGE_COLORS } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import './workbench-animations.css'

interface WorkbenchFileCardProps {
  node: CanvasNode
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

  const removeNode = useCanvas((s) => s.removeNode)

  const handleClose = useCallback(() => {
    removeNode(node.id)
  }, [node.id, removeNode])

  const fileName = relativePath.split('/').pop() ?? relativePath
  const dirPath = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : ''

  const langColor = LANGUAGE_COLORS[language] ?? colors.text.muted

  return (
    <CardShell node={node} title={fileName} onClose={handleClose}>
      <div className="te-wbfile-root workbench-file-card-enter" data-active={isActive}>
        {/* Language icon */}
        <div
          className="te-wbfile-icon"
          style={{ backgroundColor: langColor + '18', color: langColor }}
        >
          {getFileIcon(language)}
        </div>

        {/* File info */}
        <div className="te-wbfile-info">
          <div className="te-wbfile-name" title={relativePath}>
            {fileName}
          </div>
          {dirPath && <div className="te-wbfile-dir">{dirPath}</div>}
        </div>

        {/* Touch count badge */}
        {touchCount > 0 && (
          <div className="te-wbfile-touch" data-hot={touchCount >= 5}>
            {touchCount}
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default memo(WorkbenchFileCard)
