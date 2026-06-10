// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPath, mockAppendFileSync, mockMkdirSync, mockStatSync } = vi.hoisted(() => ({
  mockGetPath: vi.fn(() => '/tmp/machina-user-data'),
  mockAppendFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockStatSync: vi.fn(() => {
    throw new Error('ENOENT')
  })
}))

const { mockAppendFile, mockMkdir, mockRename } = vi.hoisted(() => ({
  mockAppendFile: vi.fn(async (..._args: unknown[]) => undefined),
  mockMkdir: vi.fn(async (..._args: unknown[]) => undefined),
  mockRename: vi.fn(async (..._args: unknown[]) => undefined)
}))

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath
  }
}))

vi.mock('fs', () => ({
  appendFileSync: mockAppendFileSync,
  mkdirSync: mockMkdirSync,
  statSync: mockStatSync
}))

vi.mock('fs/promises', () => ({
  appendFile: mockAppendFile,
  mkdir: mockMkdir,
  rename: mockRename
}))

import {
  MAX_LOG_SIZE_BYTES,
  flushMainLogger,
  formatMainLogEntry,
  installMainLogger,
  logRendererConsole,
  resetMainLoggerForTests,
  resolveMainLogFilePath
} from '../main-logger'

const LOG_PATH = '/tmp/machina-user-data/logs/main.log'

describe('main-logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    resetMainLoggerForTests()
  })

  afterEach(() => {
    resetMainLoggerForTests()
    vi.useRealTimers()
  })

  it('resolves the main log path under userData/logs', () => {
    expect(resolveMainLogFilePath('/tmp/app')).toBe('/tmp/app/logs/main.log')
  })

  it('formats log entries with timestamp and level', () => {
    const entry = formatMainLogEntry('error', ['boom'], new Date('2026-04-06T12:00:00.000Z'))
    expect(entry).toBe('2026-04-06T12:00:00.000Z [error] boom')
  })

  it('buffers console writes and persists them on flush', async () => {
    installMainLogger()
    console.error('boom', new Error('fail'))

    // Buffered: nothing hits disk until a flush.
    expect(mockAppendFile).not.toHaveBeenCalled()

    await flushMainLogger()

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/machina-user-data/logs', { recursive: true })
    expect(mockAppendFile).toHaveBeenCalledWith(
      LOG_PATH,
      expect.stringContaining('[error] boom Error: fail'),
      'utf8'
    )
  })

  it('flushes automatically after the buffer delay', async () => {
    vi.useFakeTimers()
    installMainLogger()
    console.warn('delayed')

    expect(mockAppendFile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)

    expect(mockAppendFile).toHaveBeenCalledWith(
      LOG_PATH,
      expect.stringContaining('[warn] delayed'),
      'utf8'
    )
  })

  it('batches multiple lines into a single append', async () => {
    installMainLogger()
    console.error('first')
    console.error('second')

    await flushMainLogger()

    // One install line + two error lines, one appendFile call.
    expect(mockAppendFile).toHaveBeenCalledTimes(1)
    const chunk = mockAppendFile.mock.calls[0]?.[1] as string
    expect(chunk).toContain('[error] first')
    expect(chunk).toContain('[error] second')
  })

  it('rotates main.log to main.log.1 when the size cap is exceeded', async () => {
    mockStatSync.mockImplementation(() => ({ size: MAX_LOG_SIZE_BYTES + 1 }) as never)

    installMainLogger()
    console.error('after-cap')
    await flushMainLogger()

    expect(mockRename).toHaveBeenCalledWith(LOG_PATH, `${LOG_PATH}.1`)
    expect(mockAppendFile).toHaveBeenCalledWith(
      LOG_PATH,
      expect.stringContaining('[error] after-cap'),
      'utf8'
    )
  })

  it('forwards renderer console messages with source location', async () => {
    logRendererConsole('warning', 'slow frame', 'app://renderer/index.js', 42)
    logRendererConsole('error', 'boom', 'app://renderer/index.js', 7)

    await flushMainLogger()

    const chunk = mockAppendFile.mock.calls[0]?.[1] as string
    expect(chunk).toContain('[warn] [renderer] slow frame (app://renderer/index.js:42)')
    expect(chunk).toContain('[error] [renderer] boom (app://renderer/index.js:7)')
  })
})
