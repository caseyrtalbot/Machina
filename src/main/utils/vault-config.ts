import { readFile } from 'node:fs/promises'
import { teConfigPath } from './paths'
import type { VaultConfig } from '@shared/types'

/** Read and parse the vault's TE config, or null when the file is missing or malformed. */
export async function readVaultConfig(vaultPath: string): Promise<VaultConfig | null> {
  try {
    return JSON.parse(await readFile(teConfigPath(vaultPath), 'utf-8')) as VaultConfig
  } catch {
    return null
  }
}

/** Custom watcher ignore globs from the vault config, or [] when unset. */
export async function getIgnorePatterns(vaultPath: string): Promise<string[]> {
  const config = await readVaultConfig(vaultPath)
  return config?.watcher?.ignorePatterns ?? []
}
