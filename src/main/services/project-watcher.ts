import { watch, type FSWatcher } from 'chokidar'
import { relative } from 'path'
import type { ProjectFileChangedEvent } from '@shared/project-canvas-types'

export type ProjectFileCallback = (event: ProjectFileChangedEvent) => void

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\/dist\//,
  /\/build\//,
  /\/\.next\//,
  /\/out\//,
  /\.DS_Store$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.ico$/,
  /\.thought-engine/
]

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(filePath))
}

export class ProjectWatcher {
  private watcher: FSWatcher | null = null
  private projectPath = ''

  async start(projectPath: string, onChange: ProjectFileCallback): Promise<void> {
    await this.stop()
    this.projectPath = projectPath

    this.watcher = watch(projectPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: /(^|[/\\])\../
    })

    const handleEvent = (event: 'add' | 'change' | 'unlink') => (path: string) => {
      if (shouldIgnore(path)) return
      const relativePath = relative(this.projectPath, path)
      onChange({ path, event, relativePath })
    }

    this.watcher
      .on('add', handleEvent('add'))
      .on('change', handleEvent('change'))
      .on('unlink', handleEvent('unlink'))
      .on('error', (err) => console.error('Project watcher error:', err))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.projectPath = ''
  }
}
