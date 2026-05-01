import fs from 'node:fs/promises'
import path from 'node:path'
import {
  TE_DIR,
  THREADS_DIR,
  THREADS_ARCHIVE_DIR,
  THREADS_CONFIG_FILE
} from '../../shared/constants'
import type { Thread } from '../../shared/thread-types'
import {
  DEFAULT_VAULT_MACHINA_CONFIG,
  type VaultMachinaConfig
} from '../../shared/thread-storage-types'
import { encodeThread, decodeThread } from './thread-md'

export class ThreadStorage {
  constructor(private readonly vaultPath: string) {}

  private threadsRoot() {
    return path.join(this.vaultPath, TE_DIR, THREADS_DIR)
  }

  private archiveRoot() {
    return path.join(this.vaultPath, TE_DIR, THREADS_ARCHIVE_DIR)
  }

  private configFile() {
    return path.join(this.vaultPath, TE_DIR, THREADS_CONFIG_FILE)
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.threadsRoot(), { recursive: true })
    await fs.mkdir(this.archiveRoot(), { recursive: true })
  }

  async saveThread(t: Thread): Promise<void> {
    await this.ensureDirs()
    const file = path.join(this.threadsRoot(), `${t.id}.md`)
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, encodeThread(t), 'utf8')
    await fs.rename(tmp, file)
  }

  async readThread(id: string): Promise<Thread> {
    const file = path.join(this.threadsRoot(), `${id}.md`)
    const md = await fs.readFile(file, 'utf8')
    const t = decodeThread(md)
    return { ...t, id }
  }

  async listThreads(): Promise<Thread[]> {
    await this.ensureDirs()
    const files = (await fs.readdir(this.threadsRoot())).filter((f) => f.endsWith('.md'))
    const items = await Promise.all(
      files.map(async (f) => {
        const id = f.replace(/\.md$/, '')
        return this.readThread(id)
      })
    )
    return items.sort((a, b) => b.lastMessage.localeCompare(a.lastMessage))
  }

  async listArchived(): Promise<Thread[]> {
    await this.ensureDirs()
    const out: Thread[] = []
    const yearDirs = await safeReaddir(this.archiveRoot())
    for (const y of yearDirs) {
      const yearPath = path.join(this.archiveRoot(), y)
      const files = (await safeReaddir(yearPath)).filter((f) => f.endsWith('.md'))
      for (const f of files) {
        const id = f.replace(/\.md$/, '')
        const md = await fs.readFile(path.join(yearPath, f), 'utf8')
        out.push({ ...decodeThread(md), id })
      }
    }
    return out.sort((a, b) => b.lastMessage.localeCompare(a.lastMessage))
  }

  async archiveThread(id: string): Promise<void> {
    const t = await this.readThread(id)
    const year = new Date(t.started).getUTCFullYear().toString()
    const dst = path.join(this.archiveRoot(), year, `${id}.md`)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(path.join(this.threadsRoot(), `${id}.md`), dst)
  }

  async unarchiveThread(id: string): Promise<void> {
    const yearDirs = await safeReaddir(this.archiveRoot())
    for (const y of yearDirs) {
      const candidate = path.join(this.archiveRoot(), y, `${id}.md`)
      if (await pathExists(candidate)) {
        await fs.rename(candidate, path.join(this.threadsRoot(), `${id}.md`))
        return
      }
    }
    throw new Error(`Archived thread not found: ${id}`)
  }

  async deleteThread(id: string): Promise<void> {
    const file = path.join(this.threadsRoot(), `${id}.md`)
    await fs.rm(file, { force: true })
  }

  async readConfig(): Promise<VaultMachinaConfig> {
    try {
      const raw = await fs.readFile(this.configFile(), 'utf8')
      return { ...DEFAULT_VAULT_MACHINA_CONFIG, ...JSON.parse(raw) }
    } catch {
      return DEFAULT_VAULT_MACHINA_CONFIG
    }
  }

  async writeConfig(cfg: VaultMachinaConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configFile()), { recursive: true })
    await fs.writeFile(this.configFile(), JSON.stringify(cfg, null, 2), 'utf8')
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
