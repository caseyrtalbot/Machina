import { watch, type FSWatcher } from 'chokidar'
import { extname } from 'path'

export type FileEvent = 'add' | 'change' | 'unlink'
export type FileChangeCallback = (path: string, event: FileEvent) => void

export class VaultWatcher {
  private watcher: FSWatcher | null = null

  async start(vaultPath: string, onChange: FileChangeCallback): Promise<void> {
    await this.stop()

    this.watcher = watch(vaultPath, {
      ignored: [/(^|[/\\])\../, /node_modules/],
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
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
