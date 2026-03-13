import { watch, type FSWatcher } from 'chokidar'
import { extname } from 'path'

export type FileEvent = 'add' | 'change' | 'unlink'
export type FileChangeCallback = (path: string, event: FileEvent) => void

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.thought-engine',
  'dist',
  'build',
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

export class VaultWatcher {
  private watcher: FSWatcher | null = null

  async start(
    vaultPath: string,
    onChange: FileChangeCallback,
    customIgnorePatterns: readonly string[] = []
  ): Promise<void> {
    await this.stop()

    this.watcher = watch(vaultPath, {
      ignored: patternsToChokidarIgnored(buildIgnorePatterns(customIgnorePatterns)),
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    })

    const handleEvent = (event: FileEvent) => (path: string) => {
      if (extname(path) === '.md') {
        onChange(path, event)
      }
    }

    this.watcher
      .on('add', handleEvent('add'))
      .on('change', handleEvent('change'))
      .on('unlink', handleEvent('unlink'))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
