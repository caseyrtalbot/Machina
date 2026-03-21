import type { CanvasNode } from '@shared/canvas-types'
import { createCanvasNode } from '@shared/canvas-types'
import type { ProjectSessionEvent } from '@shared/project-canvas-types'
import type { ZoneLabel } from '../canvas/claude/claude-canvas-layout'

const FILE_CARD_W = 240
const FILE_CARD_H = 80
const FILE_CARD_W_LARGE = 280
const FILE_CARD_H_LARGE = 100
const TERMINAL_W = 500
const TERMINAL_H = 350
const GAP_X = 16
const GAP_Y = 12
const ZONE_GAP = 60
const COLS_PER_GROUP = 4
const TERMINAL_ZONE_X = 0
const FILE_ZONE_X = TERMINAL_W + ZONE_GAP + 100

/** Group session events by the top-level directory of each file. */
function groupByDirectory(
  events: readonly ProjectSessionEvent[],
  projectPath: string
): Map<string, { relativePath: string; touchCount: number; lastSessionId: string }[]> {
  const fileMap = new Map<
    string,
    { relativePath: string; touchCount: number; lastSessionId: string }
  >()

  for (const event of events) {
    if (!event.filePath) continue
    const rel = event.filePath.startsWith(projectPath)
      ? event.filePath.slice(projectPath.length + 1)
      : event.filePath

    const existing = fileMap.get(rel)
    if (existing) {
      existing.touchCount++
      existing.lastSessionId = event.sessionId
    } else {
      fileMap.set(rel, { relativePath: rel, touchCount: 1, lastSessionId: event.sessionId })
    }
  }

  const groups = new Map<
    string,
    { relativePath: string; touchCount: number; lastSessionId: string }[]
  >()

  for (const file of fileMap.values()) {
    const parts = file.relativePath.split('/')
    const dir = parts.length > 1 ? parts[0] : '.'
    const group = groups.get(dir) ?? []
    group.push(file)
    groups.set(dir, group)
  }

  return groups
}

function extensionToLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'shell'
  }
  return map[ext] ?? ext
}

interface LayoutResult {
  readonly nodes: readonly CanvasNode[]
  readonly labels: readonly ZoneLabel[]
}

export function layoutProjectCanvas(
  sessionEvents: readonly ProjectSessionEvent[],
  projectPath: string,
  _containerSize: { width: number; height: number },
  terminalCount = 1
): LayoutResult {
  const allNodes: CanvasNode[] = []
  const labels: ZoneLabel[] = []

  // --- Terminal Zone (left side) ---
  labels.push({
    text: 'Terminals',
    x: TERMINAL_ZONE_X,
    y: -28,
    color: '#94e2d5'
  })

  for (let i = 0; i < terminalCount; i++) {
    allNodes.push(
      createCanvasNode(
        'terminal',
        { x: TERMINAL_ZONE_X, y: i * (TERMINAL_H + GAP_Y) },
        {
          size: { width: TERMINAL_W, height: TERMINAL_H },
          content: '',
          metadata: { initialCwd: projectPath }
        }
      )
    )
  }

  // --- File Zone (center, grouped by directory) ---
  const groups = groupByDirectory(sessionEvents, projectPath)

  let cursorY = 0
  const LABEL_OFFSET = -24
  const maxFiles = 50
  let fileCount = 0

  // Sort groups by total touches (most active first)
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const totalA = a[1].reduce((sum, f) => sum + f.touchCount, 0)
    const totalB = b[1].reduce((sum, f) => sum + f.touchCount, 0)
    return totalB - totalA
  })

  for (const [dirName, files] of sortedGroups) {
    if (fileCount >= maxFiles) break

    // Sort files within group by touch count descending
    const sorted = [...files].sort((a, b) => b.touchCount - a.touchCount)

    labels.push({
      text: dirName === '.' ? 'Root' : dirName,
      x: FILE_ZONE_X,
      y: cursorY + LABEL_OFFSET,
      color: '#89b4fa'
    })

    for (let i = 0; i < sorted.length && fileCount < maxFiles; i++) {
      const file = sorted[i]
      const col = i % COLS_PER_GROUP
      const row = Math.floor(i / COLS_PER_GROUP)
      const isHighTouch = file.touchCount >= 5
      const w = isHighTouch ? FILE_CARD_W_LARGE : FILE_CARD_W
      const h = isHighTouch ? FILE_CARD_H_LARGE : FILE_CARD_H
      const x = FILE_ZONE_X + col * (FILE_CARD_W_LARGE + GAP_X)
      const y = cursorY + row * (FILE_CARD_H_LARGE + GAP_Y)

      allNodes.push(
        createCanvasNode(
          'project-file',
          { x, y },
          {
            size: { width: w, height: h },
            content: file.relativePath,
            metadata: {
              filePath: `${projectPath}/${file.relativePath}`,
              relativePath: file.relativePath,
              language: extensionToLanguage(file.relativePath),
              touchCount: file.touchCount,
              lastTouchedBy: file.lastSessionId
            }
          }
        )
      )
      fileCount++
    }

    const rowCount = Math.ceil(
      Math.min(sorted.length, maxFiles - fileCount + sorted.length) / COLS_PER_GROUP
    )
    cursorY += rowCount * (FILE_CARD_H_LARGE + GAP_Y) + ZONE_GAP
  }

  return { nodes: allNodes, labels }
}
