import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConnectionAutocomplete } from '../ConnectionAutocomplete'
import type { Artifact } from '@shared/types'

function makeArtifact(id: string, title: string, modified = '2026-04-10'): Artifact {
  return {
    id,
    title,
    type: 'note',
    created: '2026-04-01',
    modified,
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
}

const artifacts: Artifact[] = [
  makeArtifact('n-vibe', 'Vibe Coding', '2026-04-15'),
  makeArtifact('n-llm', 'LLM Council', '2026-04-14'),
  makeArtifact('n-ag04', 'ag04', '2026-04-13'),
  makeArtifact('n-agents', 'Agent Persona Research', '2026-04-12'),
  makeArtifact('n-self', 'Current Note', '2026-04-10'),
  makeArtifact('n-more-1', 'One', '2026-04-09'),
  makeArtifact('n-more-2', 'Two', '2026-04-08'),
  makeArtifact('n-more-3', 'Three', '2026-04-07'),
  makeArtifact('n-more-4', 'Four', '2026-04-06'),
  makeArtifact('n-more-5', 'Five', '2026-04-05'),
  makeArtifact('n-more-6', 'Six', '2026-04-04'),
  makeArtifact('n-more-7', 'Seven', '2026-04-03')
]

describe('ConnectionAutocomplete', () => {
  it('filters by title substring (case-insensitive)', () => {
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Add connection…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'vibe' } })
    expect(screen.getByText('Vibe Coding')).toBeTruthy()
    expect(screen.queryByText('LLM Council')).toBeNull()
  })

  it('excludes the current artifact and already-connected ids', () => {
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={['Vibe Coding']}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // Empty query shows recency-sorted suggestions (capped at 8)
    expect(screen.queryByText('Vibe Coding')).toBeNull()
    expect(screen.queryByText('Current Note')).toBeNull()
  })

  it('caps results at 8', () => {
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // Role="option" used on each suggestion row for counting
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(8)
  })

  it('Enter selects the highlighted suggestion and calls onSelect with its title', () => {
    const onSelect = vi.fn()
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Add connection…')
    fireEvent.change(input, { target: { value: 'llm' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('LLM Council')
  })

  it('ArrowDown moves highlight and Enter picks the new item', () => {
    const onSelect = vi.fn()
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )
    const input = screen.getByPlaceholderText('Add connection…')
    // Empty query → recency-sorted list. Top is "Vibe Coding" (2026-04-15).
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // second item
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('LLM Council')
  })

  it('Escape calls onClose', () => {
    const onClose = vi.fn()
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.keyDown(screen.getByPlaceholderText('Add connection…'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking a suggestion calls onSelect with its title', () => {
    const onSelect = vi.fn()
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Add connection…'), {
      target: { value: 'vibe' }
    })
    fireEvent.click(screen.getByText('Vibe Coding'))
    expect(onSelect).toHaveBeenCalledWith('Vibe Coding')
  })

  it('shows "no matches" row when query has zero hits', () => {
    render(
      <ConnectionAutocomplete
        artifacts={artifacts}
        currentArtifactId="n-self"
        existingConnections={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Add connection…'), {
      target: { value: 'zzzzzzz' }
    })
    expect(screen.getByText('No matches')).toBeTruthy()
  })
})
