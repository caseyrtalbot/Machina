import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '@shared/canvas-types'

// Stub design tokens so the component can reference colors without CSS vars
vi.mock('../../../design/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../design/tokens')>()
  return {
    ...actual,
    colors: {
      ...actual.colors,
      bg: { base: '#000', surface: '#111', elevated: '#222', muted: '#333' },
      border: { default: '#444', subtle: '#555' },
      text: { primary: '#fff', secondary: '#ccc', muted: '#999', tertiary: '#777' },
      accent: { default: '#0af', hover: '#0cf', muted: '#068' },
      semantic: { cluster: '#3dca8d', tension: '#ecaa0b' }
    }
  }
})

function makeFolderNode(metaOverrides?: Partial<Record<string, unknown>>): CanvasNode {
  return {
    id: 'test-folder-1',
    type: 'project-folder',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 80 },
    content: '',
    metadata: {
      relativePath: 'src/utils',
      rootPath: '/Users/casey/Projects/thought-engine',
      childCount: 5,
      collapsed: false,
      ...metaOverrides
    }
  }
}

describe('ProjectFolderCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the folder name from the last path segment', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode()} />)

    expect(screen.getByTestId('folder-name').textContent).toBe('utils')
  })

  it('renders root folder name from rootPath when relativePath is "."', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    const node = makeFolderNode({
      relativePath: '.',
      rootPath: '/Users/casey/Projects/thought-engine'
    })
    render(<ProjectFolderCard node={node} />)

    expect(screen.getByTestId('folder-name').textContent).toBe('thought-engine')
  })

  it('shows the child count badge when childCount > 0', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode({ childCount: 12 })} />)

    expect(screen.getByTestId('folder-child-count').textContent).toBe('12')
  })

  it('hides the child count badge when childCount is 0', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode({ childCount: 0 })} />)

    expect(screen.queryByTestId('folder-child-count')).toBeNull()
  })

  it('shows the relative path subtitle when not root', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode({ relativePath: 'src/utils' })} />)

    expect(screen.getByTestId('folder-path').textContent).toBe('src/utils')
  })

  it('hides the relative path subtitle for root folder', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode({ relativePath: '.' })} />)

    expect(screen.queryByTestId('folder-path')).toBeNull()
  })

  it('shows open folder icon when not collapsed', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode({ collapsed: false })} />)

    expect(screen.getByTestId('folder-icon').textContent).toBe('\u{1F4C2}')
  })

  it('shows closed folder icon when collapsed', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    render(<ProjectFolderCard node={makeFolderNode({ collapsed: true })} />)

    expect(screen.getByTestId('folder-icon').textContent).toBe('\u{1F4C1}')
  })

  it('renders without crashing when metadata is empty', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    const node: CanvasNode = {
      id: 'test-empty-folder',
      type: 'project-folder',
      position: { x: 0, y: 0 },
      size: { width: 260, height: 80 },
      content: '',
      metadata: {}
    }
    render(<ProjectFolderCard node={node} />)

    // Should fall back to 'Folder' default name
    expect(screen.getByTestId('folder-name').textContent).toBe('Folder')
  })

  it('falls back to Folder when relativePath has no segments', async () => {
    const mod = await import('../ProjectFolderCard')
    const ProjectFolderCard = mod.default
    const node = makeFolderNode({ relativePath: '' })
    render(<ProjectFolderCard node={node} />)

    expect(screen.getByTestId('folder-name').textContent).toBe('Folder')
  })
})

describe('card-registry', () => {
  it('has an entry for project-folder type', async () => {
    const { LazyCards } = await import('../card-registry')
    expect(LazyCards['project-folder']).toBeDefined()
  })

  it('project-folder entry is a lazy component', async () => {
    const { LazyCards } = await import('../card-registry')
    // LazyExoticComponent has a $$typeof symbol property
    expect(LazyCards['project-folder']).toHaveProperty('$$typeof')
  })
})
