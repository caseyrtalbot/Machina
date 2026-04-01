// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentManager } from '../document-manager'

describe('DocumentManager.registerExternalWrite', () => {
  const path = '/vault/test.md'
  const initialMtime = '2026-04-01T00:00:00.000Z'

  const createFs = () => ({
    readFile: vi.fn().mockResolvedValue('# Test'),
    getFileMtime: vi.fn().mockResolvedValue(initialMtime),
    writeFile: vi.fn().mockResolvedValue(undefined)
  })

  let fs: ReturnType<typeof createFs>
  let dm: DocumentManager

  beforeEach(() => {
    vi.useFakeTimers()
    fs = createFs()
    dm = new DocumentManager(fs as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('suppresses handleExternalChange for a registered path', async () => {
    await dm.open(path)

    dm.registerExternalWrite(path)

    const events: string[] = []
    dm.onEvent((e) => events.push(e.type))

    await dm.handleExternalChange(path)

    // The watcher event should have been suppressed entirely
    expect(events).toEqual([])
    // readFile should NOT have been called again (suppression returns early)
    expect(fs.readFile).toHaveBeenCalledTimes(1) // only the initial open()
  })

  it('only suppresses once per registration (flag consumed on first use)', async () => {
    await dm.open(path)
    dm.registerExternalWrite(path)

    // First call: suppressed
    await dm.handleExternalChange(path)

    // Second call: NOT suppressed, so it goes through the full check path
    // Change mtime + content so handleExternalChange detects a real change
    const newMtime = '2026-04-01T00:01:00.000Z'
    fs.getFileMtime.mockResolvedValueOnce(newMtime)
    fs.readFile.mockResolvedValueOnce('# Changed by agent')

    const events: string[] = []
    dm.onEvent((e) => events.push(e.type))

    await dm.handleExternalChange(path)

    expect(events).toContain('external-change')
  })

  it('auto-clears the pending flag after the timeout', async () => {
    await dm.open(path)
    dm.registerExternalWrite(path)

    // Advance past the 2s timeout
    vi.advanceTimersByTime(3000)

    // Now a watcher event should NOT be suppressed
    const newMtime = '2026-04-01T00:01:00.000Z'
    fs.getFileMtime.mockResolvedValueOnce(newMtime)
    fs.readFile.mockResolvedValueOnce('# Changed externally')

    const events: string[] = []
    dm.onEvent((e) => events.push(e.type))

    await dm.handleExternalChange(path)

    expect(events).toContain('external-change')
  })

  it('replaces a previous registration for the same path (idempotent)', async () => {
    await dm.open(path)

    dm.registerExternalWrite(path)
    // Advance partway through the first timeout
    vi.advanceTimersByTime(1500)

    // Register again -- should reset the timer
    dm.registerExternalWrite(path)

    // Advance another 1500ms (total 3000ms from first, 1500ms from second)
    vi.advanceTimersByTime(1500)

    // The second registration's timeout hasn't expired yet (only 1500ms of 2000ms)
    // so the flag should still be active
    const events: string[] = []
    dm.onEvent((e) => events.push(e.type))

    await dm.handleExternalChange(path)

    expect(events).toEqual([]) // still suppressed
  })
})
