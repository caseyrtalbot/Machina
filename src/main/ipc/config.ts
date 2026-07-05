import StoreModule from 'electron-store'
import { typedHandle } from '../typed-ipc'

// electron-store v11+ is ESM-only; when bundled as CJS the default
// export lands on .default.  Handle both cases for safety.
const Store = (StoreModule as { default?: typeof StoreModule }).default ?? StoreModule
const appStore = new Store({ name: 'machina-settings' })

/**
 * Workspace-generalization key migration (workstation contracts §1).
 * Reads of a new key fall back to its legacy key ONLY while the new key is
 * absent from the store: a stored null (FirstRunScreen clears by writing
 * null) must NOT resurrect the legacy value. Writes go to the new key only.
 */
export const LEGACY_KEY_FALLBACKS: Readonly<Record<string, string>> = {
  lastWorkspacePath: 'lastVaultPath',
  workspaceHistory: 'vaultHistory'
}

/** Minimal store surface so the fallback logic is unit-testable without Electron. */
export interface AppConfigStore {
  has(key: string): boolean
  get(key: string, defaultValue?: unknown): unknown
  set(key: string, value: unknown): void
}

export function readConfigValue<T>(store: AppConfigStore, key: string): T | null {
  if (store.has(key)) {
    return (store.get(key, null) as T | null) ?? null
  }
  const legacyKey = LEGACY_KEY_FALLBACKS[key]
  if (legacyKey !== undefined) {
    return (store.get(legacyKey, null) as T | null) ?? null
  }
  return (store.get(key, null) as T | null) ?? null
}

export function readAppConfigValue<T>(key: string): T | null {
  return readConfigValue<T>(appStore as AppConfigStore, key)
}

export function writeAppConfigValue(key: string, value: unknown): void {
  appStore.set(key, value)
}

export function registerConfigIpc(): void {
  typedHandle('config:read', async (args) => {
    if (args.scope === 'app') return readAppConfigValue(args.key)
    return null
  })

  typedHandle('config:write', async (args) => {
    if (args.scope === 'app') writeAppConfigValue(args.key, args.value)
  })
}
