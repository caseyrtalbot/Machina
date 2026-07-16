import fs from 'node:fs/promises'
import path from 'node:path'
import {
  TE_DIR,
  THREADS_DIR,
  THREADS_ARCHIVE_DIR,
  THREADS_CONFIG_FILE
} from '../../shared/constants'
import type { Thread, ThreadMessage } from '../../shared/thread-types'
import {
  DEFAULT_VAULT_MACHINA_CONFIG,
  type VaultMachinaConfig
} from '../../shared/thread-storage-types'
import { encodeThread, decodeThread } from './thread-md'
import { atomicWrite } from '../utils/atomic-write'
import { enqueueThreadWrite } from './thread-write-queue'
import { isCliAgentIdentity } from './cli-thread-spawner'

const SAFE_ID = /^[a-z0-9-]+$/

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Invalid thread id: ${JSON.stringify(id)}`)
  }
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

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
    assertSafeId(t.id)
    await enqueueThreadWrite(this.vaultPath, t.id, () => this.writeThreadFile(t))
  }

  /** Encode + tmp + rename. Callers own serialization via the write queue. */
  private async writeThreadFile(t: Thread): Promise<void> {
    await this.ensureDirs()
    const file = path.join(this.threadsRoot(), `${t.id}.md`)
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, encodeThread(t), 'utf8')
    await fs.rename(tmp, file)
  }

  /**
   * Main-side message append (P3 step 4, contracts §4 v1.3.3): the single
   * writer of CLI-thread MESSAGES. Read-modify-write is mandatory — thread
   * files are sentinel-delimited markdown, no O_APPEND. ENOENT → false
   * (thread deleted/archived; deletion wins, never recreate). Any other
   * fs/decode failure propagates — the caller's try/catch is the diagnostic
   * boundary.
   */
  async appendMessage(id: string, message: ThreadMessage): Promise<boolean> {
    assertSafeId(id)
    return enqueueThreadWrite(this.vaultPath, id, async () => {
      let disk: Thread
      try {
        disk = await this.readThread(id)
      } catch (err) {
        if (isEnoent(err)) return false
        throw err
      }
      await this.writeThreadFile({
        ...disk,
        messages: [...disk.messages, message],
        lastMessage: message.sentAt
      })
      return true
    })
  }

  /**
   * The 'thread:save' boundary (P3 step 4, contracts §4 v1.3.3). Authority is
   * derived from the ON-DISK thread inside the write queue — never from the
   * renderer payload: a payload relabeling an existing cli thread as
   * machina-native must not buy back the whole-save clobber/double-persist
   * paths, so `agent` is immutable after mint (disk wins on both branches).
   * Disk cli thread → metadata-only merge: `messages` are ALWAYS taken from
   * disk (main is their authority), `lastMessage` is the later of the two ISO
   * stamps; every other field comes from the caller. Disk native thread →
   * whole-save. Missing file + cli payload → no-op (a meta-save never mints);
   * missing file + native payload keeps the pre-existing whole-save mint.
   */
  async saveThreadFromRenderer(t: Thread): Promise<void> {
    assertSafeId(t.id)
    await enqueueThreadWrite(this.vaultPath, t.id, async () => {
      let disk: Thread | null
      try {
        disk = await this.readThread(t.id)
      } catch (err) {
        if (!isEnoent(err)) throw err
        disk = null
      }
      if (disk === null) {
        if (!isCliAgentIdentity(t.agent)) await this.writeThreadFile(t)
        return
      }
      if (!isCliAgentIdentity(disk.agent)) {
        await this.writeThreadFile({ ...t, agent: disk.agent })
        return
      }
      await this.writeThreadFile({
        ...t,
        agent: disk.agent,
        messages: disk.messages,
        // Plain > is correct: every writer stamps toISOString() (listThreads
        // already sorts these lexically).
        lastMessage: disk.lastMessage > t.lastMessage ? disk.lastMessage : t.lastMessage
      })
    })
  }

  async readThread(id: string): Promise<Thread> {
    assertSafeId(id)
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
    assertSafeId(id)
    await enqueueThreadWrite(this.vaultPath, id, async () => {
      const t = await this.readThread(id)
      const year = new Date(t.started).getUTCFullYear().toString()
      const dst = path.join(this.archiveRoot(), year, `${id}.md`)
      await fs.mkdir(path.dirname(dst), { recursive: true })
      await fs.rename(path.join(this.threadsRoot(), `${id}.md`), dst)
    })
  }

  async unarchiveThread(id: string): Promise<void> {
    assertSafeId(id)
    await enqueueThreadWrite(this.vaultPath, id, async () => {
      const yearDirs = await safeReaddir(this.archiveRoot())
      for (const y of yearDirs) {
        const candidate = path.join(this.archiveRoot(), y, `${id}.md`)
        if (await pathExists(candidate)) {
          await fs.rename(candidate, path.join(this.threadsRoot(), `${id}.md`))
          return
        }
      }
      throw new Error(`Archived thread not found: ${id}`)
    })
  }

  async deleteThread(id: string): Promise<void> {
    assertSafeId(id)
    await enqueueThreadWrite(this.vaultPath, id, async () => {
      const file = path.join(this.threadsRoot(), `${id}.md`)
      await fs.rm(file, { force: true })
    })
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
    await atomicWrite(this.configFile(), JSON.stringify(cfg, null, 2))
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
