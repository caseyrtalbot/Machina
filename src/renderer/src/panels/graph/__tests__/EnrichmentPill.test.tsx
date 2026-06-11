import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { useEnrichmentRunStore } from '../../../store/enrichment-run-store'
import { EnrichmentPill } from '../EnrichmentPill'
import type { Artifact } from '@shared/types'
import type { Thread } from '@shared/thread-types'

function makeArtifact(overrides: Partial<Artifact> & { id: string }): Artifact {
  return {
    title: overrides.id,
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
    body: '',
    frontmatter: {},
    ...overrides
  }
}

const VAULT = '/v'

const createdThread: Thread = {
  id: 'enrich-1',
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-06-10T00:00:00Z',
  lastMessage: '2026-06-10T00:00:00Z',
  title: 'Enrich vault',
  dockState: { tabs: [] },
  messages: []
}

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState(useVaultStore.getInitialState())
  useEnrichmentRunStore.setState(useEnrichmentRunStore.getInitialState())
  useVaultStore.setState({
    vaultPath: VAULT,
    artifacts: [makeArtifact({ id: 'bare', title: 'Bare Note' })],
    artifactPathById: { bare: `${VAULT}/ideas/bare.md` }
  })
  useThreadStore.setState({ vaultPath: VAULT })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: {
      create: vi.fn().mockResolvedValue(createdThread),
      save: vi.fn().mockResolvedValue(undefined)
    },
    agentNative: {
      run: vi.fn().mockResolvedValue({ runId: 'r-1' }),
      abort: vi.fn().mockResolvedValue(undefined)
    }
  }
})

describe('EnrichmentPill', () => {
  it('renders the idle count and an Enrich vault button', () => {
    render(<EnrichmentPill rawFileCount={3} />)
    expect(screen.getByText(/3 files still need metadata/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enrich vault/i })).toBeTruthy()
  })

  it('starts a native thread whose first turn carries the target paths', async () => {
    render(<EnrichmentPill rawFileCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enrich vault/i }))

    await vi.waitFor(() => {
      expect(window.api.thread.create).toHaveBeenCalledWith(
        VAULT,
        'machina-native',
        'claude-sonnet-4-6',
        'Enrich vault'
      )
      expect(window.api.agentNative.run).toHaveBeenCalledTimes(1)
    })

    const runArgs = vi.mocked(window.api.agentNative.run).mock.calls[0][0]
    expect(runArgs.threadId).toBe('enrich-1')
    expect(runArgs.userMessage).toContain('ideas/bare.md')
    expect(runArgs.autoAccept).toBe(false)

    // The new thread keeps a graph dock tab so the pill stays visible.
    const tabs = useThreadStore.getState().dockTabsByThreadId['enrich-1'] ?? []
    expect(tabs.some((t) => t.kind === 'graph')).toBe(true)
  })

  it('reflects the run lifecycle: running while in flight, done when settled', async () => {
    render(<EnrichmentPill rawFileCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enrich vault/i }))

    await vi.waitFor(() => {
      expect(screen.getByText(/Enriching 1 file — approve writes in the thread/i)).toBeTruthy()
    })
    expect(screen.queryByRole('button')).toBeNull()

    // Run settles (use-thread-streaming clears the in-flight flag on message_end).
    useThreadStore.setState({ inFlightByThreadId: {} })
    await vi.waitFor(() => {
      expect(screen.getByText(/Enrichment pass finished/i)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /Enrich again/i })).toBeTruthy()
  })

  it('survives the remount its own thread switch causes: a fresh pill instance shows the run', async () => {
    // Clicking the pill creates a thread, which switches the active thread and
    // remounts the dock (and this pill). Run state must outlive the instance.
    const first = render(<EnrichmentPill rawFileCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enrich vault/i }))
    await vi.waitFor(() => {
      expect(window.api.agentNative.run).toHaveBeenCalledTimes(1)
    })
    first.unmount()

    render(<EnrichmentPill rawFileCount={1} />)
    expect(screen.getByText(/Enriching 1 file — approve writes in the thread/i)).toBeTruthy()
    // No button while running — a remounted pill must not offer a second concurrent run.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reports a tool-budget stop distinctly from a clean finish', async () => {
    render(<EnrichmentPill rawFileCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enrich vault/i }))
    await vi.waitFor(() => {
      expect(window.api.agentNative.run).toHaveBeenCalledTimes(1)
    })

    // Main emits turn_limit before message_end; the store flags the thread.
    useEnrichmentRunStore.getState().markStoppedAtLimit('enrich-1')
    useThreadStore.setState({ inFlightByThreadId: {} })

    await vi.waitFor(() => {
      expect(screen.getByText(/hit its tool budget mid-batch/i)).toBeTruthy()
    })
    expect(screen.queryByText(/Enrichment pass finished/i)).toBeNull()
    expect(screen.getByRole('button', { name: /Enrich again/i })).toBeTruthy()
  })

  it('shows the finished state with no button once the backlog is drained', async () => {
    const view = render(<EnrichmentPill rawFileCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enrich vault/i }))
    await vi.waitFor(() => {
      expect(window.api.agentNative.run).toHaveBeenCalledTimes(1)
    })
    useThreadStore.setState({ inFlightByThreadId: {} })
    view.unmount()

    // A successful pass connects every target: GraphPanel keeps the pill
    // mounted (run state is active) but the count drops to 0.
    render(<EnrichmentPill rawFileCount={0} />)
    expect(screen.getByText(/Enrichment pass finished/i)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
