import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuEntry, ContextMenuItem } from '../../../components/ContextMenu'

const isItem = (e: ContextMenuEntry): e is ContextMenuItem =>
  e.kind === undefined || e.kind === 'item'

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

describe('canvasAddCardEntries', () => {
  it('hides card types that are not creatable from the menu', async () => {
    const { canvasAddCardEntries } = await import('../canvas-menu-entries')
    const entries = canvasAddCardEntries(vi.fn())

    const labels = entries.filter(isItem).map((e) => e.label)
    expect(labels).toContain('Text')
    expect(labels).not.toContain('Note')
  })

  it('groups creatable types under a section header', async () => {
    const { canvasAddCardEntries } = await import('../canvas-menu-entries')
    const entries = canvasAddCardEntries(vi.fn())

    expect(entries[0]).toMatchObject({ kind: 'header', label: 'Content' })
  })

  it('adds plain card types directly through onAddCard', async () => {
    const { canvasAddCardEntries } = await import('../canvas-menu-entries')
    const onAddCard = vi.fn()
    const entries = canvasAddCardEntries(onAddCard)

    const text = entries.find((e) => e.id === 'text')
    if (!text || !isItem(text)) throw new Error('text entry missing')
    text.onSelect()
    expect(onAddCard).toHaveBeenCalledWith('text')
  })
})
