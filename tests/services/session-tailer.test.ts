import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

// Mock typedSend before importing the module under test
const mockTypedSend = vi.fn()
vi.mock('../../src/main/typed-ipc', () => ({
  typedSend: (...args: unknown[]) => mockTypedSend(...args)
}))

// Mock electron's BrowserWindow
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

import { SessionTailer } from '../../src/main/services/session-tailer'

function makeAssistantJsonl(toolName: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-03-18T10:00:00Z',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: toolName, input }]
    }
  })
}

/** Wait for chokidar's awaitWriteFinish to settle + processing time */
function waitForWatcher(ms = 500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('SessionTailer', () => {
  let tailer: SessionTailer
  let tempDir: string
  let projectPath: string
  let claudeProjectDir: string
  const mockWindow = {} as never // SessionTailer only passes this to typedSend

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), 'te-tailer-test-'))
    projectPath = join(tempDir, 'my-project')

    const dirKey = projectPath.replace(/\//g, '-')
    claudeProjectDir = join(homedir(), '.claude', 'projects', dirKey)
    await mkdir(claudeProjectDir, { recursive: true })

    tailer = new SessionTailer(mockWindow)
  })

  afterEach(async () => {
    await tailer.stop()
    await rm(tempDir, { recursive: true, force: true })
    await rm(claudeProjectDir, { recursive: true, force: true })
  })

  describe('findMostRecentSession (via start behavior)', () => {
    it('does not crash when claude directory does not exist', async () => {
      // Use a path that won't have a claude projects dir
      await tailer.start('/nonexistent/path/that/does/not/exist')
      // Should not throw, just silently return
      expect(mockTypedSend).not.toHaveBeenCalled()
    })

    it('does not crash when directory has no jsonl files', async () => {
      await writeFile(join(claudeProjectDir, 'readme.txt'), 'not a jsonl file')
      await tailer.start(projectPath)
      expect(mockTypedSend).not.toHaveBeenCalled()
    })
  })

  describe('start and session detection', () => {
    it('emits session:detected when a session file exists', async () => {
      const line = makeAssistantJsonl('Read', { file_path: '/src/index.ts' })
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), line + '\n')

      await tailer.start(projectPath)

      expect(mockTypedSend).toHaveBeenCalledWith(mockWindow, 'session:detected', { active: true })
    })

    it('seeks to end of file and does not emit existing content', async () => {
      const line = makeAssistantJsonl('Read', { file_path: '/src/index.ts' })
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), line + '\n')

      await tailer.start(projectPath)

      // Only session:detected should have been emitted, not a milestone
      const milestoneCalls = mockTypedSend.mock.calls.filter(
        (call: unknown[]) => call[1] === 'session:milestone'
      )
      expect(milestoneCalls).toHaveLength(0)
    })
  })

  describe('tailing new content', () => {
    it('emits milestones when new JSONL lines are appended', async () => {
      // Create initial file
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), '')

      await tailer.start(projectPath)
      vi.clearAllMocks()

      // Append a tool_use line
      const line = makeAssistantJsonl('Read', { file_path: '/src/app.ts' })
      await appendFile(join(claudeProjectDir, 'session-1.jsonl'), line + '\n')

      await waitForWatcher()

      const milestoneCalls = mockTypedSend.mock.calls.filter(
        (call: unknown[]) => call[1] === 'session:milestone'
      )
      expect(milestoneCalls.length).toBeGreaterThanOrEqual(1)

      const milestone = milestoneCalls[0][2]
      expect(milestone).toMatchObject({
        type: 'research',
        summary: expect.stringContaining('app.ts'),
        files: expect.any(Array),
        events: expect.any(Array)
      })
      expect(milestone.id).toBeDefined()
      expect(typeof milestone.id).toBe('string')
    })

    it('handles malformed JSONL lines without crashing', async () => {
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), '')

      await tailer.start(projectPath)
      vi.clearAllMocks()

      // Append malformed line followed by valid line
      const validLine = makeAssistantJsonl('Bash', { command: 'npm test' })
      await appendFile(
        join(claudeProjectDir, 'session-1.jsonl'),
        'this is not valid json\n' + validLine + '\n'
      )

      await waitForWatcher()

      const milestoneCalls = mockTypedSend.mock.calls.filter(
        (call: unknown[]) => call[1] === 'session:milestone'
      )
      // The valid line should produce a milestone; the malformed line should be silently skipped
      expect(milestoneCalls.length).toBeGreaterThanOrEqual(1)
      const milestone = milestoneCalls[0][2]
      expect(milestone.type).toBe('command')
    })

    it('buffers incomplete lines until newline is received', async () => {
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), '')

      await tailer.start(projectPath)
      vi.clearAllMocks()

      const fullLine = makeAssistantJsonl('Write', { file_path: '/src/new.ts' })
      // Write first half without trailing newline
      const half1 = fullLine.slice(0, Math.floor(fullLine.length / 2))
      const half2 = fullLine.slice(Math.floor(fullLine.length / 2))

      await appendFile(join(claudeProjectDir, 'session-1.jsonl'), half1)
      await waitForWatcher()

      // No milestone should have been emitted for the incomplete line
      const callsAfterHalf1 = mockTypedSend.mock.calls.filter(
        (call: unknown[]) => call[1] === 'session:milestone'
      )
      expect(callsAfterHalf1).toHaveLength(0)

      // Now complete the line
      await appendFile(join(claudeProjectDir, 'session-1.jsonl'), half2 + '\n')
      await waitForWatcher()

      const callsAfterHalf2 = mockTypedSend.mock.calls.filter(
        (call: unknown[]) => call[1] === 'session:milestone'
      )
      expect(callsAfterHalf2.length).toBeGreaterThanOrEqual(1)
      expect(callsAfterHalf2[0][2].type).toBe('create')
    })
  })

  describe('stop', () => {
    it('cleans up watcher and intervals', async () => {
      const line = makeAssistantJsonl('Read', { file_path: '/src/index.ts' })
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), line + '\n')

      await tailer.start(projectPath)
      await tailer.stop()

      vi.clearAllMocks()

      // Append after stop - should not trigger any sends
      const newLine = makeAssistantJsonl('Edit', { file_path: '/src/other.ts' })
      await appendFile(join(claudeProjectDir, 'session-1.jsonl'), newLine + '\n')
      await waitForWatcher()

      expect(mockTypedSend).not.toHaveBeenCalled()
    })

    it('can be called multiple times safely', async () => {
      await tailer.stop()
      await tailer.stop()
      // Should not throw
    })
  })

  describe('session switching', () => {
    it('picks the most recently modified session file', async () => {
      const line1 = makeAssistantJsonl('Read', { file_path: '/src/old.ts' })
      const line2 = makeAssistantJsonl('Read', { file_path: '/src/new.ts' })

      await writeFile(join(claudeProjectDir, 'session-old.jsonl'), line1 + '\n')
      // Small delay to ensure different mtime
      await new Promise((resolve) => setTimeout(resolve, 50))
      await writeFile(join(claudeProjectDir, 'session-new.jsonl'), line2 + '\n')

      await tailer.start(projectPath)

      // Should have detected the session
      expect(mockTypedSend).toHaveBeenCalledWith(mockWindow, 'session:detected', { active: true })
    })
  })

  describe('restart behavior', () => {
    it('stops existing tail before starting new one', async () => {
      const line = makeAssistantJsonl('Read', { file_path: '/src/index.ts' })
      await writeFile(join(claudeProjectDir, 'session-1.jsonl'), line + '\n')

      await tailer.start(projectPath)
      // Starting again should not throw and should reset state
      await tailer.start(projectPath)

      // session:detected should be emitted for the second start too
      const detectedCalls = mockTypedSend.mock.calls.filter(
        (call: unknown[]) => call[1] === 'session:detected'
      )
      expect(detectedCalls).toHaveLength(2)
    })
  })
})
