import { dialog, shell } from 'electron'
import { FileService } from '../services/file-service'
import { createVaultIgnoreFilter } from '../services/vault-watcher'
import { PathGuard } from '../services/path-guard'
import { teConfigPath, teStatePath, teArtifactPath, assertWithinVault } from '../utils/paths'
import { defaultSystemArtifactFilename } from '@shared/system-artifacts'
import { TE_DIR } from '@shared/constants'
import { typedHandle } from '../typed-ipc'
import type { VaultConfig, VaultState } from '../../shared/types'

const fileService = new FileService()

/**
 * Active vault PathGuard instance. Set when vault:init is called
 * (the first lifecycle event for any vault). Used by vault:read-file
 * and fs:* handlers that enforce vault-scoped access.
 */
let activePathGuard: PathGuard | null = null

/** Callback invoked after vault:init completes. Set via onVaultReady(). */
let vaultReadyCallback: ((vaultPath: string) => void) | null = null

/** Register a callback to fire when a vault is initialized. */
export function onVaultReady(cb: (vaultPath: string) => void): void {
  vaultReadyCallback = cb
}

/** Update the active PathGuard when the vault root changes. */
function setActiveVault(vaultPath: string): void {
  activePathGuard = new PathGuard(vaultPath)
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

  typedHandle('fs:list-files-recursive', async (args) => {
    const resolved = guardPath(args.dir, 'fs:list-files-recursive')
    return fileService.listFilesRecursive(resolved)
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
  })

  typedHandle('fs:copy-file', async (args) => {
    const resolvedSrc = guardPath(args.srcPath, 'fs:copy-file')
    const resolvedDest = guardPath(args.destPath, 'fs:copy-file')
    const { copyFile } = await import('node:fs/promises')
    await copyFile(resolvedSrc, resolvedDest)
  })

  typedHandle('fs:create-folder', async (args) => {
    const result = await dialog.showOpenDialog({
      defaultPath: args.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  typedHandle('fs:mkdir', async (args) => {
    const resolved = guardPath(args.path, 'fs:mkdir')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(resolved, { recursive: true })
  })

  typedHandle('fs:read-binary', async (args) => {
    const resolved = guardPath(args.path, 'fs:read-binary')
    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(resolved)
    return buffer.toString('base64')
  })

  typedHandle('fs:list-all-files', async (args) => {
    let customPatterns: string[] = []
    try {
      const configContent = await fileService.readFile(teConfigPath(args.dir))
      const config = JSON.parse(configContent)
      customPatterns = config?.watcher?.ignorePatterns ?? []
    } catch {
      // Config doesn't exist or is malformed; use defaults only
    }
    const ignoreFilter = await createVaultIgnoreFilter(args.dir, customPatterns)
    return fileService.listAllFilesRecursive(args.dir, ignoreFilter)
  })

  // --- App-level (no vault guard) ---

  typedHandle('app:path-exists', async (args) => {
    const { existsSync } = await import('node:fs')
    return existsSync(args.path)
  })

  // --- Vault data ---

  typedHandle('vault:init', async (args) => {
    setActiveVault(args.vaultPath)
    await fileService.initVault(args.vaultPath)
    vaultReadyCallback?.(args.vaultPath)
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

  typedHandle('vault:write-config', async (args) => {
    const configPath = teConfigPath(args.vaultPath)
    assertWithinVault(args.vaultPath, configPath)
    await fileService.writeFile(configPath, JSON.stringify(args.config, null, 2))
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

  typedHandle('vault:list-commands', async (args) => {
    guardPath(args.dirPath, 'vault:list-commands')
    const { readdir } = await import('node:fs/promises')
    try {
      const entries = await readdir(args.dirPath)
      return entries.filter((f) => f.endsWith('.md')).map((f) => `${args.dirPath}/${f}`)
    } catch {
      return []
    }
  })

  typedHandle('vault:read-file', async (args) => {
    const resolved = guardPath(args.filePath, 'vault:read-file')
    const { readFile } = await import('node:fs/promises')
    return readFile(resolved, 'utf-8')
  })

  typedHandle('vault:list-system-artifacts', async (args) => {
    return fileService.listSystemArtifactFiles(args.vaultPath, args.kind)
  })

  typedHandle('vault:read-system-artifact', async (args) => {
    assertWithinVault(args.vaultPath, args.path)
    return fileService.readFile(args.path)
  })

  typedHandle('vault:create-system-artifact', async (args) => {
    const expectedPath = teArtifactPath(
      args.vaultPath,
      args.kind,
      defaultSystemArtifactFilename(args.filename)
    )
    assertWithinVault(args.vaultPath, expectedPath)
    return fileService.createSystemArtifact(args.vaultPath, args.kind, args.filename, args.content)
  })

  typedHandle('vault:update-system-artifact', async (args) => {
    assertWithinVault(args.vaultPath, args.path)
    await fileService.updateSystemArtifact(args.path, args.content)
  })

  // --- Shell integration ---

  typedHandle('shell:show-in-folder', async (args) => {
    shell.showItemInFolder(args.path)
  })

  typedHandle('shell:open-path', async (args) => {
    return shell.openPath(args.path)
  })

  typedHandle('shell:trash-item', async (args) => {
    await shell.trashItem(args.path)
  })
}
