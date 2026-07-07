/**
 * RevertAgentSection (workstation step 5, contracts §2/§4/§6 v1.2.5).
 *
 * The IPC bridge is stubbed on window.api. The load-bearing assertions:
 * revert NEVER fires without the confirm step, the confirm copy follows the
 * §4 containment framing, the list re-enumerates after a revert (reverted
 * shas excluded), and non-repo workspaces render the honest disabled state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { AgentCommits } from '@shared/git-types'
import { RevertAgentSection } from '../RevertAgentSection'

const listAgentCommits = vi.fn()
const revertAgent = vi.fn()

const agents: AgentCommits[] = [
  {
    agentId: 'test-fixer',
    shas: ['aaa1', 'aaa2'],
    lastSubject: 'fix: correct off-by-one in retry loop',
    lastDate: '2026-07-07T10:00:00.000Z'
  },
  {
    // Adapter-identity fallback shape (ad-hoc thread, no harness slug).
    agentId: 'cli-claude',
    shas: ['bbb1'],
    lastSubject: 'chore: scratch notes',
    lastDate: '2026-07-06T09:00:00.000Z'
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  listAgentCommits.mockResolvedValue({ ok: true, agents })
  revertAgent.mockResolvedValue({ ok: true, sha: 'ccc1' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { git: { listAgentCommits, revertAgent } }
})

const expand = async () => {
  fireEvent.click(screen.getByTestId('revert-agent-toggle'))
  await act(async () => {})
}

describe('RevertAgentSection', () => {
  it('is collapsed by default and enumerates nothing until opened', () => {
    render(<RevertAgentSection />)
    expect(screen.getByTestId('revert-agent-toggle').getAttribute('aria-expanded')).toBe('false')
    expect(listAgentCommits).not.toHaveBeenCalled()
  })

  it('expanding lists both id shapes with counts and last subject', async () => {
    render(<RevertAgentSection />)
    await expand()

    const fixer = screen.getByTestId('revert-agent-row-test-fixer')
    expect(fixer.textContent).toContain('test-fixer')
    expect(fixer.textContent).toContain('2 commits')
    expect(fixer.textContent).toContain('fix: correct off-by-one in retry loop')

    const adapter = screen.getByTestId('revert-agent-row-cli-claude')
    expect(adapter.textContent).toContain('cli-claude')
    expect(adapter.textContent).toContain('1 commit')
  })

  it('never reverts without confirm: arming shows the honest containment copy first', async () => {
    render(<RevertAgentSection />)
    await expand()

    fireEvent.click(screen.getByTestId('revert-agent-arm-test-fixer'))
    expect(revertAgent).not.toHaveBeenCalled()

    const confirm = screen.getByTestId('revert-agent-confirm')
    // §4 framing: creates new commits, deletes no history, is not protection.
    expect(confirm.textContent).toContain('creates new commits')
    expect(confirm.textContent).toContain('history is not deleted')
    expect(confirm.textContent).toContain('not protection')
  })

  it('cancel disarms the confirm without reverting', async () => {
    render(<RevertAgentSection />)
    await expand()

    fireEvent.click(screen.getByTestId('revert-agent-arm-test-fixer'))
    fireEvent.click(screen.getByTestId('revert-agent-cancel'))

    expect(screen.queryByTestId('revert-agent-confirm')).toBeNull()
    expect(revertAgent).not.toHaveBeenCalled()
  })

  it('confirm reverts the armed agent and re-enumerates — reverted group gone, others intact', async () => {
    render(<RevertAgentSection />)
    await expand()

    // The refreshed enumeration excludes the just-reverted shas.
    listAgentCommits.mockResolvedValue({ ok: true, agents: agents.slice(1) })

    fireEvent.click(screen.getByTestId('revert-agent-arm-test-fixer'))
    fireEvent.click(screen.getByTestId('revert-agent-confirm-button'))
    await act(async () => {})

    expect(revertAgent).toHaveBeenCalledWith('test-fixer')
    expect(listAgentCommits).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('revert-agent-row-test-fixer')).toBeNull()
    expect(screen.getByTestId('revert-agent-row-cli-claude')).toBeTruthy()
    expect(screen.getByTestId('revert-agent-notice').textContent).toContain(
      'Reverted 2 commits by test-fixer'
    )
  })

  it('surfaces a structured revert failure honestly (revert-conflict)', async () => {
    revertAgent.mockResolvedValue({ ok: false, reason: 'revert-conflict' })
    render(<RevertAgentSection />)
    await expand()

    fireEvent.click(screen.getByTestId('revert-agent-arm-test-fixer'))
    fireEvent.click(screen.getByTestId('revert-agent-confirm-button'))
    await act(async () => {})

    expect(screen.getByTestId('revert-agent-notice').textContent).toContain('conflicts')
    expect(screen.getByTestId('revert-agent-notice').textContent).toContain('nothing was changed')
  })

  it('renders the disabled non-repo state — no revert affordance at all', async () => {
    listAgentCommits.mockResolvedValue({ ok: false, reason: 'not-a-git-repo' })
    render(<RevertAgentSection />)
    await expand()

    expect(screen.getByTestId('revert-agent-error').textContent).toContain(
      'Not a git repository — nothing to revert from.'
    )
    expect(screen.queryByTestId('revert-agent-arm-test-fixer')).toBeNull()
  })

  it('renders a git failure as an honest error state, never the empty state (v1.2.7)', async () => {
    // A failed git log is NOT "no unreverted agent commits" — the copy must
    // say enumeration failed, not suggest there is nothing to revert.
    listAgentCommits.mockResolvedValue({ ok: false, reason: 'git-failed' })
    render(<RevertAgentSection />)
    await expand()

    expect(screen.queryByTestId('revert-agent-empty')).toBeNull()
    const error = screen.getByTestId('revert-agent-error')
    expect(error.textContent).toContain('git log failed')
    expect(error.textContent).toContain('not "nothing to revert"')
  })

  it('shows the empty state when no unreverted agent commits exist', async () => {
    listAgentCommits.mockResolvedValue({ ok: true, agents: [] })
    render(<RevertAgentSection />)
    await expand()

    expect(screen.getByTestId('revert-agent-empty')).toBeTruthy()
  })

  it('a requestedAgentId (palette route) expands and arms the confirm for that agent', async () => {
    render(<RevertAgentSection requestedAgentId="test-fixer" />)
    await act(async () => {})

    expect(screen.getByTestId('revert-agent-toggle').getAttribute('aria-expanded')).toBe('true')
    const confirm = screen.getByTestId('revert-agent-confirm')
    expect(confirm.textContent).toContain('test-fixer')
    expect(revertAgent).not.toHaveBeenCalled()
  })
})
