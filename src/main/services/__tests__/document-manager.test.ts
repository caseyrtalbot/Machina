import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentManager } from '../document-manager'

function flushAsyncWork(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve())
}

describe('DocumentManager autosave failures', () => {
  const path = '/vault/note.md'
  const initialMtime = '2026-03-30T00:00:00.000Z'

  const createFs = () => {
    const readFile = vi.fn().mockResolvedValue('# Note')
    return {
      readFile,
      // Mirror the real FileService: readFileBytes reads the same file as
      // readFile, so tests that re-mock readFile flow through open() too.
      readFileBytes: vi.fn(async (p: string) => Buffer.from(await readFile(p))),
      getFileMtime: vi.fn().mockResolvedValue(initialMtime),
      writeFile: vi.fn()
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps the document dirty when autosave fails instead of losing the failure in the timer', async () => {
    const fs = createFs()
    fs.writeFile.mockRejectedValueOnce(new Error('disk full'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new DocumentManager(fs as never)

    await manager.open(path)
    manager.update(path, '# Changed')

    await vi.advanceTimersByTimeAsync(1000)
    await flushAsyncWork()

    expect(fs.writeFile).toHaveBeenCalledWith(path, '# Changed')
    expect(manager.getContent(path)?.dirty).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('can recover with a later save after an autosave failure', async () => {
    const fs = createFs()
    fs.writeFile.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined)
    const manager = new DocumentManager(fs as never)

    await manager.open(path)
    manager.update(path, '# Changed')

    await vi.advanceTimersByTimeAsync(1000)
    await flushAsyncWork()

    await manager.save(path)

    expect(fs.writeFile).toHaveBeenCalledTimes(2)
    expect(manager.getContent(path)?.dirty).toBe(false)
  })
})

describe('DocumentManager saveContent on open documents', () => {
  const path = '/vault/note.md'

  const createFs = () => {
    const readFile = vi.fn().mockResolvedValue('# Note with [[Old Name]]')
    return {
      readFile,
      readFileBytes: vi.fn(async (p: string) => Buffer.from(await readFile(p))),
      getFileMtime: vi.fn().mockResolvedValue('2026-03-30T00:00:00.000Z'),
      writeFile: vi.fn().mockResolvedValue(undefined)
    }
  }

  it('emits external-change when replacing an open doc with different content', async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)
    const events: Array<{ type: string; content?: string }> = []
    manager.onEvent((e) => events.push(e))

    await manager.open(path)
    await manager.saveContent(path, '# Note with [[New Name]]')

    expect(fs.writeFile).toHaveBeenCalledWith(path, '# Note with [[New Name]]')
    expect(events).toContainEqual({
      type: 'external-change',
      path,
      content: '# Note with [[New Name]]'
    })
    expect(manager.getContent(path)?.dirty).toBe(false)
  })

  it('rewrites from unsaved in-memory content, not stale disk (backlink-rename flow)', async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)

    await manager.open(path)
    // User typed inside the autosave debounce window
    manager.update(path, '# Edited body with [[Old Name]]')

    // Sidebar flow: read current content via open(), compute rewrite, saveContent
    const { content } = await manager.open(path)
    expect(content).toBe('# Edited body with [[Old Name]]')
    const rewritten = content.replace('[[Old Name]]', '[[New Name]]')
    await manager.saveContent(path, rewritten)
    await manager.close(path)

    expect(fs.writeFile).toHaveBeenLastCalledWith(path, '# Edited body with [[New Name]]')
    expect(manager.getContent(path)?.dirty).toBe(false)
  })

  it('does not emit external-change when saved content equals the doc content', async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)
    const events: string[] = []
    manager.onEvent((e) => events.push(e.type))

    await manager.open(path)
    manager.update(path, '# Same content')
    await manager.saveContent(path, '# Same content')

    // Editor flush path: re-pushing the renderer's own content must not
    // trigger a re-parse (would reset the cursor) — only 'saved' fires.
    expect(events).toEqual(['saved'])
  })
})
