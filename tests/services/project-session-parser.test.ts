import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProjectSessionParser } from '../../src/main/services/project-session-parser'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

describe('ProjectSessionParser', () => {
  let parser: ProjectSessionParser
  let tempDir: string
  let projectPath: string
  let claudeProjectDir: string

  beforeEach(async () => {
    parser = new ProjectSessionParser()
    tempDir = await mkdtemp(join(tmpdir(), 'te-parser-test-'))
    projectPath = join(tempDir, 'my-project')

    // Create the Claude project directory with the expected key format
    const dirKey = projectPath.replace(/\//g, '-')
    claudeProjectDir = join(homedir(), '.claude', 'projects', dirKey)
    await mkdir(claudeProjectDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    await rm(claudeProjectDir, { recursive: true, force: true })
  })

  it('returns empty array when no session files exist', async () => {
    const events = await parser.parse(projectPath)
    expect(events).toEqual([])
  })

  it('returns empty array when project dir does not exist', async () => {
    const events = await parser.parse('/nonexistent/path/to/project')
    expect(events).toEqual([])
  })

  it('extracts file-read events from Read tool_use blocks', async () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-18T10:00:00Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/Users/test/my-project/src/index.ts' }
          }
        ]
      }
    })

    await writeFile(join(claudeProjectDir, 'session-1.jsonl'), jsonl)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'file-read',
      sessionId: 'session-1',
      filePath: '/Users/test/my-project/src/index.ts'
    })
  })

  it('extracts file-write events from Write tool_use blocks', async () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-18T10:00:00Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Write',
            input: { file_path: '/Users/test/my-project/src/new-file.ts' }
          }
        ]
      }
    })

    await writeFile(join(claudeProjectDir, 'session-2.jsonl'), jsonl)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('file-write')
  })

  it('extracts file-edit events from Edit tool_use blocks', async () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-18T10:00:00Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Edit',
            input: { file_path: '/Users/test/my-project/src/index.ts' }
          }
        ]
      }
    })

    await writeFile(join(claudeProjectDir, 'session-3.jsonl'), jsonl)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('file-edit')
  })

  it('extracts bash-command events from Bash tool_use blocks', async () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-18T10:00:00Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'npm test' }
          }
        ]
      }
    })

    await writeFile(join(claudeProjectDir, 'session-4.jsonl'), jsonl)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'bash-command',
      detail: 'npm test'
    })
  })

  it('handles multiple tool_use blocks in one message', async () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-18T10:00:00Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/Users/test/my-project/src/a.ts' }
          },
          {
            type: 'tool_use',
            name: 'Edit',
            input: { file_path: '/Users/test/my-project/src/b.ts' }
          }
        ]
      }
    })

    await writeFile(join(claudeProjectDir, 'session-5.jsonl'), jsonl)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('file-read')
    expect(events[1].type).toBe('file-edit')
  })

  it('skips non-assistant entries', async () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hello' }
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-18T10:00:00Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/test/file.ts' }
            }
          ]
        }
      })
    ].join('\n')

    await writeFile(join(claudeProjectDir, 'session-6.jsonl'), lines)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(1)
  })

  it('skips malformed JSONL lines gracefully', async () => {
    const lines = [
      'this is not valid json',
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-18T10:00:00Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/test/ok.ts' } }]
        }
      })
    ].join('\n')

    await writeFile(join(claudeProjectDir, 'session-7.jsonl'), lines)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(1)
    expect(events[0].filePath).toBe('/test/ok.ts')
  })

  it('returns events sorted by timestamp', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-18T12:00:00Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/test/later.ts' } }]
        }
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-18T10:00:00Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/test/earlier.ts' } }]
        }
      })
    ].join('\n')

    await writeFile(join(claudeProjectDir, 'session-8.jsonl'), lines)

    const events = await parser.parse(projectPath)
    expect(events).toHaveLength(2)
    expect(events[0].filePath).toBe('/test/earlier.ts')
    expect(events[1].filePath).toBe('/test/later.ts')
  })
})
