import type { BrowserWindow } from 'electron'
import { readdir, stat } from 'fs/promises'
import { join, extname, relative } from 'path'
import { ProjectWatcher } from '../services/project-watcher'
import { ProjectSessionParser } from '../services/project-session-parser'
import { typedHandle, typedSend } from '../typed-ipc'
import type { ProjectFileInfo } from '@shared/project-canvas-types'

const watcher = new ProjectWatcher()
const parser = new ProjectSessionParser()

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.thought-engine',
  '.DS_Store'
])

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.md': 'markdown',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.sh': 'shell',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
  '.graphql': 'graphql'
}

async function listProjectFiles(projectPath: string, maxDepth = 4): Promise<ProjectFileInfo[]> {
  const files: ProjectFileInfo[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue
      const fullPath = join(dir, entry)
      try {
        const s = await stat(fullPath)
        if (s.isDirectory()) {
          await walk(fullPath, depth + 1)
        } else {
          const ext = extname(entry)
          files.push({
            path: fullPath,
            relativePath: relative(projectPath, fullPath),
            language: (LANGUAGE_MAP[ext] ?? ext.slice(1)) || 'unknown',
            size: s.size,
            lastModified: s.mtimeMs,
            touchCount: 0,
            lastTouchedBy: null
          })
        }
      } catch {
        // stat error
      }
    }
  }

  await walk(projectPath, 0)
  return files
}

export function registerProjectIpc(mainWindow: BrowserWindow): void {
  typedHandle('project:watch-start', async (args) => {
    await watcher.start(args.projectPath, (event) => {
      typedSend(mainWindow, 'project:file-changed', event)
    })
  })

  typedHandle('project:watch-stop', async () => {
    await watcher.stop()
  })

  typedHandle('project:parse-sessions', async (args) => {
    return parser.parse(args.projectPath)
  })

  typedHandle('project:list-files', async (args) => {
    return listProjectFiles(args.projectPath)
  })
}

export function getProjectWatcher(): ProjectWatcher {
  return watcher
}
