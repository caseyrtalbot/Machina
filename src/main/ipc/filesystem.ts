import { dialog, shell } from 'electron'
import { FileService } from '../services/file-service'
import { createVaultIgnoreFilter } from '../services/vault-watcher'
import { isExternalHttpNavigation } from '../services/external-navigation'
import { PathGuard } from '../services/path-guard'
import { getDocumentManager } from './documents'
import { teConfigPath, teStatePath, assertWithinVault, canonicalizePath } from '../utils/paths'
import { getIgnorePatterns } from '../utils/vault-config'
import { TE_DIR } from '@shared/constants'
import { typedHandle } from '../typed-ipc'
import type { VaultConfig, VaultState } from '../../shared/types'

const fileService = new FileService()

/**
 * Active vault PathGuard instance. Set when vault:init is called
 * (the first lifecycle event for any vault). Used by fs:* handlers
 * that enforce vault-scoped access.
 */
let activePathGuard: PathGuard | null = null

/** Canonicalized root of the active vault (set alongside activePathGuard). */
let activeVaultRoot: string | null = null

/** Callback invoked after vault:init completes. Set via onVaultReady(). */
let vaultReadyCallback: ((vaultPath: string) => Promise<void> | void) | null = null

/** Register a callback to fire when a vault is initialized. */
export function onVaultReady(cb: (vaultPath: string) => Promise<void> | void): void {
  vaultReadyCallback = cb
}

/** Update the active PathGuard when the vault root changes. */
function setActiveVault(vaultPath: string): void {
  activePathGuard = new PathGuard(vaultPath)
  activeVaultRoot = canonicalizePath(vaultPath)
}

/**
 * Assert that the active PathGuard exists and the path is within the vault.
 * Throws if no vault is initialized or the path escapes the vault boundary.
 */
function guardPath(path: string, channel: string): string {
  if (!activePathGuard) {
    throw new Error(`${channel} called before vault:init`)
  }
  return activePathGuard.assertWithinVault(path)
}

