import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { ProjectSessionEvent } from '@shared/project-canvas-types'

/** Convert an absolute path to Claude's directory key format. */
function toDirKey(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
}

const TOOL_NAMES_WITH_PATH = new Set(['Read', 'Write', 'Edit', 'Grep'])

interface JsonlEntry {
  type?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
  }
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  id?: string
  input?: Record<string, unknown>
}

function extractToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (block): block is ToolUseBlock =>
      block && typeof block === 'object' && block.type === 'tool_use'
  )
}

export class ProjectSessionParser {
  async parse(projectPath: string): Promise<ProjectSessionEvent[]> {
    const dirKey = toDirKey(projectPath)
    const claudeProjectDir = join(homedir(), '.claude', 'projects', dirKey)
    const events: ProjectSessionEvent[] = []

    let sessionFiles: string[]
    try {
      const entries = await readdir(claudeProjectDir)
      sessionFiles = entries.filter((f) => f.endsWith('.jsonl'))
    } catch {
      return events
    }

    for (const file of sessionFiles) {
      const sessionId = file.replace('.jsonl', '')
      const filePath = join(claudeProjectDir, file)

      try {
        const fileStat = await stat(filePath)
        // Skip very large session files (>10MB) to avoid blocking
        if (fileStat.size > 10 * 1024 * 1024) continue

        const content = await readFile(filePath, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())

        for (const line of lines) {
          try {
            const entry: JsonlEntry = JSON.parse(line)
            if (entry.type !== 'assistant' && entry.message?.role !== 'assistant') continue

            const messageContent = entry.message?.content
            const toolBlocks = extractToolUseBlocks(messageContent)
            const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()

            for (const block of toolBlocks) {
              if (TOOL_NAMES_WITH_PATH.has(block.name)) {
                const filePath =
                  (block.input?.file_path as string) || (block.input?.path as string) || undefined
                if (filePath) {
                  const type =
                    block.name === 'Read'
                      ? 'file-read'
                      : block.name === 'Write'
                        ? 'file-write'
                        : block.name === 'Edit'
                          ? 'file-edit'
                          : 'file-read'
                  events.push({ type, timestamp, sessionId, filePath })
                }
              } else if (block.name === 'Bash') {
                const command = block.input?.command as string | undefined
                events.push({
                  type: 'bash-command',
                  timestamp,
                  sessionId,
                  detail: command?.slice(0, 200)
                })
              }
            }
          } catch {
            // Malformed JSONL line
          }
        }
      } catch {
        // File read error
      }
    }

    events.sort((a, b) => a.timestamp - b.timestamp)
    return events
  }
}
