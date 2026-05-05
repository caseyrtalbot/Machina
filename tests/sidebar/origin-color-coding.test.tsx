import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { FileTree } from '../../src/renderer/src/panels/sidebar/FileTree'
import {
  getOriginColor,
  getFolderOriginColor,
  type ArtifactOrigin
} from '../../src/renderer/src/panels/sidebar/origin-utils'
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

describe('getFolderOriginColor', () => {
  it('returns undefined when origins map is undefined', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    expect(getFolderOriginColor('/vault/dir', undefined, nodes)).toBeUndefined()
  })

  it('returns undefined when origins map is empty', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    expect(getFolderOriginColor('/vault/dir', new Map(), nodes)).toBeUndefined()
  })

  it('returns undefined when folder has no children (no files)', () => {
    const nodes = [
      makeNode({
        name: 'dir',
        path: '/vault/dir',
        parentPath: '/vault',
        isDirectory: true,
        itemCount: 0
      })
    ]
    const origins = new Map<string, ArtifactOrigin>([['some/other.md', 'agent']])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBeUndefined()
  })

  it('returns agent color when all children are agent origin', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map<string, ArtifactOrigin>([
      ['/vault/dir/a.md', 'agent'],
      ['/vault/dir/b.md', 'agent']
    ])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBe('#4ade80')
  })

  it('returns source color when all children are source origin', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map<string, ArtifactOrigin>([
      ['/vault/dir/a.md', 'source'],
      ['/vault/dir/b.md', 'source']
    ])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBe('#60a5fa')
  })

  it('returns undefined when children have mixed origins', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map<string, ArtifactOrigin>([
      ['/vault/dir/a.md', 'agent'],
      ['/vault/dir/b.md', 'source']
    ])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBeUndefined()
  })

  it('returns undefined when any child is human origin', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map<string, ArtifactOrigin>([
      ['/vault/dir/a.md', 'agent'],
      ['/vault/dir/b.md', 'human']
    ])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBeUndefined()
  })

  it('returns undefined when only some child files have origins', () => {
    const nodes = [
      makeNode({ path: '/vault/dir/a.md', parentPath: '/vault/dir', isDirectory: false }),
      makeNode({ path: '/vault/dir/b.md', parentPath: '/vault/dir', isDirectory: false })
    ]
    const origins = new Map<string, ArtifactOrigin>([['/vault/dir/a.md', 'agent']])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBeUndefined()
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
    const origins = new Map<string, ArtifactOrigin>([['/vault/dir/a.md', 'agent']])
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBe('#4ade80')
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
    const origins = new Map<string, ArtifactOrigin>([
      ['/vault/dir/a.md', 'agent'],
      ['/vault/dir/sub/deep.md', 'agent']
    ])
    // Only /vault/dir/a.md is a direct child; deep.md belongs to /vault/dir/sub
    expect(getFolderOriginColor('/vault/dir', origins, nodes)).toBe('#4ade80')
  })
})

describe('FileTree origin color coding', () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      env: { ...state.env, sidebarFontSize: 13 }
    }))
  })

  it('renders file icon with agent color when origin is agent', () => {
    const nodes = [
      makeNode({
        name: 'generated.md',
        path: '/vault/generated.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    const origins = new Map<string, ArtifactOrigin>([['/vault/generated.md', 'agent']])

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

    // Lucide icons render as stroke-only SVGs; find the file icon SVG
    const fileRow = container.querySelector('.file-row-hover')
    const svg = fileRow?.querySelector('svg')
    expect(svg).not.toBeNull()
    // Lucide receives color via the stroke attribute; fill stays "none"
    expect(svg?.getAttribute('stroke')).toBe(getOriginColor('agent'))
  })

  it('renders file icon with source color when origin is source', () => {
    const nodes = [
      makeNode({
        name: 'ingested.md',
        path: '/vault/ingested.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    const origins = new Map<string, ArtifactOrigin>([['/vault/ingested.md', 'source']])

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

    const fileRow = container.querySelector('.file-row-hover')
    const svg = fileRow?.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('stroke')).toBe(getOriginColor('source'))
  })

  it('renders file icon with default color when origin is human', () => {
    const nodes = [
      makeNode({
        name: 'normal.md',
        path: '/vault/normal.md',
        parentPath: '/vault',
        isDirectory: false,
        depth: 0
      })
    ]
    const origins = new Map<string, ArtifactOrigin>([['/vault/normal.md', 'human']])

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

    const fileRow = container.querySelector('.file-row-hover')
    const svg = fileRow?.querySelector('svg')
    expect(svg).not.toBeNull()
    // Human origin should use default icon color, not an origin override
    expect(svg?.getAttribute('stroke')).not.toBe(getOriginColor('agent'))
    expect(svg?.getAttribute('stroke')).not.toBe(getOriginColor('source'))
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
    // Default markdown color, NOT any origin color
    expect(svg?.getAttribute('stroke')).not.toBe(getOriginColor('agent'))
    expect(svg?.getAttribute('stroke')).not.toBe(getOriginColor('source'))
  })

  it('renders folder icon with agent color when all children are agent origin', () => {
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
    const origins = new Map<string, ArtifactOrigin>([['/vault/agents/output.md', 'agent']])

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
    // First SVG is the chevron, second is the lucide Folder icon
    const folderSvg = svgs?.[1]
    expect(folderSvg).not.toBeNull()
    expect(folderSvg?.getAttribute('stroke')).toBe(getOriginColor('agent'))
  })

  it('renders folder icon with default color when not all children have same origin', () => {
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
    const origins = new Map<string, ArtifactOrigin>([
      ['/vault/mixed/generated.md', 'agent'],
      ['/vault/mixed/manual.md', 'human']
    ])

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
    // Default gray, NOT any origin color
    expect(folderSvg?.getAttribute('stroke')).not.toBe(getOriginColor('agent'))
    expect(folderSvg?.getAttribute('stroke')).not.toBe(getOriginColor('source'))
  })
})
