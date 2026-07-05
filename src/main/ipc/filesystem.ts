import { dialog, shell } from 'electron'
import { FileService } from '../services/file-service'
import { createVaultIgnoreFilter } from '../services/vault-watcher'
import { isExternalHttpNavigation } from '../services/external-navigation'
import { getWorkspaceService } from '../services/workspace-service'
import { getDocumentManager } from './documents'
import { teConfigPath, teStatePath, assertWithinVault } from '../utils/paths'
import { getIgnorePatterns } from '../utils/vault-config'
import { TE_DIR } from '@shared/constants'
import { typedHandle } from '../typed-ipc'
import type { VaultConfig, VaultState } from '../../shared/types'

const fileService = new FileService()

/**
 * Assert that a workspace is open and the path is within its root.
 * Throws if no workspace is open or the path escapes the boundary.
 * The error message keeps the legacy vault:init wording — callers and
 * tests match on it.
 */
function guardPath(path: string, channel: string): string {
  const ws = getWorkspaceService()
  if (!ws.current()) {
    throw new Error(`${channel} called before vault:init`)
  }
  return ws.guard().assertWithinVault(path)
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
    const ws = getWorkspaceService().current()
    if (!ws) {
      throw new Error('vault:import-asset called before vault:init')
    }
    // The one sanctioned outside-vault read: copying user-dropped media INTO
    // the vault so every later read passes PathGuard. Sources already inside
    // the vault are referenced in place without copying.
    const { importAssetIntoVault } = await import('../utils/asset-import')
    const path = await importAssetIntoVault(args.sourcePath, ws.root, getWorkspaceService().guard())
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
    // Legacy alias for workspace:open (kept for one release, contracts §1).
    // WorkspaceService canonicalizes, guards, scaffolds, and awaits ready
    // callbacks so any rejection propagates to the renderer.
    const ws = await getWorkspaceService().open(args.vaultPath)
    return ws.root
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
      // workspace history; everything else stays guarded.
      const { readAppConfigValue } = await import('./config')
      const history = readAppConfigValue<readonly string[]>('workspaceHistory') ?? []
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
