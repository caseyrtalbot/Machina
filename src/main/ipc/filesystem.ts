import { dialog, shell } from 'electron'
import { FileService } from '../services/file-service'
import { createVaultIgnoreFilter } from '../services/vault-watcher'
import { teConfigPath, teStatePath, assertWithinVault } from '../utils/paths'
import { TE_DIR } from '@shared/constants'
import { typedHandle } from '../typed-ipc'
import type { VaultConfig, VaultState } from '../../shared/types'

const fileService = new FileService()

export function registerFilesystemIpc(): void {
  typedHandle('fs:read-file', async (args) => {
    return fileService.readFile(args.path)
  })

  typedHandle('fs:write-file', async (args) => {
    await fileService.writeFile(args.path, args.content)
  })

  typedHandle('fs:file-mtime', async (args) => {
    return fileService.getFileMtime(args.path)
  })

  typedHandle('fs:delete-file', async (args) => {
    await fileService.deleteFile(args.path)
  })

  typedHandle('fs:list-files', async (args) => {
    return fileService.listFiles(args.dir, args.pattern)
  })

  typedHandle('fs:list-files-recursive', async (args) => {
    return fileService.listFilesRecursive(args.dir)
  })

  typedHandle('fs:file-exists', async (args) => {
    const { existsSync } = await import('node:fs')
    return existsSync(args.path)
  })

  typedHandle('fs:select-vault', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  typedHandle('fs:rename-file', async (args) => {
    const { rename } = await import('node:fs/promises')
    await rename(args.oldPath, args.newPath)
  })

  typedHandle('fs:copy-file', async (args) => {
    const { copyFile } = await import('node:fs/promises')
    await copyFile(args.srcPath, args.destPath)
  })

  typedHandle('fs:create-folder', async (args) => {
    const result = await dialog.showOpenDialog({
      defaultPath: args.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  typedHandle('fs:mkdir', async (args) => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(args.path, { recursive: true })
  })

  typedHandle('fs:read-binary', async (args) => {
    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(args.path)
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

  // --- Vault data ---

  typedHandle('vault:init', async (args) => {
    await fileService.initVault(args.vaultPath)
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
    const { readdir } = await import('node:fs/promises')
    try {
      const entries = await readdir(args.dirPath)
      return entries.filter((f) => f.endsWith('.md')).map((f) => `${args.dirPath}/${f}`)
    } catch {
      return []
    }
  })

  typedHandle('vault:read-file', async (args) => {
    const { readFile } = await import('node:fs/promises')
    return readFile(args.filePath, 'utf-8')
  })

  typedHandle('vault:list-system-artifacts', async (args) => {
    return fileService.listSystemArtifactFiles(args.vaultPath, args.kind)
  })

  typedHandle('vault:read-system-artifact', async (args) => {
    assertWithinVault(args.vaultPath, args.path)
    return fileService.readFile(args.path)
  })

  typedHandle('vault:create-system-artifact', async (args) => {
    const path = await fileService.createSystemArtifact(
      args.vaultPath,
      args.kind,
      args.filename,
      args.content
    )
    assertWithinVault(args.vaultPath, path)
    return path
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
