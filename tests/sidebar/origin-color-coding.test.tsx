import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  FileTree,
  isFolderOrigin,
  ORIGIN_FILE_COLOR,
  ORIGIN_FOLDER_COLOR
} from '../../src/renderer/src/panels/sidebar/FileTree'
import { useSettingsStore } from '../../src/renderer/src/store/settings-store'
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

describe('isFolderOrigin', () => {
  it('returns false when origins map is undefined', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    expect(isFolderOrigin('/vault/dir', undefined, nodes)).toBe(false)
  })

  it('returns false when origins map is empty', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    expect(isFolderOrigin('/vault/dir', new Map(), nodes)).toBe(false)
  })

  it('returns false when folder has no children (no files)', () => {
    const nodes = [
      makeNode({
        name: 'dir',
        path: '/vault/dir',
        parentPath: '/vault',
        isDirectory: true,
        itemCount: 0
      })
    ]
    const origins = new Map([['some/other.md', 'agent']])
    expect(isFolderOrigin('/vault/dir', origins, nodes)).toBe(false)
  })

  it('returns true when all child files have origins', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map([
      ['/vault/dir/a.md', 'agent-x'],
      ['/vault/dir/b.md', 'agent-y']
    ])
    expect(isFolderOrigin('/vault/dir', origins, nodes)).toBe(true)
  })

  it('returns false when only some child files have origins', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map([['/vault/dir/a.md', 'agent']])
    expect(isFolderOrigin('/vault/dir', origins, nodes)).toBe(false)
  })

  it('ignores directory children when checking origins', () => {
    const nodes = [
      makeNode({
        name: 'subdir',
        path: '/vault/dir/subdir',
        parentPath: '/vault/dir',
        isDirectory: true,
        itemCount: 1
      }),
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map([['/vault/dir/a.md', 'agent']])
    expect(isFolderOrigin('/vault/dir', origins, nodes)).toBe(true)
  })

  it('only considers direct children, not nested descendants', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({
        path: '/vault/dir/sub/deep.md',
        parentPath: '/vault/dir/sub',
        isDirectory: false
      })
    ]
    const origins = new Map([
      ['/vault/dir/a.md', 'agent'],
      ['/vault/dir/sub/deep.md', 'agent']
    ])
    // Only /vault/dir/a.md is a direct child; deep.md belongs to /vault/dir/sub
    expect(isFolderOrigin('/vault/dir', origins, nodes)).toBe(true)
  })
})

describe('origin color constants', () => {
  it('exports the expected green file color', () => {
    expect(ORIGIN_FILE_COLOR).toBe('#4ade80')
  })

  it('exports the expected blue folder color', () => {
    expect(ORIGIN_FOLDER_COLOR).toBe('#60a5fa')
  })
})

describe('FileTree origin color coding', () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      env: { ...state.env, sidebarFontSize: 13 }
    }))
  })

  it('renders file icon with origin color when artifactOrigins has an entry', () => {
    const nodes = [
      makeNode({
        name: 'generated.md',
        path: '/vault/generated.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    const origins = new Map([['/vault/generated.md', 'agent-session-1']])

    const { container } = render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        artifactOrigins={origins}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )

    // Phosphor icons render as SVGs; find the file icon SVG
    const fileRow = container.querySelector('.file-row-hover')
    const svg = fileRow?.querySelector('svg')
    expect(svg).not.toBeNull()
    // The Phosphor icon receives color prop which sets fill on the SVG
    expect(svg?.getAttribute('fill')).toBe(ORIGIN_FILE_COLOR)
  })

  it('renders file icon with default color when no origin', () => {
    const nodes = [
      makeNode({
        name: 'normal.md',
        path: '/vault/normal.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]

    const { container } = render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        artifactOrigins={new Map()}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )

    const fileRow = container.querySelector('.file-row-hover')
    const svg = fileRow?.querySelector('svg')
    expect(svg).not.toBeNull()
    // Default markdown color, NOT the origin green
    expect(svg?.getAttribute('fill')).not.toBe(ORIGIN_FILE_COLOR)
  })

  it('renders folder icon with origin color when all children have origins', () => {
    const nodes = [
      makeNode({
        name: 'agents',
        path: '/vault/agents',
        parentPath: '/vault',
        isDirectory: true,
        depth: 0,
        itemCount: 1
      }),
      makeNode({
        name: 'output.md',
        path: '/vault/agents/output.md',
        parentPath: '/vault/agents',
        isDirectory: false,
        depth: 1
      })
    ]
    const origins = new Map([['/vault/agents/output.md', 'agent-x']])

    const { container } = render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        artifactOrigins={origins}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )

    // The directory row is the one with the Chevron and FolderIcon
    const dirRow = container.querySelector('.tree-directory-row')
    const svgs = dirRow?.querySelectorAll('svg')
    // First SVG is the chevron, second is the FolderSimple icon
    const folderSvg = svgs?.[1]
    expect(folderSvg).not.toBeNull()
    expect(folderSvg?.getAttribute('fill')).toBe(ORIGIN_FOLDER_COLOR)
  })

  it('renders folder icon with default color when not all children have origins', () => {
    const nodes = [
      makeNode({
        name: 'mixed',
        path: '/vault/mixed',
        parentPath: '/vault',
        isDirectory: true,
        depth: 0,
        itemCount: 2
      }),
      makeNode({
        name: 'generated.md',
        path: '/vault/mixed/generated.md',
        parentPath: '/vault/mixed',
        isDirectory: false,
        depth: 1
      }),
      makeNode({
        name: 'manual.md',
        path: '/vault/mixed/manual.md',
        parentPath: '/vault/mixed',
        isDirectory: false,
        depth: 1
      })
    ]
    const origins = new Map([['/vault/mixed/generated.md', 'agent']])

    const { container } = render(
      <FileTree
        nodes={nodes}
        activeFilePath={null}
        collapsedPaths={new Set()}
        artifactOrigins={origins}
        onFileSelect={vi.fn()}
        onToggleDirectory={vi.fn()}
      />
    )

    const dirRow = container.querySelector('.tree-directory-row')
    const svgs = dirRow?.querySelectorAll('svg')
    const folderSvg = svgs?.[1]
    expect(folderSvg).not.toBeNull()
    // Default gray, NOT the origin blue
    expect(folderSvg?.getAttribute('fill')).not.toBe(ORIGIN_FOLDER_COLOR)
  })
})
