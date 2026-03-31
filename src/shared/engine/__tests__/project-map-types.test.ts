/**
 * Tests for project-map-types: shared types and utility functions
 * for the project-map domain.
 */
import { describe, it, expect } from 'vitest'
import {
  isBinaryPath,
  stableNodeId,
  BINARY_EXTENSIONS,
  DEFAULT_PROJECT_MAP_OPTIONS
} from '@shared/engine/project-map-types'
import type {
  ProjectMapNode,
  ProjectMapEdge,
  ProjectMapSnapshot,
  ProjectMapEdgeKind
} from '@shared/engine/project-map-types'

describe('project-map-types', () => {
  describe('DEFAULT_PROJECT_MAP_OPTIONS', () => {
    it('has expected defaults', () => {
      expect(DEFAULT_PROJECT_MAP_OPTIONS.expandDepth).toBe(2)
      expect(DEFAULT_PROJECT_MAP_OPTIONS.maxNodes).toBe(200)
    })
  })

  describe('BINARY_EXTENSIONS', () => {
    it('includes common image extensions', () => {
      expect(BINARY_EXTENSIONS.has('.png')).toBe(true)
      expect(BINARY_EXTENSIONS.has('.jpg')).toBe(true)
      expect(BINARY_EXTENSIONS.has('.gif')).toBe(true)
    })

    it('includes archive extensions', () => {
      expect(BINARY_EXTENSIONS.has('.zip')).toBe(true)
      expect(BINARY_EXTENSIONS.has('.tar')).toBe(true)
      expect(BINARY_EXTENSIONS.has('.gz')).toBe(true)
    })

    it('includes font extensions', () => {
      expect(BINARY_EXTENSIONS.has('.woff')).toBe(true)
      expect(BINARY_EXTENSIONS.has('.woff2')).toBe(true)
      expect(BINARY_EXTENSIONS.has('.ttf')).toBe(true)
    })

    it('does not include text extensions', () => {
      expect(BINARY_EXTENSIONS.has('.ts')).toBe(false)
      expect(BINARY_EXTENSIONS.has('.md')).toBe(false)
      expect(BINARY_EXTENSIONS.has('.json')).toBe(false)
    })
  })

  describe('isBinaryPath', () => {
    it('returns true for binary extensions', () => {
      expect(isBinaryPath('image.png')).toBe(true)
      expect(isBinaryPath('archive.zip')).toBe(true)
      expect(isBinaryPath('font.woff2')).toBe(true)
      expect(isBinaryPath('deep/nested/path/photo.jpg')).toBe(true)
    })

    it('returns false for text extensions', () => {
      expect(isBinaryPath('code.ts')).toBe(false)
      expect(isBinaryPath('readme.md')).toBe(false)
      expect(isBinaryPath('config.json')).toBe(false)
    })

    it('returns false for files with no extension', () => {
      expect(isBinaryPath('Makefile')).toBe(false)
      expect(isBinaryPath('Dockerfile')).toBe(false)
    })

    it('is case-insensitive', () => {
      expect(isBinaryPath('IMAGE.PNG')).toBe(true)
      expect(isBinaryPath('photo.JPG')).toBe(true)
      expect(isBinaryPath('ARCHIVE.ZIP')).toBe(true)
    })
  })

  describe('stableNodeId', () => {
    it('returns a string prefixed with pm_', () => {
      const id = stableNodeId('/root', 'src/index.ts')
      expect(id).toMatch(/^pm_[a-z0-9]+$/)
    })

    it('is deterministic: same input produces same output', () => {
      const a = stableNodeId('/root', 'src/index.ts')
      const b = stableNodeId('/root', 'src/index.ts')
      expect(a).toBe(b)
    })

    it('produces different IDs for different paths', () => {
      const a = stableNodeId('/root', 'src/index.ts')
      const b = stableNodeId('/root', 'src/main.ts')
      expect(a).not.toBe(b)
    })

    it('produces different IDs for different roots', () => {
      const a = stableNodeId('/project-a', 'src/index.ts')
      const b = stableNodeId('/project-b', 'src/index.ts')
      expect(a).not.toBe(b)
    })
  })

  describe('type shapes (compile-time checks)', () => {
    it('ProjectMapNode satisfies its interface', () => {
      const node: ProjectMapNode = {
        id: 'pm_abc',
        relativePath: 'src/index.ts',
        name: 'index.ts',
        isDirectory: false,
        nodeType: 'code',
        depth: 1,
        lineCount: 42,
        children: [],
        childCount: 0
      }
      expect(node.id).toBe('pm_abc')
    })

    it('ProjectMapEdge satisfies its interface', () => {
      const edge: ProjectMapEdge = {
        source: 'pm_a',
        target: 'pm_b',
        kind: 'imports'
      }
      expect(edge.kind).toBe('imports')
    })

    it('ProjectMapSnapshot satisfies its interface', () => {
      const snapshot: ProjectMapSnapshot = {
        rootPath: '/project',
        nodes: [],
        edges: [],
        truncated: false,
        totalFileCount: 0,
        skippedCount: 0,
        unresolvedRefs: []
      }
      expect(snapshot.truncated).toBe(false)
    })

    it('ProjectMapEdgeKind covers all three values', () => {
      const kinds: ProjectMapEdgeKind[] = ['contains', 'imports', 'references']
      expect(kinds).toHaveLength(3)
    })
  })
})
