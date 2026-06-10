import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeType, CanvasNode } from '@shared/canvas-types'

// Mock CARD_TYPE_INFO to avoid pulling in the full module
vi.mock('@shared/canvas-types', async () => {
  const actual =
    await vi.importActual<typeof import('@shared/canvas-types')>('@shared/canvas-types')
  return {
    ...actual,
    CARD_TYPE_INFO: {
      text: { label: 'Text', icon: 'T', category: 'content', creatableFromMenu: true },
      note: { label: 'Note', icon: 'N', category: 'content', creatableFromMenu: false }
    }
  }
})

function renderMenu(overrides: Partial<React.ComponentProps<typeof CanvasContextMenu>> = {}) {
  const defaults = {
    x: 100,
    y: 200,
    onAddCard: vi.fn() as (
      type: CanvasNodeType,
      overrides?: Partial<Pick<CanvasNode, 'content' | 'metadata'>>
    ) => void,
    onClose: vi.fn()
  }
  return render(<CanvasContextMenu {...defaults} {...overrides} />)
}

// Lazy import after mock
let CanvasContextMenu: typeof import('../CanvasContextMenu').CanvasContextMenu

describe('CanvasContextMenu', () => {
  afterEach(() => {
    cleanup()
  })

  it('hides card types that are not creatable from the menu', async () => {
    const mod = await import('../CanvasContextMenu')
    CanvasContextMenu = mod.CanvasContextMenu
    renderMenu()

    expect(screen.getByText('Text')).toBeTruthy()
    expect(screen.queryByText('Note')).toBeNull()
  })
})
