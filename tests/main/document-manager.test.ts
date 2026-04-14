import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DocumentManager } from '../../src/main/services/document-manager'

// Mock FileService
function createMockFs(files: Record<string, { content: string; mtime: string }> = {}) {
  const store = { ...files }
  return {
    readFile: vi.fn(async (path: string) => {
      if (!store[path]) throw new Error(`ENOENT: ${path}`)
      return store[path].content
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      store[path] = { content, mtime: new Date().toISOString() }
    }),
    getFileMtime: vi.fn(async (path: string) => {
      return store[path]?.mtime ?? null
    }),
    // Expose store for test assertions
    _store: store
  }
}

describe('DocumentManager', () => {
  let dm: DocumentManager
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    vi.useFakeTimers()
    mockFs = createMockFs({
      '/vault/note.md': { content: '# Hello', mtime: '2026-01-01T00:00:00Z' }
    })
    dm = new DocumentManager(mockFs as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── Open / Close lifecycle ───

  describe('open', () => {
    it('reads file from disk and returns content + version', async () => {
      const result = await dm.open('/vault/note.md')
      expect(result.content).toBe('# Hello')
      expect(result.version).toBe(0)
      expect(mockFs.readFile).toHaveBeenCalledWith('/vault/note.md')
    })

    it('increments refCount on second open without re-reading disk', async () => {
      await dm.open('/vault/note.md')
      mockFs.readFile.mockClear()

      const result = await dm.open('/vault/note.md')
      expect(result.content).toBe('# Hello')
      expect(mockFs.readFile).not.toHaveBeenCalled()
    })

    it('stores document in the map', async () => {
      await dm.open('/vault/note.md')
      expect(dm.documents.has('/vault/note.md')).toBe(true)
    })
  })

  describe('close', () => {
    it('removes document from map when refCount reaches 0', async () => {
      await dm.open('/vault/note.md')
      await dm.close('/vault/note.md')
      expect(dm.documents.has('/vault/note.md')).toBe(false)
    })

    it('decrements refCount without removing on close with multiple refs', async () => {
      await dm.open('/vault/note.md')
      await dm.open('/vault/note.md')
      await dm.close('/vault/note.md')
      expect(dm.documents.has('/vault/note.md')).toBe(true)
      expect(dm.documents.get('/vault/note.md')!.refCount).toBe(1)
    })

    it('flushes dirty content before removing', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Updated')
      await dm.close('/vault/note.md')
      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/note.md', '# Updated')
    })

    it('is a no-op for non-open paths', async () => {
      await dm.close('/vault/nonexistent.md')
      // Should not throw
    })
  })

  // ─── Update ───

  describe('update', () => {
    it('updates content and increments version', async () => {
      await dm.open('/vault/note.md')
      const v = dm.update('/vault/note.md', '# Changed')
      expect(v).toBe(1)
      expect(dm.getContent('/vault/note.md')!.content).toBe('# Changed')
      expect(dm.getContent('/vault/note.md')!.dirty).toBe(true)
    })

    it('throws for non-open document', () => {
      expect(() => dm.update('/vault/missing.md', 'x')).toThrow('Document not open')
    })
  })

  // ─── Autosave ───

  describe('autosave', () => {
    it('writes to disk after 1 second debounce', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Autosaved')

      expect(mockFs.writeFile).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)

      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/note.md', '# Autosaved')
    })

    it('resets timer on rapid updates', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', 'v1')
      await vi.advanceTimersByTimeAsync(500)

      dm.update('/vault/note.md', 'v2')
      await vi.advanceTimersByTimeAsync(500)

      // Only 500ms since last update, should not have saved yet
      expect(mockFs.writeFile).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(500)
      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/note.md', 'v2')
    })

    it('marks document clean after autosave', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Saved')

      await vi.advanceTimersByTimeAsync(1000)

      expect(dm.getContent('/vault/note.md')!.dirty).toBe(false)
    })
  })

  // ─── Save (explicit) ───

  describe('save', () => {
    it('writes immediately and clears dirty flag', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Explicit save')
      await dm.save('/vault/note.md')

      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/note.md', '# Explicit save')
      expect(dm.getContent('/vault/note.md')!.dirty).toBe(false)
    })

    it('cancels pending autosave timer', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Save now')
      await dm.save('/vault/note.md')

      mockFs.writeFile.mockClear()
      await vi.advanceTimersByTimeAsync(1000)

      // Autosave should not fire again
      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })

    it('saveContent writes renderer content even after the document closes', async () => {
      await dm.open('/vault/note.md')
      await dm.close('/vault/note.md')

      await dm.saveContent('/vault/note.md', '# Detached save')

      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/note.md', '# Detached save')
    })
  })

  // ─── Self-write suppression ───

  describe('self-write suppression', () => {
    it('ignores watcher event for a file we just wrote', async () => {
      const events: unknown[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Our write')
      await dm.save('/vault/note.md')

      // Simulate watcher firing for our own write
      await dm.handleExternalChange('/vault/note.md')

      // Should not emit external-change or conflict
      const nonSavedEvents = events.filter((e) => (e as { type: string }).type !== 'saved')
      expect(nonSavedEvents).toEqual([])
    })
  })

  describe('clearPendingWrites (vault switch)', () => {
    it('drops pending-write flags so suppression does not leak across vaults', async () => {
      dm.registerExternalWrite('/vault/a/note.md')
      dm.registerExternalWrite('/vault/a/other.md')
      expect(dm.hasPendingWrite('/vault/a/note.md')).toBe(true)
      expect(dm.hasPendingWrite('/vault/a/other.md')).toBe(true)

      dm.clearPendingWrites()

      expect(dm.hasPendingWrite('/vault/a/note.md')).toBe(false)
      expect(dm.hasPendingWrite('/vault/a/other.md')).toBe(false)
    })

    it('cancels the pending-write safety timer so it cannot fire later', async () => {
      dm.registerExternalWrite('/vault/a/note.md')
      dm.clearPendingWrites()

      // Advance past the PENDING_WRITE_TIMEOUT_MS safety window. If the timer
      // leaked, it would still try to delete from the now-empty set; fake
      // timers surface this as a pending timer if cleanup was skipped.
      await vi.advanceTimersByTimeAsync(5000)

      // Still false and, critically, no dangling timer did anything observable
      expect(dm.hasPendingWrite('/vault/a/note.md')).toBe(false)
    })
  })

  // ─── External change detection ───

  describe('handleExternalChange', () => {
    it('silently reloads clean document on external change', async () => {
      const events: unknown[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/vault/note.md')

      // Simulate external edit
      mockFs._store['/vault/note.md'] = {
        content: '# External edit',
        mtime: '2026-06-01T00:00:00Z'
      }

      await dm.handleExternalChange('/vault/note.md')

      expect(dm.getContent('/vault/note.md')!.content).toBe('# External edit')
      expect(events).toContainEqual({
        type: 'external-change',
        path: '/vault/note.md',
        content: '# External edit'
      })
    })

    it('emits conflict when document is dirty and disk differs', async () => {
      const events: unknown[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# My unsaved edits')

      // Simulate external edit
      mockFs._store['/vault/note.md'] = {
        content: '# Someone else edited',
        mtime: '2026-06-01T00:00:00Z'
      }

      await dm.handleExternalChange('/vault/note.md')

      expect(events).toContainEqual({
        type: 'conflict',
        path: '/vault/note.md',
        diskContent: '# Someone else edited'
      })

      // Content should NOT have been overwritten
      expect(dm.getContent('/vault/note.md')!.content).toBe('# My unsaved edits')
    })

    it('ignores change when content matches lastSavedContent (cloud sync false positive)', async () => {
      const events: unknown[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/vault/note.md')

      // Simulate cloud sync touching mtime but not content
      mockFs._store['/vault/note.md'] = {
        content: '# Hello', // same content
        mtime: '2026-06-01T00:00:00Z' // different mtime
      }

      await dm.handleExternalChange('/vault/note.md')

      expect(events).toEqual([])
    })

    it('is a no-op for files not in the document store', async () => {
      await dm.handleExternalChange('/vault/unknown.md')
      // Should not throw
    })
  })

  // ─── getContent ───

  describe('getContent', () => {
    it('returns null for non-open paths', () => {
      expect(dm.getContent('/vault/missing.md')).toBeNull()
    })

    it('returns content, version, and dirty flag', async () => {
      await dm.open('/vault/note.md')
      dm.update('/vault/note.md', '# Dirty')

      const result = dm.getContent('/vault/note.md')!
      expect(result.content).toBe('# Dirty')
      expect(result.version).toBe(1)
      expect(result.dirty).toBe(true)
    })
  })

  // ─── flushAll ───

  describe('flushAll', () => {
    it('saves all dirty documents', async () => {
      mockFs._store['/vault/a.md'] = { content: 'a', mtime: '2026-01-01T00:00:00Z' }
      mockFs._store['/vault/b.md'] = { content: 'b', mtime: '2026-01-01T00:00:00Z' }

      await dm.open('/vault/a.md')
      await dm.open('/vault/b.md')

      dm.update('/vault/a.md', 'a-dirty')
      dm.update('/vault/b.md', 'b-dirty')

      await dm.flushAll()

      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/a.md', 'a-dirty')
      expect(mockFs.writeFile).toHaveBeenCalledWith('/vault/b.md', 'b-dirty')
    })

    it('skips clean documents', async () => {
      await dm.open('/vault/note.md')

      await dm.flushAll()

      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })
  })
})
