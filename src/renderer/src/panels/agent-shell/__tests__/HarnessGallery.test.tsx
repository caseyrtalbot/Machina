import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HarnessGallery } from '../HarnessGallery'
import { useHarnessStore } from '../../../store/harness-store'
import type { HarnessSummary } from '@shared/harness-types'

const summary: HarnessSummary = {
  slug: 'test-fixer',
  name: 'test-fixer',
  description: 'Fix one failing test.',
  adapter: 'claude',
  budgets: { maxTurns: 10, maxWritesPerMinute: 10 },
  diagnostics: []
}

const create = vi.fn()
const list = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ ok: true, root: '/v/.machina/agents/test-fixer' })
  list.mockResolvedValue([summary])
  useHarnessStore.setState(useHarnessStore.getInitialState())
  // @ts-expect-error focused IPC test stub
  window.api = { harness: { create, list } }
})

afterEach(() => {
  vi.useRealTimers()
})

function renderGallery(props: { readonly initialTemplateId?: string } = {}) {
  const onClose = vi.fn()
  const onRequestRun = vi.fn()
  const view = render(
    <HarnessGallery
      open
      onClose={onClose}
      onRequestRun={onRequestRun}
      initialTemplateId={props.initialTemplateId}
    />
  )
  return { ...view, onClose, onRequestRun }
}

function openBlankBuilder(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Build blank' }))
}

function fillValidBlank(
  options: { readonly raw?: boolean; readonly warning?: boolean } = {}
): void {
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'local-reviewer' } })
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Reviews a bounded local change' }
  })
  fireEvent.change(screen.getByLabelText('Role / operating instructions'), {
    target: { value: 'You review the requested local change and report evidence.' }
  })
  fireEvent.change(screen.getByLabelText('Goal'), {
    target: { value: 'Review the user supplied target.' }
  })
  fireEvent.change(screen.getByLabelText('Allowed globs'), {
    target: { value: 'src/**\ntests/**' }
  })
  fireEvent.change(screen.getByLabelText('Forbidden globs'), {
    target: { value: '.env' }
  })
  fireEvent.change(screen.getByLabelText('Acceptance'), {
    target: { value: 'A concise evidence backed report exists.' }
  })
  fireEvent.change(screen.getByLabelText('Rollback'), {
    target: { value: 'No rollback is needed because this role is read only.' }
  })
  fireEvent.change(screen.getByLabelText('Rules'), {
    target: {
      value: options.warning
        ? 'Only inspect the requested files.'
        : '- [scope] Inspect requested files.'
    }
  })
  fireEvent.change(screen.getByLabelText('Verifier command'), {
    target: { value: 'npm test' }
  })
  if (options.raw) {
    fireEvent.change(screen.getByLabelText('Invocation template'), {
      target: { value: 'local-review --prompt {prompt}' }
    })
  }
}