export function registerFilesystemIpc(): void {
  typedHandle('fs:read-file', async (args) => {
    const resolved = guardPath(args.path, 'fs:read-file')
    return fileService.readFile(resolved)
  })

  typedHandle('fs:write-file', async (args) => {
    const resolved = guardPath(args.path, 'fs:write-file')
    await fileService.writeFile(resolved, args.content)
  })

  typedHandle('fs:file-mtime', async (args) => {
    const resolved = guardPath(args.path, 'fs:file-mtime')
    return fileService.getFileMtime(resolved)
  })

  typedHandle('fs:delete-file', async (args) => {
    const resolved = guardPath(args.path, 'fs:delete-file')
    await fileService.deleteFile(resolved)
  })

  typedHandle('fs:list-files', async (args) => {
    const resolved = guardPath(args.dir, 'fs:list-files')
    return fileService.listFiles(resolved, args.pattern)
  })

  typedHandle('fs:file-exists', async (args) => {
    const resolved = guardPath(args.path, 'fs:file-exists')
    const { existsSync } = await import('node:fs')
    return existsSync(resolved)
  })

  typedHandle('fs:select-vault', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  typedHandle('fs:rename-file', async (args) => {
    const resolvedOld = guardPath(args.oldPath, 'fs:rename-file')
    const resolvedNew = guardPath(args.newPath, 'fs:rename-file')
    const { rename } = await import('node:fs/promises')
    await rename(resolvedOld, resolvedNew)
    // Re-key any open documents so the next autosave targets the new path
    // instead of resurrecting the old file.
    getDocumentManager().rename(args.oldPath, args.newPath)
  })

  typedHandle('fs:copy-file', async (args) => {
    const resolvedSrc = guardPath(args.srcPath, 'fs:copy-file')
    const resolvedDest = guardPath(args.destPath, 'fs:copy-file')
    const { copyFile } = await import('node:fs/promises')
    await copyFile(resolvedSrc, resolvedDest)
  })

  typedHandle('fs:mkdir', async (args) => {
    const resolved = guardPath(args.path, 'fs:mkdir')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(resolved, { recursive: true })
  })

  typedHandle('vault:import-asset', async (args) => {
    if (!activePathGuard || !activeVaultRoot) {
      throw new Error('vault:import-asset called before vault:init')
    }
    // The one sanctioned outside-vault read: copying user-dropped media INTO
    // the vault so every later read passes PathGuard. Sources already inside
    // the vault are referenced in place without copying.
    const { importAssetIntoVault } = await import('../utils/asset-import')
    const path = await importAssetIntoVault(args.sourcePath, activeVaultRoot, activePathGuard)
    return { path }
  })

  typedHandle('fs:read-binary', async (args) => {
    const resolved = guardPath(args.path, 'fs:read-binary')
    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(resolved)
    return buffer.toString('base64')
  })

  typedHandle('fs:list-all-files', async (args) => {
    const resolved = guardPath(args.dir, 'fs:list-all-files')
    const customPatterns = await getIgnorePatterns(resolved)
    const ignoreFilter = await createVaultIgnoreFilter(resolved, customPatterns)
    return fileService.listAllFilesRecursive(resolved, ignoreFilter)
  })

  typedHandle('fs:read-files-batch', async (args) => {
    const MAX_BATCH_SIZE = 50
    if (args.paths.length > MAX_BATCH_SIZE) {
      throw new Error(
        `fs:read-files-batch: batch size ${args.paths.length} exceeds max ${MAX_BATCH_SIZE}`
      )
    }

    const pLimit = (await import('p-limit')).default
    const limit = pLimit(8)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const results = await Promise.all(
        args.paths.map((filePath) =>
          limit(async () => {
            if (controller.signal.aborted) {
              return { path: filePath, content: null, error: 'timeout' }
            }
            try {
              const resolved = guardPath(filePath, 'fs:read-files-batch')
              const { readFile } = await import('node:fs/promises')
              const content = await readFile(resolved, 'utf-8')
              return { path: filePath, content }
            } catch (err) {
              return { path: filePath, content: null, error: String(err) }
            }
          })
        )
      )
      return results
    } finally {
      clearTimeout(timeout)
    }
  })

  // --- App-level (no vault guard) ---

  typedHandle('app:path-exists', async (args) => {
    const { existsSync } = await import('node:fs')
    return existsSync(args.path)
  })

  // --- Vault data ---

  typedHandle('vault:init', async (args) => {
    // Canonicalize once (symlinks resolved, NFC) and return the result so
    // PathGuard, the watcher root, the vault index, and the renderer all share
    // one path namespace. Otherwise on symlinked vault paths agent writes
    // index under the canonical path while the watcher echo refreshes the
    // raw-path entry, leaving duplicate notes in MCP search/graph.
    const vaultPath = canonicalizePath(args.vaultPath)
    setActiveVault(vaultPath)
    await fileService.initVault(vaultPath)
    // Await so index/MCP/health wiring completes before vault:init resolves and
    // any rejection propagates to the renderer instead of going unhandled.
    await vaultReadyCallback?.(vaultPath)
    return vaultPath
  })

  typedHandle('vault:read-config', async (args) => {
    const configPath = teConfigPath(args.vaultPath)
    assertWithinVault(args.vaultPath, configPath)
    const content = await fileService.readFile(configPath)
    try {
      return JSON.parse(content) as VaultConfig
    } catch {
      throw new Error(`Vault config is corrupted. Delete ${TE_DIR}/config.json to reset.`)
    }
  })

  typedHandle('vault:read-state', async (args) => {
    const statePath = teStatePath(args.vaultPath)
    assertWithinVault(args.vaultPath, statePath)
    const content = await fileService.readFile(statePath)
    try {
      return JSON.parse(content) as VaultState
    } catch {
      throw new Error(`Vault state is corrupted. Delete ${TE_DIR}/state.json to reset.`)
    }
  })

  typedHandle('vault:write-state', async (args) => {
    const statePath = teStatePath(args.vaultPath)
    assertWithinVault(args.vaultPath, statePath)
    await fileService.writeFile(statePath, JSON.stringify(args.state, null, 2))
  })

  typedHandle('vault:list-system-artifacts', async (args) => {
    return fileService.listSystemArtifactFiles(args.vaultPath, args.kind)
  })

  // --- Shell integration ---

  typedHandle('shell:show-in-folder', async (args) => {
    try {
      const resolved = guardPath(args.path, 'shell:show-in-folder')
      shell.showItemInFolder(resolved)
    } catch (err) {
      // Recent-vault roots (VaultSelector "Reveal in Finder") are outside the
      // active vault by definition. Allow exact matches against the persisted
      // vault history; everything else stays guarded.
      const { readAppConfigValue } = await import('./config')
      const history = readAppConfigValue<readonly string[]>('vaultHistory') ?? []
      if (!history.includes(args.path)) throw err
      shell.showItemInFolder(args.path)
    }
  })

  typedHandle('shell:open-path', async (args) => {
    const resolved = guardPath(args.path, 'shell:open-path')
    return shell.openPath(resolved)
  })

  typedHandle('shell:open-external', async (args) => {
    if (!isExternalHttpNavigation(args.url)) {
      throw new Error('shell:open-external only accepts http(s) URLs')
    }
    await shell.openExternal(args.url)
  })

  typedHandle('shell:trash-item', async (args) => {
    const resolved = guardPath(args.path, 'shell:trash-item')
    await shell.trashItem(resolved)
  })
}
