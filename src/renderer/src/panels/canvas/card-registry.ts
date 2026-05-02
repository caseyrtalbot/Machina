import { lazy, type ComponentType } from 'react'
import type { CanvasNode, CanvasNodeType } from '@shared/canvas-types'

interface CardProps {
  node: CanvasNode
}

export const LazyCards: Record<
  CanvasNodeType,
  React.LazyExoticComponent<ComponentType<CardProps>>
> = {
  text: lazy(() => import('./TextCard')),
  note: lazy(() => import('./NoteCard')),
  terminal: lazy(() => import('./TerminalCard')),
  code: lazy(() => import('./CodeCard')),
  markdown: lazy(() => import('./MarkdownCard')),
  image: lazy(() => import('./ImageCard')),
  pdf: lazy(() => import('./PdfCard')),
  'project-file': lazy(() => import('../../panels/workbench/WorkbenchFileCard')),
  'system-artifact': lazy(() => import('../../panels/workbench/SystemArtifactCard')),
  'file-view': lazy(() => import('./FileViewCard')),
  'project-folder': lazy(() => import('./ProjectFolderCard')),
  'terminal-block': lazy(() => import('./BlockCard'))
}
