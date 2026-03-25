import { readFile, writeFile, unlink, readdir, mkdir, rename, stat, realpath } from 'fs/promises'
import { join, extname, dirname } from 'path'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  teDirPath,
  teConfigPath,
  teStatePath,
  teArtifactsDirPath,
  teArtifactKindDirPath,
  teArtifactPath
} from '../utils/paths'
import { shouldIgnore } from './gitignore-filter'
import type { Ignore } from 'ignore'
import type { VaultConfig, VaultState } from '../../shared/types'
import {
  SYSTEM_ARTIFACT_KINDS,
  defaultSystemArtifactFilename,
  type SystemArtifactKind
} from '@shared/system-artifacts'

const IGNORED_PROJECT_DIRS = new Set(['node_modules', 'out', 'dist', 'build'])

export class FileService {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    const tmpPath = join(tmpdir(), `te-write-${randomUUID()}.tmp`)
    try {
      await writeFile(tmpPath, content, 'utf-8')
      await rename(tmpPath, path)
    } catch (err: unknown) {
      // Cross-device rename: fall back to same-directory atomic write
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        const localTmp = path + '.tmp'
        await writeFile(localTmp, content, 'utf-8')
        await rename(localTmp, path)
      } else {
        throw err
      }
    }
  }

  async getFileMtime(path: string): Promise<string | null> {
    try {
      const s = await stat(path)
      return s.mtime.toISOString()
    } catch {
      return null
    }
  }

  async deleteFile(path: string): Promise<void> {
    await unlink(path)
  }

  private async listMarkdownFilesRecursive(dir: string, skipHidden: boolean): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const results: string[] = []

    for (const entry of entries) {
      if (skipHidden && entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await this.listMarkdownFilesRecursive(fullPath, skipHidden)))
        continue
      }

      if (entry.isFile() && extname(entry.name) === '.md') {
        results.push(fullPath)
      }
    }

    return results
  }

  async listFiles(dir: string, pattern?: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => join(dir, e.name))
    if (pattern === '*.md') return files.filter((f) => extname(f) === '.md')
    return files
  }

  async listFilesRecursive(dir: string): Promise<string[]> {
    return this.listMarkdownFilesRecursive(dir, true)
  }

  async listAllFilesRecursive(dir: string, ignoreFilter?: Ignore): Promise<string[]> {
    const results: string[] = []
    const pendingDirs = [dir]
    const seenDirs = new Set<string>()

    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop()
      if (!currentDir) continue

      try {
        const resolvedCurrentDir = await realpath(currentDir)
        if (seenDirs.has(resolvedCurrentDir)) continue
        seenDirs.add(resolvedCurrentDir)
      } catch {
        // If the directory disappears or cannot be resolved, skip it.
      }

      let entries
      try {
        entries = await readdir(currentDir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)

        // When an ignore filter is provided, use it for all filtering.
        // Otherwise fall back to the legacy hardcoded checks.
        if (ignoreFilter) {
          if (shouldIgnore(ignoreFilter, dir, fullPath)) continue
        } else {
          if (entry.name.startsWith('.')) continue
          if (IGNORED_PROJECT_DIRS.has(entry.name)) continue
        }

        if (entry.isFile()) {
          results.push(fullPath)
          continue
        }

        if (entry.isDirectory()) {
          pendingDirs.push(fullPath)
          continue
        }

        if (!entry.isSymbolicLink()) continue

        try {
          const resolvedPath = await realpath(fullPath)
          const realStat = await stat(fullPath)
          if (realStat.isDirectory()) {
            if (!seenDirs.has(resolvedPath)) {
              pendingDirs.push(fullPath)
            }
          } else if (realStat.isFile()) {
            results.push(fullPath)
          }
        } catch {
          // Broken symlink, skip
        }
      }
    }

    return results
  }

  async initVault(vaultPath: string): Promise<void> {
    const teDir = teDirPath(vaultPath)
    if (!existsSync(teDir)) {
      await mkdir(teDir, { recursive: true })
    }

    const artifactsDir = teArtifactsDirPath(vaultPath)
    if (!existsSync(artifactsDir)) {
      await mkdir(artifactsDir, { recursive: true })
    }

    for (const kind of SYSTEM_ARTIFACT_KINDS) {
      const kindDir = teArtifactKindDirPath(vaultPath, kind)
      if (!existsSync(kindDir)) {
        await mkdir(kindDir, { recursive: true })
      }
    }

    const defaultConfig: VaultConfig = {
      version: 1,
      fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      workspaces: [],
      createdAt: new Date().toISOString()
    }

    const defaultState: VaultState = {
      version: 1,
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

  async listSystemArtifactFiles(vaultPath: string, kind?: SystemArtifactKind): Promise<string[]> {
    const dirs = kind
      ? [teArtifactKindDirPath(vaultPath, kind)]
      : SYSTEM_ARTIFACT_KINDS.map((artifactKind) => teArtifactKindDirPath(vaultPath, artifactKind))

    const results = await Promise.all(
      dirs.map((dir) => this.listMarkdownFilesRecursive(dir, false))
    )
    return results.flat().sort()
  }

  async createSystemArtifact(
    vaultPath: string,
    kind: SystemArtifactKind,
    filename: string,
    content: string
  ): Promise<string> {
    const targetPath = teArtifactPath(vaultPath, kind, defaultSystemArtifactFilename(filename))
    await mkdir(dirname(targetPath), { recursive: true })
    await this.writeFile(targetPath, content)
    return targetPath
  }

  async updateSystemArtifact(path: string, content: string): Promise<void> {
    await this.writeFile(path, content)
  }
}
