import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HarnessTaskBriefDialog } from '../HarnessTaskBriefDialog'
import { runHarness } from '../../../store/harness-run'
import type { HarnessLaunchStatus } from '../../../store/harness-run'
import { useAgentDispatchStore } from '../../../store/agent-dispatch-store'
import { useThreadStore } from '../../../store/thread-store'
import type { HarnessSummary } from '@shared/harness-types'

vi.mock('../../../store/harness-run', () => ({
  runHarness: vi.fn().mockResolvedValue('accepted')
}))

const summary: HarnessSummary = {
  slug: 'test-fixer',
  name: 'test-fixer',
  description: 'Fixes one failing test and stops.',
  adapter: 'claude',
  budgets: { maxTurns: 6, maxWritesPerMinute: 5 },
  scope: {
    goal: 'Fix one failing test only.',
    allowedGlobs: ['src/**', 'tests/**'],
    forbiddenGlobs: ['.machina/agents/*/verify.sh'],
    acceptance: 'The targeted test passes.',
    rollback: 'Reject the queued write.'
  },
  diagnostics: []
}

beforeEach(() => {
  vi.clearAllMocks()
  useAgentDispatchStore.setState(useAgentDispatchStore.getInitialState())
  useThreadStore.setState(useThreadStore.getInitialState())
  useThreadStore.getState().setVaultPath('/ws')
  vi.mocked(runHarness).mockResolvedValue('accepted')
})

function renderDialog() {
  const onClose = vi.fn()
  const view = render(<HarnessTaskBriefDialog summary={summary} onClose={onClose} />)
  return { ...view, onClose }
}

describe('HarnessTaskBriefDialog', () => {
  it('shows the selected role and effective on-disk scope', () => {
    renderDialog()
    expect(screen.getByText('test-fixer')).toBeTruthy()
    expect(screen.getByText('Fixes one failing test and stops.')).toBeTruthy()
    expect(screen.getByText('Selected role')).toBeTruthy()
    expect(screen.getByText('Declared scope')).toBeTruthy()
    expect(screen.getByText(/globs guide the agent; they are not a sandbox/i)).toBeTruthy()
    expect(screen.getByText(/writes reach disk before the approvals review/i)).toBeTruthy()
    expect(screen.getByText('Allowed')).toBeTruthy()
    expect(screen.getByText('Forbidden')).toBeTruthy()
  })

  it('never substitutes catalog defaults when effective on-disk scope is unavailable', () => {
    const customSummary: HarnessSummary = {
      ...summary,
      slug: 'custom-reviewer',
      name: 'custom-reviewer',
      scope: undefined
    }
    render(<HarnessTaskBriefDialog summary={customSummary} onClose={vi.fn()} />)
    expect(screen.getByText(/agents\/custom-reviewer\/scope\.json/)).toBeTruthy()
    expect(screen.queryByText('Allowed')).toBeNull()
    expect(screen.queryByText('Forbidden')).toBeNull()
  })

  it('requires a non-blank brief and never launches invalid input', () => {
    renderDialog()
    const start = screen.getByRole('button', { name: 'Start harness' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(screen.getByText(/task brief must not be blank/i)).toBeTruthy()
    fireEvent.click(start)
    expect(runHarness).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Task brief'), {
      target: { value: 'inspect\0secrets' }
    })
    expect(screen.getByText(/must not contain NUL bytes/i)).toBeTruthy()
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(runHarness).not.toHaveBeenCalled()
  })

  it('shows the 4000-character counter and blocks oversized briefs', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Task brief'), {
      target: { value: 'x'.repeat(4001) }
    })
    expect(screen.getByText('4,001 / 4,000')).toBeTruthy()
    expect(screen.getByText(/at most 4000 characters/i)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Start harness' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(runHarness).not.toHaveBeenCalled()
  })

  it('forwards the exact normalized task and closes after launch', async () => {
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Task brief'), {
      target: { value: '  Reproduce checkout timeout.\nReport the failing assertion.  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start harness' }))

    await waitFor(() => {
      expect(runHarness).toHaveBeenCalledWith(
        summary,
        'Reproduce checkout timeout.\nReport the failing assertion.'
      )
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  it('guards double submission while launch is pending', async () => {
    let resolveRun: ((value: HarnessLaunchStatus) => void) | undefined
    vi.mocked(runHarness).mockImplementation(
      () =>
        new Promise<HarnessLaunchStatus>((resolve) => {
          resolveRun = resolve
        })
    )
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Task brief'), {
      target: { value: 'Fix the first failing test.' }
    })
    const start = screen.getByRole('button', { name: 'Start harness' })
    start.focus()
    fireEvent.click(start)
    fireEvent.click(start)
    expect(runHarness).toHaveBeenCalledOnce()
    const progressButton = screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement
    expect(progressButton.disabled).toBe(false)
    expect(progressButton.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(progressButton)
    expect((screen.getByLabelText('Task brief') as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('task brief will stay here')
    expect(screen.getByRole('dialog', { name: 'Brief test-fixer' }).getAttribute('aria-busy')).toBe(
      'true'
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    resolveRun?.('accepted')
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('stays open and reports a structured run refusal', async () => {
    vi.mocked(runHarness).mockResolvedValue('refused')
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Task brief'), {
      target: { value: 'Fix the first failing test.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start harness' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Run did not start')
    expect(alert.textContent).toContain('task brief is preserved')
    expect((screen.getByLabelText('Task brief') as HTMLTextAreaElement).value).toBe(
      'Fix the first failing test.'
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: 'Start harness' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('blocks retry and preserves the brief when launch status is indeterminate', async () => {
    vi.mocked(runHarness).mockResolvedValue('indeterminate')
    const { onClose } = renderDialog()
    const brief = screen.getByLabelText('Task brief') as HTMLTextAreaElement
    fireEvent.change(brief, { target: { value: 'Fix the first failing test.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start harness' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/launch status is unknown/i)
    expect(alert.textContent).toMatch(/may still execute.*do not retry/i)
    expect(alert.textContent).toMatch(/Stop or Kill cannot prove.*cancelled/i)
    expect(alert.textContent).toMatch(/inspect Threads and the terminal/i)
    expect(brief.value).toBe('Fix the first failing test.')
    expect(brief.readOnly).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: 'Do not retry' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('keeps an indeterminate launch blocked after the dialog closes and reopens', async () => {
    vi.mocked(runHarness).mockResolvedValue('indeterminate')
    const first = renderDialog()
    fireEvent.change(screen.getByLabelText('Task brief'), {
      target: { value: 'Fix the first failing test.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start harness' }))
    await screen.findByRole('alert')
    first.unmount()

    renderDialog()
    expect(await screen.findByText(/launch status is unknown/i)).toBeTruthy()
    const blocked = screen.getByRole('button', { name: 'Do not retry' }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    fireEvent.click(blocked)
    expect(runHarness).toHaveBeenCalledOnce()
  })

  it('focuses the textarea, closes on Escape, and restores prior focus', async () => {
    const prior = document.createElement('button')
    document.body.append(prior)
    prior.focus()
    const onClose = vi.fn()
    const view = render(<HarnessTaskBriefDialog summary={summary} onClose={onClose} />)
    expect(screen.getByLabelText('Task brief')).toBe(document.activeElement)
    expect(
      screen.getByRole('dialog', { name: 'Brief test-fixer' }).getAttribute('aria-modal')
    ).toBe('true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    await waitFor(() => expect(document.activeElement).toBe(prior))
    prior.remove()
  })
})
