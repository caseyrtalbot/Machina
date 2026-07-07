/**
 * Command palette — step-7 linter rendering (contracts v1.2.4): a broken
 * harness (error-severity diagnostics) renders GREYED with its reason and
 * run disabled — visible, inert, never vanished. The IPC bridge is stubbed
 * on window.api; the full item table lives in palette-sources.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../CommandPalette'
import { useHarnessStore } from '../../../store/harness-store'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { runHarness } from '../../../store/harness-run'
import type { HarnessSummary } from '@shared/harness-types'

vi.mock('../../../store/harness-run', () => ({
  runHarness: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../engine/vault-search', () => ({
  searchVault: vi.fn().mockResolvedValue([])
}))

const broken: HarnessSummary = {
  slug: 'stripped',
  name: 'stripped',
  description: 'tampered scope',
  adapter: 'claude',
  diagnostics: [
    {
      severity: 'error',
      code: 'scope-protected-globs',
      message: 'scope contract is missing protected forbiddenGlobs: .machina/agents/*/verify.sh',
      file: 'scope.json'
    }
  ]
}

const list = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState({ files: [], canvasIds: [] })
  useHarnessStore.setState({ summaries: [broken] })
  list.mockResolvedValue([broken])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { harness: { list } }
})

describe('CommandPalette — broken-harness rendering (step 7)', () => {
  it('renders the broken harness greyed with its reason, aria-disabled, and run inert', async () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} />)

    const item = await screen.findByRole('option', { name: /Run harness: stripped/ })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.textContent).toContain('broken harness')
    expect(item.textContent).toContain('missing protected forbiddenGlobs')

    // Run disabled: clicking neither runs the harness nor closes the palette.
    fireEvent.click(item)
    expect(runHarness).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
