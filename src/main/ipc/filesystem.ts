import { ipcMain, dialog, shell } from 'electron'
import { FileService } from '../services/file-service'
import { teConfigPath, teStatePath } from '../utils/paths'
import type { VaultConfig, VaultState } from '../../shared/types'

const fileService = new FileService()

export function registerFilesystemIpc(): void {
  ipcMain.handle('fs:read-file', async (_e, args: { path: string }) => {
    return fileService.readFile(args.path)
  })

  ipcMain.handle('fs:write-file', async (_e, args: { path: string; content: string }) => {
    await fileService.writeFile(args.path, args.content)
  })

  ipcMain.handle('fs:delete-file', async (_e, args: { path: string }) => {
    await fileService.deleteFile(args.path)
  })

  ipcMain.handle('fs:list-files', async (_e, args: { dir: string; pattern?: string }) => {
    return fileService.listFiles(args.dir, args.pattern)
  })

  ipcMain.handle('fs:list-files-recursive', async (_e, args: { dir: string }) => {
    return fileService.listFilesRecursive(args.dir)
  })

  ipcMain.handle('fs:select-vault', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('vault:init', async (_e, args: { vaultPath: string }) => {
    await fileService.initVault(args.vaultPath)
  })

  ipcMain.handle('vault:read-config', async (_e, args: { vaultPath: string }) => {
    const content = await fileService.readFile(teConfigPath(args.vaultPath))
    return JSON.parse(content) as VaultConfig
  })

  ipcMain.handle(
    'vault:write-config',
    async (_e, args: { vaultPath: string; config: VaultConfig }) => {
      await fileService.writeFile(
        teConfigPath(args.vaultPath),
        JSON.stringify(args.config, null, 2)
      )
    }
  )

  ipcMain.handle('vault:read-state', async (_e, args: { vaultPath: string }) => {
    const content = await fileService.readFile(teStatePath(args.vaultPath))
    return JSON.parse(content) as VaultState
  })

  ipcMain.handle(
    'vault:write-state',
    async (_e, args: { vaultPath: string; state: VaultState }) => {
      await fileService.writeFile(teStatePath(args.vaultPath), JSON.stringify(args.state, null, 2))
    }
  )

  ipcMain.handle('vault:list-commands', async (_event, dirPath: string): Promise<string[]> => {
    const { readdir } = await import('node:fs/promises')
    try {
      const entries = await readdir(dirPath)
      return entries.filter((f) => f.endsWith('.md')).map((f) => `${dirPath}/${f}`)
    } catch {
      return []
    }
  })

  ipcMain.handle('vault:read-file', async (_event, filePath: string): Promise<string> => {
    const { readFile } = await import('node:fs/promises')
    return readFile(filePath, 'utf-8')
  })

  // ── Shell integration ──

  ipcMain.handle('shell:show-in-folder', async (_e, args: { path: string }) => {
    shell.showItemInFolder(args.path)
  })

  ipcMain.handle('shell:open-path', async (_e, args: { path: string }) => {
    return shell.openPath(args.path)
  })

  ipcMain.handle('shell:trash-item', async (_e, args: { path: string }) => {
    await shell.trashItem(args.path)
  })

  // ── File operations for context menu ──

  ipcMain.handle('fs:rename-file', async (_e, args: { oldPath: string; newPath: string }) => {
    const { rename } = await import('node:fs/promises')
    await rename(args.oldPath, args.newPath)
  })

  ipcMain.handle('fs:copy-file', async (_e, args: { srcPath: string; destPath: string }) => {
    const { copyFile } = await import('node:fs/promises')
    await copyFile(args.srcPath, args.destPath)
  })
}
