import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { BacklinksPanel } from '../BacklinksPanel'
import { useVaultStore } from '../../../store/vault-store'
import { useUiStore } from '../../../store/ui-store'
import type { Artifact, KnowledgeGraph } from '@shared/types'

function makeArtifact(id: string, body = ''): Artifact {
  return {
    id,
    title: id.toUpperCase(),
    type: 'note',
    signal: 'untested',
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
    body,
    frontmatter: {}
  }
}

const graph: KnowledgeGraph = {
  nodes: [],
  edges: [
    // inbound: a -> current; outgoing: current -> b
    { source: 'a', target: 'current', kind: 'connection' },
    { source: 'current', target: 'b', kind: 'connection' }
  ]
}

describe('BacklinksPanel sections', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState())
    useVaultStore.setState({
      graph,
      artifacts: [makeArtifact('a', 'links to current'), makeArtifact('b'), makeArtifact('current')]
    })
    // Expand the panel (collapsed defaults to true per note path)
    useUiStore.setState({ backlinkCollapsed: { '/vault/current.md': false } })
  })

  afterEach(() => {
    cleanup()
  })

  function renderPanel(backlinks: Artifact[]) {
    return render(
      <BacklinksPanel
        currentNoteId="current"
        currentNotePath="/vault/current.md"
        backlinks={backlinks}
        onNavigate={vi.fn()}
      />
    )
  }

  it('renders inbound links under "Linked mentions"', () => {
    const inbound = useVaultStore.getState().getBacklinks('current')
    const { getByText } = renderPanel(inbound)

    expect(getByText('Linked mentions')).toBeTruthy()
    expect(getByText('A')).toBeTruthy()
  })

  it('renders outgoing links under "Links from this note"', () => {
    const { getByText } = renderPanel([])

    expect(getByText('Links from this note')).toBeTruthy()
    expect(getByText('B')).toBeTruthy()
  })

  it('shows the combined count in the header', () => {
    const inbound = useVaultStore.getState().getBacklinks('current')
    const { getByText } = renderPanel(inbound)

    // 1 inbound + 1 outgoing
    expect(getByText('2')).toBeTruthy()
  })

  it('omits a section with no entries', () => {
    useVaultStore.setState({ graph: { nodes: [], edges: [] } })
    const { queryByText, getByText } = renderPanel([makeArtifact('a')])

    expect(getByText('Linked mentions')).toBeTruthy()
    expect(queryByText('Links from this note')).toBeNull()
  })

  it('renders nothing when there are no links in either direction', () => {
    useVaultStore.setState({ graph: { nodes: [], edges: [] } })
    const { container } = renderPanel([])

    expect(container.firstChild).toBeNull()
  })
})
