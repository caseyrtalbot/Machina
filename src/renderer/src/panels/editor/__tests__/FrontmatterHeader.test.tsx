import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FrontmatterHeader } from '../FrontmatterHeader'
import type { Artifact } from '@shared/types'

// Mock vault-store for autocomplete tests later; safe to include now.
vi.mock('../../../store/vault-store', () => ({
  useVaultStore: (selector: (s: unknown) => unknown) =>
    selector({
      artifactById: {},
      artifacts: []
    })
}))

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
        artifact={makeArtifact({ connections: ['Vibe Coding', 'LLM Council', 'ag04'] })}
        frontmatter={{ connections: ['Vibe Coding', 'LLM Council', 'ag04'] }}
        mode="rich"
        onFrontmatterChange={onFrontmatterChange}
      />
    )

    const removeBtn = screen.getByLabelText('Remove connection LLM Council')
    fireEvent.click(removeBtn)

    expect(onFrontmatterChange).toHaveBeenCalledTimes(1)
    const raw = onFrontmatterChange.mock.calls[0][0] as string
    expect(raw).toContain('Vibe Coding')
    expect(raw).toContain('ag04')
    expect(raw).not.toContain('LLM Council')
  })

  it('does not render × when non-editable', () => {
    render(
      <FrontmatterHeader
        artifact={makeArtifact({ connections: ['Vibe Coding'] })}
        frontmatter={{ connections: ['Vibe Coding'] }}
        mode="rich"
        // no onFrontmatterChange
      />
    )
    expect(screen.queryByLabelText('Remove connection Vibe Coding')).toBeNull()
  })
})
