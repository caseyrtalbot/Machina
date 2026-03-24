import { describe, it, expect } from 'vitest'
import {
  emptyManifest,
  hashContent,
  detectChanges,
  updateManifest,
  type ConnectManifest
} from '../../src/renderer/src/engine/connect-manifest'

describe('connect-manifest', () => {
  describe('emptyManifest', () => {
    it('returns a version-1 manifest with no files', () => {
      const m = emptyManifest()
      expect(m.version).toBe(1)
      expect(m.lastFullScan).toBeNull()
      expect(m.files).toEqual({})
    })
  })

  describe('hashContent', () => {
    it('returns a hex string', async () => {
      const hash = await hashContent('hello world')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns the same hash for identical content', async () => {
      const a = await hashContent('test content')
      const b = await hashContent('test content')
      expect(a).toBe(b)
    })

    it('returns different hashes for different content', async () => {
      const a = await hashContent('version 1')
      const b = await hashContent('version 2')
      expect(a).not.toBe(b)
    })
  })

  describe('detectChanges', () => {
    it('treats all files as new when manifest is null', () => {
      const current = new Map([
        ['notes/a.md', 'hash-a'],
        ['notes/b.md', 'hash-b']
      ])

      const result = detectChanges(null, current)

      expect(result.newFiles).toEqual(['notes/a.md', 'notes/b.md'])
      expect(result.changedFiles).toEqual([])
      expect(result.unchangedFiles).toEqual([])
      expect(result.removedFiles).toEqual([])
    })

    it('detects new, changed, unchanged, and removed files', () => {
      const manifest: ConnectManifest = {
        version: 1,
        lastFullScan: '2026-03-24T10:00:00Z',
        files: {
          'existing.md': { hash: 'hash-1', analyzedAt: '2026-03-24T10:00:00Z' },
          'modified.md': { hash: 'old-hash', analyzedAt: '2026-03-24T10:00:00Z' },
          'deleted.md': { hash: 'hash-3', analyzedAt: '2026-03-24T10:00:00Z' }
        }
      }

      const current = new Map([
        ['existing.md', 'hash-1'],
        ['modified.md', 'new-hash'],
        ['brand-new.md', 'hash-4']
      ])

      const result = detectChanges(manifest, current)

      expect(result.newFiles).toEqual(['brand-new.md'])
      expect(result.changedFiles).toEqual(['modified.md'])
      expect(result.unchangedFiles).toEqual(['existing.md'])
      expect(result.removedFiles).toEqual(['deleted.md'])
    })

    it('returns empty sets when nothing changed', () => {
      const manifest: ConnectManifest = {
        version: 1,
        lastFullScan: '2026-03-24T10:00:00Z',
        files: {
          'a.md': { hash: 'h1', analyzedAt: '2026-03-24T10:00:00Z' }
        }
      }

      const current = new Map([['a.md', 'h1']])

      const result = detectChanges(manifest, current)

      expect(result.newFiles).toEqual([])
      expect(result.changedFiles).toEqual([])
      expect(result.unchangedFiles).toEqual(['a.md'])
      expect(result.removedFiles).toEqual([])
    })
  })

  describe('updateManifest', () => {
    it('creates a fresh manifest on first run', () => {
      const analyzed = new Map([
        ['a.md', 'hash-a'],
        ['b.md', 'hash-b']
      ])

      const result = updateManifest(null, analyzed, [], '2026-03-24T12:00:00Z')

      expect(result.version).toBe(1)
      expect(result.lastFullScan).toBe('2026-03-24T12:00:00Z')
      expect(result.files['a.md']).toEqual({
        hash: 'hash-a',
        analyzedAt: '2026-03-24T12:00:00Z'
      })
      expect(result.files['b.md']).toEqual({
        hash: 'hash-b',
        analyzedAt: '2026-03-24T12:00:00Z'
      })
    })

    it('preserves unchanged entries and updates analyzed ones', () => {
      const previous: ConnectManifest = {
        version: 1,
        lastFullScan: '2026-03-24T10:00:00Z',
        files: {
          'old.md': { hash: 'h-old', analyzedAt: '2026-03-24T10:00:00Z' },
          'updated.md': { hash: 'h-stale', analyzedAt: '2026-03-24T10:00:00Z' }
        }
      }

      const analyzed = new Map([
        ['updated.md', 'h-fresh'],
        ['new.md', 'h-new']
      ])

      const result = updateManifest(previous, analyzed, [], '2026-03-24T14:00:00Z')

      // Unchanged entry carried forward
      expect(result.files['old.md'].hash).toBe('h-old')
      expect(result.files['old.md'].analyzedAt).toBe('2026-03-24T10:00:00Z')

      // Updated entry overwritten
      expect(result.files['updated.md'].hash).toBe('h-fresh')
      expect(result.files['updated.md'].analyzedAt).toBe('2026-03-24T14:00:00Z')

      // New entry added
      expect(result.files['new.md'].hash).toBe('h-new')

      // lastFullScan preserved from previous
      expect(result.lastFullScan).toBe('2026-03-24T10:00:00Z')
    })

    it('removes entries for deleted files', () => {
      const previous: ConnectManifest = {
        version: 1,
        lastFullScan: '2026-03-24T10:00:00Z',
        files: {
          'keep.md': { hash: 'h1', analyzedAt: '2026-03-24T10:00:00Z' },
          'gone.md': { hash: 'h2', analyzedAt: '2026-03-24T10:00:00Z' }
        }
      }

      const result = updateManifest(previous, new Map(), ['gone.md'], '2026-03-24T14:00:00Z')

      expect(result.files['keep.md']).toBeDefined()
      expect(result.files['gone.md']).toBeUndefined()
    })

    it('does not mutate the previous manifest', () => {
      const previous: ConnectManifest = {
        version: 1,
        lastFullScan: '2026-03-24T10:00:00Z',
        files: {
          'a.md': { hash: 'h1', analyzedAt: '2026-03-24T10:00:00Z' }
        }
      }

      const filesBefore = { ...previous.files }
      updateManifest(previous, new Map([['b.md', 'h2']]), [], '2026-03-24T14:00:00Z')

      expect(previous.files).toEqual(filesBefore)
    })
  })
})
