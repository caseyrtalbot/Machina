import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FrontmatterHeader } from '../FrontmatterHeader'
import { useEditorStore } from '../../../store/editor-store'
import { parseFrontmatter } from '../markdown-utils'
import type { Artifact } from '@shared/types'

// Mock vault-store with artifact fixtures used by the autocomplete (Task 4).
vi.mock('../../../store/vault-store', () => {
  const artifacts: Artifact[] = [
    {
      id: 'n-vibe',
      title: 'Design Patterns',
      type: 'note',
      created: '2026-04-01',
      modified: '2026-04-15',
      signal: 'emerging',
      tags: [],
      connections: [],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      related: [],
      concepts: [],
      origin: 'human',
      sources: [],
      bodyLinks: [],
      body: '',
      frontmatter: {}
    },
    {
      id: 'n-llm',
      title: 'API Reference',
      type: 'note',
      created: '2026-04-01',
      modified: '2026-04-14',
      signal: 'emerging',
      tags: [],
      connections: [],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      related: [],
      concepts: [],
      origin: 'human',
      sources: [],
      bodyLinks: [],
      body: '',
      frontmatter: {}
    }
  ]
  return {
    useVaultStore: (selector: (s: unknown) => unknown) =>
      selector({ artifactById: Object.fromEntries(artifacts.map((a) => [a.id, a])), artifacts })
  }
})

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'n-test',
    title: 'Test Note',
    type: 'note',
    created: '2026-04-16',
    modified: '2026-04-16',
    signal: 'emerging',
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    concepts: [],
    origin: 'human',
    sources: [],
    bodyLinks: [],
    body: '',
    frontmatter: {},
    ...overrides
  }
}

describe('FrontmatterHeader — Relationships empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides Relationships section when non-editable and all fields empty', () => {
    render(
      <FrontmatterHeader
        artifact={makeArtifact()}
        frontmatter={{}}
        mode="rich"
        // no onFrontmatterChange → non-editable
      />
    )
    expect(screen.queryByText('Relationships')).toBeNull()
  })

  it('shows Relationships section when editable and connections is empty', () => {
    render(
      <FrontmatterHeader
        artifact={makeArtifact()}
        frontmatter={{}}
        mode="rich"
        onFrontmatterChange={vi.fn()}
      />
    )
    expect(screen.getByText('Relationships')).toBeTruthy()
    expect(screen.getByText('Connections')).toBeTruthy()
  })

  it('hides Relationships section when editable but mode is source', () => {
    render(
      <FrontmatterHeader
        artifact={makeArtifact()}
        frontmatter={{}}
        mode="source"
        onFrontmatterChange={vi.fn()}
      />
    )
    expect(screen.queryByText('Relationships')).toBeNull()
  })
})

describe('FrontmatterHeader — connection remove', () => {
  it('clicking the × on a connection pill calls onFrontmatterChange with that id removed', () => {
    const onFrontmatterChange = vi.fn()
    render(
      <FrontmatterHeader
        artifact={makeArtifact({ connections: ['Design Patterns', 'API Reference', 'ag04'] })}
        frontmatter={{ connections: ['Design Patterns', 'API Reference', 'ag04'] }}
        mode="rich"
        onFrontmatterChange={onFrontmatterChange}
      />
    )

    const removeBtn = screen.getByLabelText('Remove connection API Reference')
    fireEvent.click(removeBtn)

    expect(onFrontmatterChange).toHaveBeenCalledTimes(1)
    const raw = onFrontmatterChange.mock.calls[0][0] as string
    expect(raw).toContain('Design Patterns')
    expect(raw).toContain('ag04')
    expect(raw).not.toContain('API Reference')
  })

  it('does not render × when non-editable', () => {
    render(
      <FrontmatterHeader
        artifact={makeArtifact({ connections: ['Design Patterns'] })}
        frontmatter={{ connections: ['Design Patterns'] }}
        mode="rich"
        // no onFrontmatterChange
      />
    )
    expect(screen.queryByLabelText('Remove connection Design Patterns')).toBeNull()
  })
})

describe('FrontmatterHeader — connection add', () => {
  it('clicking "+ add connection" opens the autocomplete and selecting a suggestion calls onFrontmatterChange', () => {
    const onFrontmatterChange = vi.fn()
    render(
      <FrontmatterHeader
        artifact={makeArtifact({ connections: [] })}
        frontmatter={{}}
        mode="rich"
        onFrontmatterChange={onFrontmatterChange}
      />
    )

    fireEvent.click(screen.getByText('+ add connection'))
    const input = screen.getByPlaceholderText('Add connection…')
    fireEvent.change(input, { target: { value: 'vibe' } })
    fireEvent.click(screen.getByText('Design Patterns'))

    expect(onFrontmatterChange).toHaveBeenCalledTimes(1)
    const raw = onFrontmatterChange.mock.calls[0][0] as string
    expect(raw).toContain('Design Patterns')
  })

  it('+ add connection is not rendered in non-editable mode', () => {
    render(
      <FrontmatterHeader
        artifact={makeArtifact({ connections: ['Design Patterns'] })}
        frontmatter={{ connections: ['Design Patterns'] }}
        mode="rich"
        // no onFrontmatterChange
      />
    )
    expect(screen.queryByText('+ add connection')).toBeNull()
  })
})

describe('FrontmatterHeader — lossless raw patching (item 1.2)', () => {
  const content =
    '---\n# pinned comment\nstatus: draft\nmeta:\n  author: casey\nnotes: |\n  block text\n---\nBody.'

  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState())
    useEditorStore.setState({ content })
  })

  it('deleting a property preserves comments, nested maps, and block scalars', () => {
    const onFrontmatterChange = vi.fn()
    render(
      <FrontmatterHeader
        artifact={makeArtifact()}
        frontmatter={parseFrontmatter(content).data}
        mode="rich"
        onFrontmatterChange={onFrontmatterChange}
      />
    )

    fireEvent.click(screen.getByLabelText('Delete property status'))

    expect(onFrontmatterChange).toHaveBeenCalledTimes(1)
    const raw = onFrontmatterChange.mock.calls[0][0] as string
    expect(raw).toBe('---\n# pinned comment\nmeta:\n  author: casey\nnotes: |\n  block text\n---\n')
  })

  it('adding a property appends to the raw block without re-serializing it', () => {
    const onFrontmatterChange = vi.fn()
    render(
      <FrontmatterHeader
        artifact={makeArtifact()}
        frontmatter={parseFrontmatter(content).data}
        mode="rich"
        onFrontmatterChange={onFrontmatterChange}
      />
    )

    fireEvent.click(screen.getByText('+ add property'))
    const input = screen.getByPlaceholderText('Property name...')
    fireEvent.change(input, { target: { value: 'author' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onFrontmatterChange).toHaveBeenCalledTimes(1)
    const raw = onFrontmatterChange.mock.calls[0][0] as string
    expect(raw).toBe(
      '---\n# pinned comment\nstatus: draft\nmeta:\n  author: casey\nnotes: |\n  block text\nauthor: ""\n---\n'
    )
  })
})
