// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPath, mockAppendFileSync, mockMkdirSync } = vi.hoisted(() => ({
  mockGetPath: vi.fn(() => '/tmp/machina-user-data'),
  mockAppendFileSync: vi.fn(),
  mockMkdirSync: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath
  }
}))

vi.mock('fs', () => ({
  appendFileSync: mockAppendFileSync,
  mkdirSync: mockMkdirSync
}))

import {
  formatMainLogEntry,
  installMainLogger,
  resetMainLoggerForTests,
  resolveMainLogFilePath
} from '../main-logger'

describe('main-logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMainLoggerForTests()
  })

  afterEach(() => {
    resetMainLoggerForTests()
  })

  it('resolves the main log path under userData/logs', () => {
    expect(resolveMainLogFilePath('/tmp/app')).toBe('/tmp/app/logs/main.log')
  })

  it('formats log entries with timestamp and level', () => {
    const entry = formatMainLogEntry('error', ['boom'], new Date('2026-04-06T12:00:00.000Z'))
    expect(entry).toBe('2026-04-06T12:00:00.000Z [error] boom')
  })

  it('patches console.error so writes are persisted to disk', () => {
    installMainLogger()
    console.error('boom', new Error('fail'))

    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/machina-user-data/logs', { recursive: true })
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      '/tmp/machina-user-data/logs/main.log',
      expect.stringContaining('[error] boom Error: fail'),
      'utf8'
    )
  })
})
