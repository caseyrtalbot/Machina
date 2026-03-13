import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTree } from '../../src/renderer/src/panels/sidebar/FileTree'
import type { FlatTreeNode } from '../../src/renderer/src/panels/sidebar/buildFileTree'

function makeNode(overrides: Partial<FlatTreeNode> = {}): FlatTreeNode {
  return {
    name: 'file.md',
    path: '/vault/file.md',
    parentPath: '/vault',
    isDirectory: false,
    depth: 0,
    itemCount: 0,
    ...overrides
  }
}

describe('FileTree', () => {
  it('renders directory and file nodes', () => {
    const nodes: FlatTreeNode[] = [
      makeNode({
        name: 'notes',
        path: '/vault/notes',
        parentPath: '/vault',
        isDirectory: true,
        depth: 0,
        itemCount: 1
      }),
      makeNode({
        name: 'readme.md',
        path: '/vault/readme.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )
    expect(screen.getByText('notes')).toBeDefined()
    expect(screen.getByText('readme')).toBeDefined()
  })

  it('hides children when directory is collapsed', () => {
    const nodes: FlatTreeNode[] = [
      makeNode({
        name: 'notes',
        path: '/vault/notes',
        parentPath: '/vault',
        isDirectory: true,
        depth: 0,
        itemCount: 1
      }),
      makeNode({
        name: 'child.md',
        path: '/vault/notes/child.md',
        parentPath: '/vault/notes',
        isDirectory: false,
        depth: 1
      })
    ]
    render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set(['/vault/notes'])}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )
    expect(screen.getByText('notes')).toBeDefined()
    expect(screen.queryByText('child.md')).toBeNull()
  })

  it('highlights active file', () => {
    const nodes: FlatTreeNode[] = [
      makeNode({
        name: 'active.md',
        path: '/vault/active.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    render(
      <FileTree
        nodes={nodes}
        activeFilePath="/vault/active.md"
        collapsedPaths={new Set()}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )
    const el = screen.getByText('active').closest('[data-active="true"]')
    expect(el).not.toBeNull()
  })

  it('calls onFileSelect when file clicked', () => {
    const onFileSelect = vi.fn()
    const nodes: FlatTreeNode[] = [
      makeNode({
        name: 'note.md',
        path: '/vault/note.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        onFileSelect={onFileSelect}
        onToggleDirectory={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('note'))
    expect(onFileSelect).toHaveBeenCalledWith('/vault/note.md')
  })

  it('calls onToggleDirectory when folder clicked', () => {
    const onToggleDirectory = vi.fn()
    const nodes: FlatTreeNode[] = [
      makeNode({
        name: 'folder',
        path: '/vault/folder',
        parentPath: '/vault',
        isDirectory: true,
        depth: 0,
        itemCount: 0
      })
    ]
    render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        onFileSelect={vi.fn()}
        onToggleDirectory={onToggleDirectory}
      />
    )
    fireEvent.click(screen.getByText('folder'))
    expect(onToggleDirectory).toHaveBeenCalledWith('/vault/folder')
  })
})
