import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuEntry, ContextMenuItem } from '../../../components/ContextMenu'
import { fileMenuEntries } from '../file-menu-entries'

const isItem = (e: ContextMenuEntry): e is ContextMenuItem =>
  e.kind === undefined || e.kind === 'item'

const baseCtx = {
  path: 'notes/a.md',
  isDirectory: false,
  isBookmarked: false,
  isMultiSelect: false,
  selectionCount: 0,
  isAgentModified: false,
  onAction: () => {}
}

function labelsOf(entries: ReturnType<typeof fileMenuEntries>): string[] {
  return entries.filter(isItem).map((e) => e.label)
}

describe('fileMenuEntries', () => {
  it('builds file actions with shortcut labels', () => {
    const entries = fileMenuEntries(baseCtx)
    const labels = labelsOf(entries)
    expect(labels).toContain('Bookmark')
    expect(labels).toContain('Open in Split')
    expect(labels).toContain('Delete')
    const openSplit = entries.find((e) => e.id === 'open-split')
    if (!openSplit || openSplit.kind !== undefined) throw new Error('open-split missing')
    expect(openSplit.shortcut).toBe('⌘\\')
  })

  it('invokes onAction with the action id and path', () => {
    const onAction = vi.fn()
    const entries = fileMenuEntries({ ...baseCtx, onAction })
    const duplicate = entries.find((e) => e.id === 'duplicate')
    if (!duplicate || duplicate.kind !== undefined) throw new Error('duplicate missing')
    duplicate.onSelect()
    expect(onAction).toHaveBeenCalledWith('duplicate', 'notes/a.md')
  })

  it('builds folder actions for directories', () => {
    const labels = labelsOf(fileMenuEntries({ ...baseCtx, path: 'notes', isDirectory: true }))
    expect(labels).toContain('New note in folder')
    expect(labels).toContain('Map to Canvas')
    expect(labels).not.toContain('Duplicate')
  })

  it('builds bulk actions for multi-selections', () => {
    const labels = labelsOf(fileMenuEntries({ ...baseCtx, isMultiSelect: true, selectionCount: 3 }))
    expect(labels).toContain('Add 3 files to Canvas')
    expect(labels).toContain('Delete 3 files')
    expect(labels).not.toContain('Bookmark')
  })

  it('offers Mark as Reviewed for agent-modified files', () => {
    const labels = labelsOf(fileMenuEntries({ ...baseCtx, isAgentModified: true }))
    expect(labels).toContain('Mark as Reviewed')
  })

  it('marks bookmarked files and destructive deletes', () => {
    const entries = fileMenuEntries({ ...baseCtx, isBookmarked: true })
    const labels = labelsOf(entries)
    expect(labels).toContain('Remove Bookmark')
    const del = entries.find((e) => e.id === 'delete')
    if (!del || del.kind !== undefined) throw new Error('delete missing')
    expect(del.destructive).toBe(true)
  })
})
