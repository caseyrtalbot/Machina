// @vitest-environment node
/**
 * Workspace key migration (workstation step 1): reads of lastWorkspacePath /
 * workspaceHistory fall back to their legacy vault keys ONLY while the new
 * key is absent. A stored null must NOT resurrect the legacy value
 * (FirstRunScreen clears by writing null), and writes land on the new key
 * only. Tested against the pure readConfigValue over a fake store — the
 * electron-store instance needs an Electron runtime.
 */
import { describe, it, expect, vi } from 'vitest'

// config.ts instantiates its electron-store and registers typed IPC at module
// level; both need an Electron runtime. Stub them — the unit under test is
// the pure fallback logic.
vi.mock('electron-store', () => ({
  default: class {
    private readonly data = new Map<string, unknown>()
    has(key: string): boolean {
      return this.data.has(key)
    }
    get(key: string, defaultValue?: unknown): unknown {
      return this.data.has(key) ? this.data.get(key) : defaultValue
    }
    set(key: string, value: unknown): void {
      this.data.set(key, value)
    }
  }
}))
vi.mock('../../typed-ipc', () => ({ typedHandle: vi.fn() }))

import { LEGACY_KEY_FALLBACKS, readConfigValue, type AppConfigStore } from '../config'

function fakeStore(initial: Record<string, unknown> = {}): AppConfigStore & {
  data: Map<string, unknown>
} {
  const data = new Map(Object.entries(initial))
  return {
    data,
    has: (key) => data.has(key),
    get: (key, defaultValue) => (data.has(key) ? data.get(key) : defaultValue),
    set: (key, value) => data.set(key, value)
  }
}

describe('config legacy key fallback', () => {
  it('maps both workspace keys to their legacy vault keys', () => {
    expect(LEGACY_KEY_FALLBACKS).toEqual({
      lastWorkspacePath: 'lastVaultPath',
      workspaceHistory: 'vaultHistory'
    })
  })

  it('falls back to the legacy key while the new key is absent', () => {
    const store = fakeStore({ lastVaultPath: '/vaults/notes', vaultHistory: ['/vaults/notes'] })
    expect(readConfigValue(store, 'lastWorkspacePath')).toBe('/vaults/notes')
    expect(readConfigValue(store, 'workspaceHistory')).toEqual(['/vaults/notes'])
  })

  it('a stored null on the new key does NOT resurrect the legacy value', () => {
    const store = fakeStore({ lastVaultPath: '/vaults/stale', lastWorkspacePath: null })
    expect(readConfigValue(store, 'lastWorkspacePath')).toBeNull()
  })

  it('prefers the new key once present', () => {
    const store = fakeStore({ lastVaultPath: '/old', lastWorkspacePath: '/new' })
    expect(readConfigValue(store, 'lastWorkspacePath')).toBe('/new')
  })

  it('writes land on the new key only — the legacy key is never touched', () => {
    const store = fakeStore({ lastVaultPath: '/old' })
    store.set('lastWorkspacePath', '/new')
    expect(store.data.get('lastVaultPath')).toBe('/old')
    expect(store.data.has('lastWorkspacePath')).toBe(true)
    expect(readConfigValue(store, 'lastWorkspacePath')).toBe('/new')
  })

  it('non-migrated keys read straight through with a null default', () => {
    const store = fakeStore({ accentId: 'ember' })
    expect(readConfigValue(store, 'accentId')).toBe('ember')
    expect(readConfigValue(store, 'missing')).toBeNull()
  })
})
