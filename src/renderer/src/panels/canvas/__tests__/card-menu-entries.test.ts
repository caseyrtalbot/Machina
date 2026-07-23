import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuEntry, ContextMenuItem } from '../../../components/ContextMenu'
import { cardMenuEntries } from '../card-menu-entries'

const isItem = (e: ContextMenuEntry): e is ContextMenuItem =>
  e.kind === undefined || e.kind === 'item'

const baseHandlers = {
  onShowConnections: vi.fn(),
  onOpenInEditor: vi.fn(),
  onCopyPath: vi.fn()
}

function labelsOf(entries: ReturnType<typeof cardMenuEntries>): string[] {
  return entries.filter(isItem).map((e) => e.label)
}

describe('cardMenuEntries', () => {
  it('renders live card actions without the removed Claude action', () => {
    const labels = labelsOf(cardMenuEntries(baseHandlers))
    expect(labels).toContain('Show Connections')
    expect(labels).toContain('Open in Editor')
    expect(labels).toContain('Copy Path')
    expect(labels).not.toContain('Run Claude on this note')
  })

  it('wires each item to its handler', () => {
    const onShowConnections = vi.fn()
    const onCopyPath = vi.fn()
    const entries = cardMenuEntries({ ...baseHandlers, onShowConnections, onCopyPath })

    for (const [id, handler] of [
      ['show-connections', onShowConnections],
      ['copy-path', onCopyPath]
    ] as const) {
      const entry = entries.find((e) => e.id === id)
      if (!entry || !isItem(entry)) throw new Error(`${id} missing`)
      entry.onSelect()
      expect(handler).toHaveBeenCalledOnce()
    }
  })

  it('renders optional actions only when their handlers are provided', () => {
    const withoutOptional = labelsOf(
      cardMenuEntries({ ...baseHandlers, onOpenInEditor: undefined })
    )
    expect(withoutOptional).not.toContain('Open in Editor')
    expect(withoutOptional).not.toContain('Save as new note')

    const withText = labelsOf(
      cardMenuEntries({ ...baseHandlers, onQuickSaveText: vi.fn(), onSaveTextAs: vi.fn() })
    )
    expect(withText).toContain('Save as new note')
    expect(withText).toContain('Save to...')
  })
})