describe('HarnessGallery — catalog', () => {
  it('renders all ten cards with audience, budget, scope, verifier, and expandable details', () => {
    renderGallery()
    expect(screen.getAllByTestId(/^harness-template-card-/)).toHaveLength(10)

    const card = screen.getByTestId('harness-template-card-test-fixer')
    expect(card.textContent).toContain('seasoned-programmer')
    expect(card.textContent).toContain('turns')
    expect(card.textContent).toContain('Scope')
    expect(card.textContent).toContain('verify.sh')
    fireEvent.click(within(card).getByRole('button', { name: 'Details' }))
    expect(card.textContent).toContain('Deterministic verifier')
    expect(card.textContent).toContain('concrete brief')
  })

  it('filters the catalog across Guided, Architecture, Engineering, and Bridge', () => {
    renderGallery()
    fireEvent.click(screen.getByRole('button', { name: 'Architecture' }))
    expect(screen.getAllByTestId(/^harness-template-card-/)).toHaveLength(3)
    expect(screen.getByText('Architecture mapper')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Bridge' }))
    expect(screen.getAllByTestId(/^harness-template-card-/)).toHaveLength(1)
    expect(screen.getByText('Raw tool runner')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Guided' }))
    expect(screen.getAllByTestId(/^harness-template-card-/)).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Engineering' }))
    expect(screen.getAllByTestId(/^harness-template-card-/)).toHaveLength(3)
  })

  it('combines category and audience filters', () => {
    renderGallery()
    fireEvent.click(screen.getByRole('button', { name: 'Architecture' }))
    fireEvent.change(screen.getByLabelText('Filter templates by audience'), {
      target: { value: 'seasoned-programmer' }
    })
    expect(screen.getAllByTestId(/^harness-template-card-/)).toHaveLength(2)
    expect(screen.queryByText('Migration planner')).toBeNull()

    fireEvent.change(screen.getByLabelText('Filter templates by audience'), {
      target: { value: 'platform-builder' }
    })
    expect(screen.queryAllByTestId(/^harness-template-card-/)).toHaveLength(0)
  })
})

describe('HarnessGallery — builder', () => {
  it('builds a blank request, unions protected globs in the exact preview, and keeps warnings non-blocking', () => {
    renderGallery()
    openBlankBuilder()
    fillValidBlank({ warning: true })

    const preview = screen.getByTestId('harness-scope-preview')
    expect(preview.textContent).toContain('src/**')
    expect(preview.textContent).toContain('/agents/*/verify.sh')
    expect(screen.getByText(/Warning · 1 rules\.md line/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Create local harness' }) as HTMLButtonElement).disabled,
      screen.getByLabelText('Harness diagnostics').textContent ?? ''
    ).toBe(false)
  })

  it('requires raw invocation, explains shell and post-persistence risk, then accepts a valid template', () => {
    renderGallery({ initialTemplateId: 'raw-tool-runner' })
    expect(screen.getByText('Raw command boundary')).toBeTruthy()
    expect(screen.getByText(/executes in your shell/i)).toBeTruthy()
    expect(screen.getByText(/already persisted/i)).toBeTruthy()
    expect(screen.getAllByText(/invocationTemplate is required/i)).toHaveLength(2)
    expect(
      (screen.getByRole('button', { name: 'Create local harness' }) as HTMLButtonElement).disabled
    ).toBe(true)

    fireEvent.change(screen.getByLabelText('Invocation template'), {
      target: { value: "external-tool '--prompt' {prompt}" }
    })
    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Run one explicitly configured raw tool task.' }
    })
    fireEvent.change(screen.getByLabelText('Allowed globs'), {
      target: { value: 'notes/**' }
    })
    fireEvent.change(screen.getByLabelText('Forbidden globs'), {
      target: { value: '.git/**' }
    })
    fireEvent.change(screen.getByLabelText('Acceptance'), {
      target: { value: 'The configured verifier exits successfully.' }
    })
    fireEvent.change(screen.getByLabelText('Rollback'), {
      target: { value: 'Reject the queued change in the approvals tray.' }
    })
    fireEvent.change(screen.getByLabelText('Verifier command'), { target: { value: 'npm test' } })
    expect(screen.queryAllByText(/invocationTemplate is required/i)).toHaveLength(0)
    expect(
      (screen.getByRole('button', { name: 'Create local harness' }) as HTMLButtonElement).disabled,
      screen.getByLabelText('Harness diagnostics').textContent ?? ''
    ).toBe(false)
  })

  it('shows live field errors and disables creation until the draft is valid', () => {
    renderGallery()
    openBlankBuilder()
    expect(screen.getByText('slug is required')).toBeTruthy()
    expect(screen.getByText('verifyCommand is required')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Create local harness' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fillValidBlank()
    expect(screen.queryByText('slug is required')).toBeNull()
    expect(screen.getByText('Draft is ready to create.')).toBeTruthy()
    expect(screen.getByText(/Arbitrary shell warning/i)).toBeTruthy()
  })
})

describe('HarnessGallery — creation lifecycle', () => {
  it('surfaces structured duplicate errors inline', async () => {
    create.mockResolvedValue({ ok: false, error: 'harness already exists: test-fixer' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderGallery()
    const card = screen.getByTestId('harness-template-card-test-fixer')
    fireEvent.click(within(card).getByRole('button', { name: 'Create' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('harness already exists: test-fixer')
    expect(list).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('refreshes after success and routes the exact created summary to the task gate', async () => {
    const { onClose, onRequestRun } = renderGallery()
    const card = screen.getByTestId('harness-template-card-test-fixer')
    fireEvent.click(within(card).getByRole('button', { name: 'Create' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Created test-fixer')
    expect(status.textContent).toContain('task brief is required')
    expect(list).toHaveBeenCalledOnce()
    fireEvent.click(within(status).getByRole('button', { name: 'Set task & run' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onRequestRun).toHaveBeenCalledWith(summary)
  })

  it('guards against double submission while creation is pending', async () => {
    let resolveCreate: ((value: { ok: true; root: string }) => void) | undefined
    create.mockImplementation(
      () =>
        new Promise<{ ok: true; root: string }>((resolve) => {
          resolveCreate = resolve
        })
    )
    const { onClose, container } = renderGallery()
    const button = within(screen.getByTestId('harness-template-card-test-fixer')).getByRole(
      'button',
      { name: 'Create' }
    )
    fireEvent.click(button)
    fireEvent.click(button)
    expect(create).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('dialog', { name: 'Create a local agent' }).getAttribute('aria-busy')
    ).toBe('true')
    expect(
      (screen.getByRole('button', { name: 'Close agent gallery' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'Templates' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(
      (screen.getByRole('button', { name: 'Build blank' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(container.querySelector('.harness-gallery-backdrop')!)
    expect(onClose).not.toHaveBeenCalled()
    resolveCreate?.({ ok: true, root: '/v/.machina/agents/test-fixer' })
    await screen.findByRole('status')
  })

  it('bounds a never-resolving create and explains the uncertain recovery path', async () => {
    vi.useFakeTimers()
    create.mockReturnValue(new Promise(() => {}))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderGallery()
    const card = screen.getByTestId('harness-template-card-test-fixer')
    fireEvent.click(within(card).getByRole('button', { name: 'Create' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Creation status is unknown')
    expect(alert.textContent).toContain('Check installed agents before retrying')
    expect(
      (screen.getByRole('button', { name: 'Close agent gallery' }) as HTMLButtonElement).disabled
    ).toBe(false)
    errorSpy.mockRestore()
  })
})

describe('HarnessGallery — modal accessibility', () => {
  it('labels the modal, focuses close, dismisses on Escape/backdrop, and restores focus', async () => {
    const prior = document.createElement('button')
    document.body.append(prior)
    prior.focus()
    const onClose = vi.fn()
    const view = render(<HarnessGallery open onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Create a local agent' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close agent gallery' })).toBe(document.activeElement)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.mouseDown(view.container.querySelector('.harness-gallery-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(2)

    view.rerender(<HarnessGallery open={false} onClose={onClose} />)
    await waitFor(() => expect(document.activeElement).toBe(prior))
    prior.remove()
  })
})
