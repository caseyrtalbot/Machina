/**
 * Harness-identity chip (workstation step 3, contracts §4): the slug shown is
 * MAIN's binding registry value via harness:binding — never frontmatter.
 * The IPC bridge is stubbed on window.api.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { HarnessIdentityChip } from '../HarnessIdentityChip'

const binding = vi.fn()
const bound = {
  slug: 'test-fixer',
  adapter: 'claude' as const,
  rawInvocationReady: false
}

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { harness: { binding } }
})

describe('HarnessIdentityChip', () => {
  it('renders the bound slug from the main-side binding', async () => {
    binding.mockResolvedValue(bound)
    render(<HarnessIdentityChip threadId="t1" />)
    const chip = await screen.findByTestId('thread-harness-chip')
    expect(chip.textContent).toBe('harness test-fixer')
    expect(chip.title).toContain('test-fixer')
    expect(binding).toHaveBeenCalledWith('t1')
  })

  it('renders nothing for an unbound thread', async () => {
    binding.mockResolvedValue(null)
    render(<HarnessIdentityChip threadId="t1" />)
    await act(async () => {})
    expect(screen.queryByTestId('thread-harness-chip')).toBeNull()
  })

  it('re-fetches when the thread agentId lands (fresh run binds AFTER the chip mounts)', async () => {
    // runHarness order: createThread (chip mounts, binding fetch → null),
    // harness:run records the binding, setThreadAgentId re-renders. The
    // agentId prop is the invalidation signal for that null→bound transition.
    binding.mockResolvedValue(null)
    const { rerender } = render(<HarnessIdentityChip threadId="t1" />)
    await act(async () => {})
    expect(screen.queryByTestId('thread-harness-chip')).toBeNull()

    binding.mockResolvedValue(bound)
    rerender(<HarnessIdentityChip threadId="t1" agentId="test-fixer" />)
    const chip = await screen.findByTestId('thread-harness-chip')
    expect(chip.textContent).toBe('harness test-fixer')
    expect(binding).toHaveBeenCalledTimes(2)
  })

  it('re-fetches on threadId change and drops the previous slug while unbound', async () => {
    binding.mockResolvedValue(bound)
    const { rerender } = render(<HarnessIdentityChip threadId="t1" />)
    await screen.findByTestId('thread-harness-chip')

    binding.mockResolvedValue(null)
    rerender(<HarnessIdentityChip threadId="t2" />)
    await act(async () => {})
    expect(binding).toHaveBeenLastCalledWith('t2')
    expect(screen.queryByTestId('thread-harness-chip')).toBeNull()
  })
})
