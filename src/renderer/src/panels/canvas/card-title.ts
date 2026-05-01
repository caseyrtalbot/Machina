import type { CanvasNode } from '@shared/canvas-types'
import type { Artifact } from '@shared/types'

export function getCanvasNodeTitle(
  node: CanvasNode,
  artifacts?: readonly Artifact[],
  fileToId?: Readonly<Record<string, string>>
): string {
  switch (node.type) {
    case 'note': {
      if (!fileToId || !artifacts) {
        return node.content?.split('/').pop()?.replace('.md', '') || 'Note'
      }
      const id = fileToId[node.content]
      const artifact = id ? artifacts.find((a) => a.id === id) : undefined
      return (artifact?.title ?? node.content?.split('/').pop()?.replace('.md', '')) || 'Note'
    }
    case 'terminal':
      if (node.metadata?.actionName) return String(node.metadata.actionName)
      return node.metadata?.initialCommand === 'claude' ? 'Claude Live' : 'Terminal'
    case 'text':
      return (
        String(node.content || '')
          .split('\n')[0]
          ?.slice(0, 30) || 'Text'
      )
    case 'code':
      return String(node.metadata?.filename ?? '') || 'Code'
    case 'markdown':
      return (
        String(node.content || '')
          .split('\n')[0]
          ?.replace(/^#+\s*/, '')
          .slice(0, 30) || 'Markdown'
      )
    case 'image':
      return String(node.metadata?.alt ?? '') || 'Image'
    case 'pdf':
      return (
        String(node.metadata?.src ?? '')
          .split('/')
          .pop() || 'PDF'
      )
    case 'project-file':
      return String(node.metadata?.relativePath ?? node.content ?? '') || 'File'
    case 'file-view':
      return node.content?.split('/').pop() || 'File View'
    case 'system-artifact':
      return String(node.metadata?.title ?? '') || 'System Artifact'
    case 'terminal-block': {
      const cmd = String(node.metadata?.command ?? '').trim()
      return cmd.length > 0 ? cmd.slice(0, 40) : 'Block'
    }
    default: {
      const type: string = node.type
      return type.charAt(0).toUpperCase() + type.slice(1)
    }
  }
}
