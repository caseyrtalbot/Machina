import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TextCard from '../TextCard'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../../store/canvas-store'
import { CanvasStoreProvider } from '../canvas-store-context'
import { hashContent } from '../text-card-save'

beforeEach(() => {
  globalThis.window = globalThis.window ?? ({} as Window & typeof globalThis)
  // @ts-expect-error test stub
  window.api = { fs: { mkdir: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn() } }
  getCanvasStore(DEFAULT_CANVAS_ID).setState({ nodes: [] } as never)
})

function renderTextCard(node: Parameters<typeof TextCard>[0]['node']) {
  return render(
    <CanvasStoreProvider canvasId={DEFAULT_CANVAS_ID}>
      <TextCard node={node} />
    </CanvasStoreProvider>
  )
}

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
    renderTextCard(baseNode)
    const editable = document.querySelector('[contenteditable]') as HTMLElement
    expect(editable).toBeTruthy()
    expect(editable.getAttribute('contenteditable')).toBe('false')
  })

  it('renders SavedToBadge when content hash matches savedContentHash', () => {
    const node = {
      ...baseNode,
      metadata: { savedToPath: 'Inbox/hello.md', savedContentHash: hashContent('hello') }
    }
    renderTextCard(node)
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
    renderTextCard(node)
    expect(screen.queryByTitle(/open inbox\/hello\.md/i)).toBeNull()
  })

  it('renders the header save button', () => {
    renderTextCard(baseNode)
    expect(screen.queryByTestId('text-card-save-button')).toBeTruthy()
  })
})
