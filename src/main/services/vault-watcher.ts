import { watch, type FSWatcher } from 'chokidar'
import { EventBatcher, type BatchedEvent } from './event-batcher'

export type FileEvent = 'add' | 'change' | 'unlink'
export type FileChangeCallback = (path: string, event: FileEvent) => void
export type BatchChangeCallback = (events: BatchedEvent[]) => void

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.thought-engine',
  'dist',
  'build',
  'out',
  '.git',
  '.DS_Store'
] as const

export function buildIgnorePatterns(custom: readonly string[]): string[] {
  const set = new Set<string>([...DEFAULT_IGNORE_PATTERNS])
  for (const pattern of custom) {
    set.add(pattern)
  }
  return Array.from(set)
}

function patternsToChokidarIgnored(patterns: readonly string[]): RegExp[] {
  return [
    /(^|[/\\])\../,
    ...patterns.map(
      (p) => new RegExp(`(^|[/\\\\])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[/\\\\])`)
    )
  ]
}

const BATCH_INTERVAL_MS = 50

export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private batcher: EventBatcher | null = null

  async start(
    vaultPath: string,
    onBatch: BatchChangeCallback,
    customIgnorePatterns: readonly string[] = []
  ): Promise<void> {
    await this.stop()

    this.batcher = new EventBatcher(onBatch, BATCH_INTERVAL_MS)

    this.watcher = watch(vaultPath, {
      ignored: patternsToChokidarIgnored(buildIgnorePatterns(customIgnorePatterns)),
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    })

    const enqueue = (event: FileEvent) => (path: string) => {
      this.batcher?.enqueue(path, event)
    }

    this.watcher
      .on('add', enqueue('add'))
      .on('change', enqueue('change'))
      .on('unlink', enqueue('unlink'))
      .on('error', (err) => console.error('Vault watcher error:', err))
  }

  async stop(): Promise<void> {
    if (this.batcher) {
      this.batcher.stop()
      this.batcher = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
