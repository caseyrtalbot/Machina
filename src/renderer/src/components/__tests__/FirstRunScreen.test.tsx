import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FirstRunScreen, checkSavedVault } from '../FirstRunScreen'

interface ApiStub {
  config: { read: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  app: { pathExists: ReturnType<typeof vi.fn> }
  vault: { init: ReturnType<typeof vi.fn> }
}

function stubApi(values: { lastVaultPath?: unknown; pathExists?: boolean; history?: unknown }) {
  const api: ApiStub = {
    config: {
      read: vi.fn(async (_scope: string, key: string) => {
        if (key === 'lastVaultPath') return values.lastVaultPath ?? null
        if (key === 'vaultHistory') return values.history ?? null
        return null
      }),
      write: vi.fn(async () => undefined)
    },
    app: { pathExists: vi.fn(async () => values.pathExists ?? false) },
    vault: { init: vi.fn(async () => undefined) }
  }
  ;(window as unknown as { api: ApiStub }).api = api
  return api
}

beforeEach(() => {
  stubApi({})
})

afterEach(() => {
  delete (window as unknown as { api?: ApiStub }).api
})

describe('checkSavedVault', () => {
  it('returns first-run with no notice when nothing is saved', async () => {
    const api = stubApi({ lastVaultPath: null })
    const result = await checkSavedVault()
    expect(result).toEqual({ kind: 'first-run', missingPath: null })
    expect(api.app.pathExists).not.toHaveBeenCalled()
  })

  it('loads the saved vault when it still exists', async () => {
    const api = stubApi({ lastVaultPath: '/vaults/notes', pathExists: true })
    const result = await checkSavedVault()
    expect(result).toEqual({ kind: 'load', path: '/vaults/notes' })
    expect(api.config.write).not.toHaveBeenCalled()
  })

  it('missing vault path resolves to first-run, clears config, and never inits (no mkdir)', async () => {
    const api = stubApi({ lastVaultPath: '/vaults/deleted', pathExists: false })
    const result = await checkSavedVault()
    expect(result).toEqual({ kind: 'first-run', missingPath: '/vaults/deleted' })
    // Stale entry cleared so the ghost vault is not retried next launch.
    expect(api.config.write).toHaveBeenCalledWith('app', 'lastVaultPath', null)
    // Never reaches vault:init, which is what would mkdir the ghost vault.
    expect(api.vault.init).not.toHaveBeenCalled()
  })
})

describe('FirstRunScreen', () => {
  it('renders the Open Folder CTA and invokes the handler', () => {
    const onOpenFolder = vi.fn()
    render(<FirstRunScreen onOpenFolder={onOpenFolder} onOpenPath={() => {}} />)
    fireEvent.click(screen.getByText('Open Folder'))
    expect(onOpenFolder).toHaveBeenCalledTimes(1)
  })

  it('shows the notice when provided', () => {
    render(
      <FirstRunScreen
        notice="Previous vault not found at /vaults/deleted"
        onOpenFolder={() => {}}
        onOpenPath={() => {}}
      />
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Previous vault not found at /vaults/deleted'
    )
  })

  it('lists vault history and opens an entry on click', async () => {
    stubApi({ history: ['/vaults/a', '/vaults/b'] })
    const onOpenPath = vi.fn()
    render(<FirstRunScreen onOpenFolder={() => {}} onOpenPath={onOpenPath} />)
    const entry = await screen.findByText('/vaults/b')
    fireEvent.click(entry)
    expect(onOpenPath).toHaveBeenCalledWith('/vaults/b')
  })
})
