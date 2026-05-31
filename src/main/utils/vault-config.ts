import { readFile } from 'node:fs/promises'
import { teConfigPath } from './paths'
import type { VaultConfig } from '@shared/types'

/**
 * Read and parse the vault's TE config. Returns null when the file is missing
 * or malformed — every caller treats "no config" as "use defaults", so
 * swallowing here removes three copies of the same try/parse/catch block.
 *
 * Electron-free (raw fs + JSON) so it stays usable from the headless mcp-cli
 * path as well as the IPC handlers.
 */
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
