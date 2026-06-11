import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPaletteItems } from '../palette-sources'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { useClaudeStatusStore } from '../../../store/claude-status-store'

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState({ files: [] })
  useClaudeStatusStore.setState(useClaudeStatusStore.getInitialState())
})

describe('palette run-setup action (item 3.5)', () => {
  it('exposes a "Run setup" action that re-opens the onboarding walkthrough', async () => {
    const close = vi.fn()
    const items = buildPaletteItems({ closePalette: close })
    const setup = items.find((i) => i.id === 'action:run-setup')
    expect(setup).toBeDefined()
    expect(setup!.kind).toBe('action')
    expect(setup!.title).toBe('Run setup')

    expect(useClaudeStatusStore.getState().showOnboarding).toBe(false)
    await setup!.run()
    expect(close).toHaveBeenCalled()
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(true)
  })

  it('re-opens even after the user previously dismissed onboarding', async () => {
    useClaudeStatusStore.getState().dismissOnboarding()
    const items = buildPaletteItems({ closePalette: () => {} })
    const setup = items.find((i) => i.id === 'action:run-setup')
    await setup!.run()
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(true)
  })
})
