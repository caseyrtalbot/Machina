import { memo } from 'react'
import type { CanvasNode } from '@shared/canvas-types'
import { useCanvas } from './canvas-store-context'
import { CardShell } from './CardShell'

interface ProjectFolderCardProps {
  readonly node: CanvasNode
}

function lastPathSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? null
}

function ProjectFolderCard({ node }: ProjectFolderCardProps) {
  const removeNode = useCanvas((s) => s.removeNode)

  const { relativePath, childCount } = node.metadata as {
    relativePath?: string
    childCount?: number
  }

  const folderName =
    relativePath === '.'
      ? (lastPathSegment(node.metadata.rootPath) ?? 'Root')
      : (lastPathSegment(relativePath) ?? 'Folder')

  return (
    <CardShell node={node} title={folderName} onClose={() => removeNode(node.id)}>
      <div className="te-folder-root">
        <div className="te-folder-row">
          <span data-testid="folder-icon" className="te-folder-icon">
            {'\u{1F4C2}'}
          </span>
          <span data-testid="folder-name" className="te-folder-name">
            {folderName}
          </span>
          {typeof childCount === 'number' && childCount > 0 && (
            <span data-testid="folder-child-count" className="te-folder-count">
              {childCount}
            </span>
          )}
        </div>
        {relativePath && relativePath !== '.' && (
          <div data-testid="folder-path" className="te-folder-path">
            {relativePath}
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default memo(ProjectFolderCard)
