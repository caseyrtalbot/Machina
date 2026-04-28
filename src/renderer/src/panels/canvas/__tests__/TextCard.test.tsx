import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TextCard from '../TextCard'
import { useCanvasStore } from '../../../store/canvas-store'
import { hashContent } from '../text-card-save'

beforeEach(() => {
  globalThis.window = globalThis.window ?? ({} as Window & typeof globalThis)
  // @ts-expect-error test stub
  window.api = { fs: { mkdir: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn() } }
  useCanvasStore.setState({ nodes: [] } as never)
})

const baseNode = {
  id: 't1',
  type: 'text' as const,
  position: { x: 0, y: 0 },
  size: { width: 240, height: 120 },
  content: 'hello',
  metadata: {}
}

describe('TextCard', () => {
  it('renders a contenteditable surface (read-only by default)', () => {
    render(<TextCard node={baseNode} />)
    const editable = document.querySelector('[contenteditable]') as HTMLElement
    expect(editable).toBeTruthy()
    expect(editable.getAttribute('contenteditable')).toBe('false')
  })

  it('renders SavedToBadge when content hash matches savedContentHash', () => {
    const node = {
      ...baseNode,
      metadata: { savedToPath: 'Inbox/hello.md', savedContentHash: hashContent('hello') }
    }
    render(<TextCard node={node} />)
    const badge = screen.queryByTitle(/open inbox\/hello\.md/i)
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toContain('Inbox/hello.md')
  })

  it('hides SavedToBadge when content hash does not match savedContentHash', () => {
    const node = {
      ...baseNode,
      content: 'edited content',
      metadata: { savedToPath: 'Inbox/hello.md', savedContentHash: 'stale-hash-value' }
    }
    render(<TextCard node={node} />)
    expect(screen.queryByTitle(/open inbox\/hello\.md/i)).toBeNull()
  })

  it('renders the header save button', () => {
    render(<TextCard node={baseNode} />)
    expect(screen.queryByTestId('text-card-save-button')).toBeTruthy()
  })
})
