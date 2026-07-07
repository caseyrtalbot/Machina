// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DocumentManager,
  type DocumentEventCallback
} from '../../src/main/services/document-manager'
import type { FileService } from '../../src/main/services/file-service'
import type { Mock } from 'vitest'

type DocEvent = Parameters<DocumentEventCallback>[0]

interface MockFileService extends FileService {
  readFile: Mock<FileService['readFile']>
  readFileBytes: Mock<FileService['readFileBytes']>
  writeFile: Mock<FileService['writeFile']>
  getFileMtime: Mock<FileService['getFileMtime']>
}

function createMockFs(): MockFileService {
  const readFile = vi.fn<FileService['readFile']>().mockResolvedValue('initial content')
  return {
    readFile,
    // Delegates to readFile so open()'s read still registers as a readFile
    // call — keeps existing call-count/arg assertions valid.
    readFileBytes: vi.fn(async (path: string) => Buffer.from(await readFile(path))),
    writeFile: vi.fn<FileService['writeFile']>().mockResolvedValue(undefined),
    getFileMtime: vi.fn<FileService['getFileMtime']>().mockResolvedValue('2024-01-01T00:00:00Z')
  } as MockFileService
}

describe('DocumentManager', () => {
  let dm: DocumentManager
  let mockFs: MockFileService

  beforeEach(() => {
    vi.useFakeTimers()
    mockFs = createMockFs()
    dm = new DocumentManager(mockFs)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('open + update + close lifecycle', () => {
    it('reads file from disk on open and returns content with version 0', async () => {
      const result = await dm.open('/notes/a.md')

      expect(result).toEqual({ content: 'initial content', version: 0 })
      expect(mockFs.readFile).toHaveBeenCalledWith('/notes/a.md')
      expect(mockFs.getFileMtime).toHaveBeenCalledWith('/notes/a.md')
    })

    it('flushes dirty content to disk on close', async () => {
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'updated content')

      await dm.close('/notes/a.md')

      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'updated content')
    })

    it('removes document from map after close with refCount 1', async () => {
      await dm.open('/notes/a.md')
      await dm.close('/notes/a.md')

      expect(dm.documents.has('/notes/a.md')).toBe(false)
    })

    it('does not write to disk if document is clean on close', async () => {
      await dm.open('/notes/a.md')
      await dm.close('/notes/a.md')

      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })

    it('increments version on each update', async () => {
      await dm.open('/notes/a.md')

      const v1 = dm.update('/notes/a.md', 'v1')
      const v2 = dm.update('/notes/a.md', 'v2')
      const v3 = dm.update('/notes/a.md', 'v3')

      expect(v1).toBe(1)
      expect(v2).toBe(2)
      expect(v3).toBe(3)
    })

    it('throws when updating a document that is not open', () => {
      expect(() => dm.update('/notes/missing.md', 'x')).toThrow(
        'Document not open: /notes/missing.md'
      )
    })
  })

  describe('autosave debounce', () => {
    it('saves to disk after 1s debounce', async () => {
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'debounced content')

      expect(mockFs.writeFile).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)

      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'debounced content')
    })

    it('resets debounce on subsequent updates', async () => {
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'first')

      await vi.advanceTimersByTimeAsync(500)
      dm.update('/notes/a.md', 'second')

      await vi.advanceTimersByTimeAsync(500)
      expect(mockFs.writeFile).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(500)
      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'second')
    })

    it('emits saved event after autosave completes', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'saved content')

      await vi.advanceTimersByTimeAsync(1000)

      expect(events).toContainEqual({ type: 'saved', path: '/notes/a.md' })
    })
  })

  describe('saveContent', () => {
    it('persists content and emits saved when the document is already closed', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      await dm.close('/notes/a.md')

      await dm.saveContent('/notes/a.md', 'renderer flush')

      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'renderer flush')
      expect(events).toContainEqual({ type: 'saved', path: '/notes/a.md' })
    })
  })

  describe('conflict detection', () => {
    it('fires conflict event when file changed externally while dirty', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'my local edits')

      // Simulate external change: different mtime and different content
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T01:00:00Z')
      mockFs.readFile.mockResolvedValueOnce('someone elses edits')

      await dm.handleExternalChange('/notes/a.md')

      expect(events).toEqual([
        { type: 'conflict', path: '/notes/a.md', diskContent: 'someone elses edits' }
      ])
    })

    it('skips external change when mtime has not changed', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      // mtime returns same value as initial open
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T00:00:00Z')

      await dm.handleExternalChange('/notes/a.md')

      expect(events).toHaveLength(0)
    })

    it('skips external change when content is identical (cloud sync false positive)', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      // Different mtime but same content
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T02:00:00Z')
      mockFs.readFile.mockResolvedValueOnce('initial content')

      await dm.handleExternalChange('/notes/a.md')

      expect(events).toHaveLength(0)
    })
  })

  describe('external change with clean state', () => {
    it('reloads content and fires external-change event', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      // File is clean (no updates). Simulate genuine external change.
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T03:00:00Z')
      mockFs.readFile.mockResolvedValueOnce('externally updated')

      await dm.handleExternalChange('/notes/a.md')

      expect(events).toEqual([
        { type: 'external-change', path: '/notes/a.md', content: 'externally updated' }
      ])

      const doc = dm.getContent('/notes/a.md')
      expect(doc?.content).toBe('externally updated')
      expect(doc?.dirty).toBe(false)
    })
  })

  describe('self-write suppression', () => {
    it('ignores watcher event triggered by our own save', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'our write')

      // Trigger the autosave, which adds path to _pendingWrites
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'our write')

      // Simulate watcher echo from our own write
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T04:00:00Z')
      mockFs.readFile.mockResolvedValueOnce('our write')

      await dm.handleExternalChange('/notes/a.md')

      // Only the 'saved' event from autosave should be present, no external-change or conflict
      const nonSavedEvents = events.filter((e) => e.type !== 'saved')
      expect(nonSavedEvents).toHaveLength(0)
    })

    it('clears pending write flag after suppression so next external change is detected', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'our write')
      await vi.advanceTimersByTimeAsync(1000)

      // First watcher echo: suppressed
      await dm.handleExternalChange('/notes/a.md')

      // Second genuine external change: should be detected
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T05:00:00Z')
      mockFs.readFile.mockResolvedValueOnce('genuine external change')

      await dm.handleExternalChange('/notes/a.md')

      const externalEvents = events.filter((e) => e.type === 'external-change')
      expect(externalEvents).toEqual([
        { type: 'external-change', path: '/notes/a.md', content: 'genuine external change' }
      ])
    })

    it('pending write flag auto-clears after 2s safety timeout', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'our write')
      await vi.advanceTimersByTimeAsync(1000) // autosave fires

      // Advance past the 2s safety timeout without triggering watcher
      await vi.advanceTimersByTimeAsync(2000)

      // Now a genuine external change should NOT be suppressed
      mockFs.getFileMtime.mockResolvedValueOnce('2024-01-01T06:00:00Z')
      mockFs.readFile.mockResolvedValueOnce('late external change')

      await dm.handleExternalChange('/notes/a.md')

      const externalEvents = events.filter((e) => e.type === 'external-change')
      expect(externalEvents).toHaveLength(1)
    })
  })

  describe('concurrent open (refCount)', () => {
    it('increments refCount on duplicate opens without re-reading disk', async () => {
      await dm.open('/notes/a.md')
      const second = await dm.open('/notes/a.md')

      // Should return same content from memory
      expect(second).toEqual({ content: 'initial content', version: 0 })
      // readFile should only have been called once (first open)
      expect(mockFs.readFile).toHaveBeenCalledTimes(1)
    })

    it('does not remove document until all refs are closed', async () => {
      await dm.open('/notes/a.md')
      await dm.open('/notes/a.md')
      await dm.open('/notes/a.md')

      await dm.close('/notes/a.md')
      expect(dm.documents.has('/notes/a.md')).toBe(true)

      await dm.close('/notes/a.md')
      expect(dm.documents.has('/notes/a.md')).toBe(true)

      await dm.close('/notes/a.md')
      expect(dm.documents.has('/notes/a.md')).toBe(false)
    })

    it('returns current version when opened with existing edits', async () => {
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'v1')
      dm.update('/notes/a.md', 'v2')

      const second = await dm.open('/notes/a.md')
      expect(second).toEqual({ content: 'v2', version: 2 })
    })

    it('flushes dirty content only on final close', async () => {
      await dm.open('/notes/a.md')
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'shared edits')

      await dm.close('/notes/a.md') // refCount drops to 1
      expect(mockFs.writeFile).not.toHaveBeenCalled()

      await dm.close('/notes/a.md') // refCount drops to 0, should flush
      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'shared edits')
    })
  })

  describe('flushAll', () => {
    it('saves all dirty documents to disk', async () => {
      await dm.open('/notes/a.md')
      await dm.open('/notes/b.md')
      await dm.open('/notes/c.md')

      dm.update('/notes/a.md', 'a updated')
      dm.update('/notes/b.md', 'b updated')
      // c.md is clean

      await dm.flushAll()

      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/a.md', 'a updated')
      expect(mockFs.writeFile).toHaveBeenCalledWith('/notes/b.md', 'b updated')
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2)
    })

    it('does nothing when no documents are dirty', async () => {
      await dm.open('/notes/a.md')
      await dm.open('/notes/b.md')

      await dm.flushAll()

      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })

    it('clears pending autosave timers on flushed documents', async () => {
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'pending save')

      await dm.flushAll()

      // writeFile called once by flushAll
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1)

      // Advance past the autosave interval; should not trigger a second write
      // because flushAll cleared the timer
      mockFs.writeFile.mockClear()
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })

    it('emits saved event for each flushed document', async () => {
      const events: DocEvent[] = []
      dm.onEvent((e) => events.push(e))

      await dm.open('/notes/a.md')
      await dm.open('/notes/b.md')
      dm.update('/notes/a.md', 'a updated')
      dm.update('/notes/b.md', 'b updated')

      await dm.flushAll()

      const savedEvents = events.filter((e) => e.type === 'saved')
      expect(savedEvents).toHaveLength(2)
      expect(savedEvents.map((e) => ('path' in e ? e.path : '')).sort()).toEqual([
        '/notes/a.md',
        '/notes/b.md'
      ])
    })
  })

  describe('getContent', () => {
    it('returns null for unknown paths', () => {
      expect(dm.getContent('/notes/missing.md')).toBeNull()
    })

    it('reflects dirty state after update', async () => {
      await dm.open('/notes/a.md')

      expect(dm.getContent('/notes/a.md')?.dirty).toBe(false)

      dm.update('/notes/a.md', 'changed')

      const result = dm.getContent('/notes/a.md')
      expect(result?.content).toBe('changed')
      expect(result?.dirty).toBe(true)
    })

    it('reflects clean state after save', async () => {
      await dm.open('/notes/a.md')
      dm.update('/notes/a.md', 'changed')

      await dm.save('/notes/a.md')

      const result = dm.getContent('/notes/a.md')
      expect(result?.dirty).toBe(false)
    })
  })
})
