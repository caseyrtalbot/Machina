import { readFile, writeFile, unlink, readdir, mkdir, rename, stat } from 'fs/promises'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import { teDirPath, teConfigPath, teStatePath } from '../utils/paths'
import type { VaultConfig, VaultState } from '../../shared/types'

export class FileService {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    const tmpPath = path + '.tmp'
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, path)
  }

  async deleteFile(path: string): Promise<void> {
    await unlink(path)
  }

  async listFiles(dir: string, pattern?: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => join(dir, e.name))
    if (pattern === '*.md') return files.filter((f) => extname(f) === '.md')
    return files
  }

  async listFilesRecursive(dir: string): Promise<string[]> {
    const results: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        results.push(...(await this.listFilesRecursive(fullPath)))
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        results.push(fullPath)
      }
    }

    return results
  }

  async listAllFilesRecursive(dir: string): Promise<string[]> {
    const results: string[] = []
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return results
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      if (
        entry.name === 'node_modules' ||
        entry.name === 'out' ||
        entry.name === 'dist' ||
        entry.name === 'build'
      )
        continue

      // Follow symlinks: resolve the real type via stat()
      if (entry.isSymbolicLink()) {
        try {
          const realStat = await stat(fullPath)
          if (realStat.isDirectory()) {
            results.push(...(await this.listAllFilesRecursive(fullPath)))
          } else if (realStat.isFile()) {
            results.push(fullPath)
          }
        } catch {
          // Broken symlink, skip
        }
      } else if (entry.isDirectory()) {
        results.push(...(await this.listAllFilesRecursive(fullPath)))
      } else if (entry.isFile()) {
        results.push(fullPath)
      }
    }

    return results
  }

  async initVault(vaultPath: string): Promise<void> {
    const teDir = teDirPath(vaultPath)
    if (!existsSync(teDir)) {
      await mkdir(teDir, { recursive: true })
    }

    const defaultConfig: VaultConfig = {
      version: 1,
      fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      workspaces: [],
      createdAt: new Date().toISOString()
    }

    const defaultState: VaultState = {
      version: 1,
      idCounters: {},
      lastOpenNote: null,
      panelLayout: { sidebarWidth: 240, terminalWidth: 400 },
      contentView: 'editor',
      terminalSessions: [],
      fileTreeCollapseState: {},
      selectedNodeId: null,
      recentFiles: []
    }

    const configPath = teConfigPath(vaultPath)
    const statePath = teStatePath(vaultPath)

    if (!existsSync(configPath)) {
      await this.writeFile(configPath, JSON.stringify(defaultConfig, null, 2))
    }
    if (!existsSync(statePath)) {
      await this.writeFile(statePath, JSON.stringify(defaultState, null, 2))
    }
  }
}
