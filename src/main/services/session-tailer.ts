import type { BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { readdir, stat, open } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { toDirKey, extractToolEvents } from './session-utils'
import { groupEventsIntoMilestones } from './session-milestone-grouper'
import { typedSend } from '../typed-ipc'
import type { SessionMilestone } from '@shared/project-canvas-types'

const SESSION_CHECK_INTERVAL_MS = 5000

export class SessionTailer {
  private readonly mainWindow: BrowserWindow
  private watcher: FSWatcher | null = null
  private currentFile: string | null = null
  private fileOffset = 0
  private lineBuffer = ''
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private claudeDir = ''
  private hasEmittedDetected = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  async start(projectPath: string): Promise<void> {
    await this.stop()

    const dirKey = toDirKey(projectPath)
    this.claudeDir = join(homedir(), '.claude', 'projects', dirKey)

    const file = await this.findMostRecentSession()
    if (!file) return

    await this.tailFile(file)

    this.checkInterval = setInterval(async () => {
      const newest = await this.findMostRecentSession()
      if (newest && newest !== this.currentFile) {
        await this.tailFile(newest)
        const milestone: SessionMilestone = {
          id: randomUUID(),
          type: 'session-switched',
          timestamp: Date.now(),
          summary: 'New session detected',
          files: [],
          events: []
        }
        typedSend(this.mainWindow, 'session:milestone', milestone)
      }
    }, SESSION_CHECK_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.currentFile = null
    this.fileOffset = 0
    this.lineBuffer = ''
    this.hasEmittedDetected = false
  }

  private async findMostRecentSession(): Promise<string | null> {
    try {
      const entries = await readdir(this.claudeDir)
      const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'))
      if (jsonlFiles.length === 0) return null

      let newest: { file: string; mtime: number } | null = null
      for (const f of jsonlFiles) {
        const fullPath = join(this.claudeDir, f)
        try {
          const s = await stat(fullPath)
          if (!newest || s.mtimeMs > newest.mtime) {
            newest = { file: fullPath, mtime: s.mtimeMs }
          }
        } catch {
          /* stat error, skip */
        }
      }
      return newest?.file ?? null
    } catch {
      return null
    }
  }

  private async tailFile(filePath: string): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    this.currentFile = filePath
    this.lineBuffer = ''

    // Seek to end so existing content is not processed
    try {
      const s = await stat(filePath)
      this.fileOffset = s.size
    } catch {
      this.fileOffset = 0
    }

    if (!this.hasEmittedDetected) {
      this.hasEmittedDetected = true
      typedSend(this.mainWindow, 'session:detected', { active: true })
    }

    this.watcher = watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
      usePolling: true,
      interval: 100
    })

    this.watcher.on('change', () => {
      void this.readNewContent()
    })
  }

  private async readNewContent(): Promise<void> {
    if (!this.currentFile) return

    try {
      const fh = await open(this.currentFile, 'r')
      try {
        const s = await fh.stat()
        if (s.size <= this.fileOffset) return

        const bytesToRead = s.size - this.fileOffset
        const buffer = Buffer.alloc(bytesToRead)
        await fh.read(buffer, 0, bytesToRead, this.fileOffset)
        this.fileOffset = s.size

        const text = this.lineBuffer + buffer.toString('utf-8')
        const lines = text.split('\n')

        // Last element is either empty (ended with \n) or incomplete line
        this.lineBuffer = lines.pop() ?? ''

        const allEvents = lines.filter((l) => l.trim()).flatMap((l) => extractToolEvents(l))

        if (allEvents.length > 0) {
          const milestones = groupEventsIntoMilestones(allEvents)
          for (const milestone of milestones) {
            typedSend(this.mainWindow, 'session:milestone', milestone)
          }
        }
      } finally {
        await fh.close()
      }
    } catch {
      // File read error - will retry on next change event
    }
  }
}
