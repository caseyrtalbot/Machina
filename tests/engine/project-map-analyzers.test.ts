import { describe, it, expect } from 'vitest'
import {
  extractImportSpecifiers,
  resolveImportPath,
  extractMarkdownRefs,
  extractConfigPathRefs,
  buildProjectMapSnapshot
} from '@shared/engine/project-map-analyzers'
import type { ProjectMapOptions } from '@shared/engine/project-map-types'

describe('extractImportSpecifiers', () => {
  it('extracts named import', () => {
    const code = `import { foo } from './bar'`
    expect(extractImportSpecifiers(code)).toEqual(['./bar'])
  })

  it('extracts default import', () => {
    const code = `import Foo from './Foo'`
    expect(extractImportSpecifiers(code)).toEqual(['./Foo'])
  })

  it('extracts star import', () => {
    const code = `import * as utils from '../utils'`
    expect(extractImportSpecifiers(code)).toEqual(['../utils'])
  })

  it('extracts re-export', () => {
    const code = `export { thing } from './thing'`
    expect(extractImportSpecifiers(code)).toEqual(['./thing'])
  })

  it('extracts dynamic import', () => {
    const code = `const mod = await import('./lazy')`
    expect(extractImportSpecifiers(code)).toEqual(['./lazy'])
  })

  it('extracts require', () => {
    const code = `const x = require('./cjs-mod')`
    expect(extractImportSpecifiers(code)).toEqual(['./cjs-mod'])
  })

  it('extracts multiple imports', () => {
    const code = [
      `import { a } from './a'`,
      `import b from './b'`,
      `const c = require('./c')`
    ].join('\n')
    expect(extractImportSpecifiers(code)).toEqual(['./a', './b', './c'])
  })

  it('skips bare package specifiers', () => {
    const code = `import React from 'react'\nimport { join } from 'path'`
    expect(extractImportSpecifiers(code)).toEqual([])
  })

  it('skips URL imports', () => {
    const code = `import 'https://cdn.example.com/lib.js'`
    expect(extractImportSpecifiers(code)).toEqual([])
  })

  it('skips alias imports (non-relative)', () => {
    const code = `import { foo } from '@shared/types'`
    expect(extractImportSpecifiers(code)).toEqual([])
  })
})

describe('resolveImportPath', () => {
  const ROOT = '/project'
  const allFiles = new Set([
    '/project/src/utils.ts',
    '/project/src/utils/index.ts',
    '/project/src/components/Button.tsx',
    '/project/src/data.json',
    '/project/src/notes/idea.md',
    '/project/lib/helper.js'
  ])

  it('resolves relative import with explicit extension', () => {
    expect(resolveImportPath('./utils.ts', '/project/src/app.ts', allFiles, ROOT)).toBe(
      '/project/src/utils.ts'
    )
  })

  it('resolves extensionless import trying extensions in order', () => {
    expect(resolveImportPath('./utils', '/project/src/app.ts', allFiles, ROOT)).toBe(
      '/project/src/utils.ts'
    )
  })

  it('resolves directory import to index file', () => {
    const files = new Set(['/project/src/utils/index.ts', '/project/src/utils/helpers.ts'])
    expect(resolveImportPath('./utils', '/project/src/app.ts', files, ROOT)).toBe(
      '/project/src/utils/index.ts'
    )
  })

  it('resolves .tsx extension', () => {
    expect(resolveImportPath('./components/Button', '/project/src/app.ts', allFiles, ROOT)).toBe(
      '/project/src/components/Button.tsx'
    )
  })

  it('resolves ../lib path', () => {
    expect(resolveImportPath('../lib/helper', '/project/src/app.ts', allFiles, ROOT)).toBe(
      '/project/lib/helper.js'
    )
  })

  it('returns null for bare specifier', () => {
    expect(resolveImportPath('react', '/project/src/app.ts', allFiles, ROOT)).toBeNull()
  })

  it('returns null for path outside root', () => {
    expect(
      resolveImportPath(
        '../../other/file',
        '/project/src/app.ts',
        new Set(['/other/file.ts']),
        ROOT
      )
    ).toBeNull()
  })

  it('returns null for non-existent file', () => {
    expect(resolveImportPath('./missing', '/project/src/app.ts', allFiles, ROOT)).toBeNull()
  })

  it('resolves .json extension', () => {
    expect(resolveImportPath('./data', '/project/src/app.ts', allFiles, ROOT)).toBe(
      '/project/src/data.json'
    )
  })

  it('resolves .md extension', () => {
    expect(
      resolveImportPath(
        './readme',
        '/project/src/app.ts',
        new Set(['/project/src/readme.md']),
        ROOT
      )
    ).toBe('/project/src/readme.md')
  })

  it('resolves an exact extensionless file before trying known extensions', () => {
    expect(
      resolveImportPath('./README', '/project/src/app.ts', new Set(['/project/src/README']), ROOT)
    ).toBe('/project/src/README')
  })
})

describe('extractMarkdownRefs', () => {
  it('extracts wikilinks', () => {
    expect(extractMarkdownRefs(`See [[some-note]] and [[another|display text]].`)).toEqual([
      'some-note',
      'another'
    ])
  })

  it('extracts relative markdown links', () => {
    expect(extractMarkdownRefs(`Check [this](./sibling.md) and [that](../other/file.md).`)).toEqual(
      ['./sibling.md', '../other/file.md']
    )
  })

  it('skips absolute URLs', () => {
    expect(extractMarkdownRefs(`[site](https://example.com)`)).toEqual([])
  })

  it('extracts both wikilinks and relative links', () => {
    expect(extractMarkdownRefs(`[[note1]] and [link](./file.md)`)).toEqual(['note1', './file.md'])
  })

  it('handles empty content', () => {
    expect(extractMarkdownRefs('')).toEqual([])
  })
})

describe('extractConfigPathRefs', () => {
  it('extracts relative path values from JSON', () => {
    expect(
      extractConfigPathRefs(`{"main": "./src/index.ts", "types": "./dist/index.d.ts"}`)
    ).toEqual(['./src/index.ts', './dist/index.d.ts'])
  })

  it('skips non-relative string values', () => {
    expect(extractConfigPathRefs(`{"name": "my-package", "version": "1.0.0"}`)).toEqual([])
  })

  it('extracts paths from YAML-like content', () => {
    expect(extractConfigPathRefs(`main: ./src/index.ts\noutput: ../dist/bundle.js`)).toEqual([
      './src/index.ts',
      '../dist/bundle.js'
    ])
  })

  it('handles empty content', () => {
    expect(extractConfigPathRefs('')).toEqual([])
  })
})

describe('buildProjectMapSnapshot', () => {
  const ROOT = '/project'
  const defaultOpts: ProjectMapOptions = { expandDepth: 2, maxNodes: 200 }

  it('creates a root folder node even when the folder is empty', () => {
    const snapshot = buildProjectMapSnapshot(ROOT, [], defaultOpts)
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]).toEqual(
      expect.objectContaining({
        relativePath: '.',
        isDirectory: true,
        childCount: 0
      })
    )
  })

  it('builds nodes for a simple folder', () => {
    const files = [
      { path: '/project/src/app.ts', content: '' },
      { path: '/project/src/utils.ts', content: '' }
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(snapshot.nodes.length).toBe(4) // root + src + 2 files
    expect(snapshot.nodes.filter((n) => n.isDirectory).length).toBe(2)
  })

  it('builds contains edges for parent-child', () => {
    const snapshot = buildProjectMapSnapshot(
      ROOT,
      [{ path: '/project/src/app.ts', content: '' }],
      defaultOpts
    )
    expect(snapshot.edges.filter((e) => e.kind === 'contains').length).toBe(2) // root->src, src->app
  })

  it('builds imports edges from import specifiers', () => {
    const files = [
      { path: '/project/src/app.ts', content: `import { foo } from './utils'` },
      { path: '/project/src/utils.ts', content: '' }
    ]
    expect(
      buildProjectMapSnapshot(ROOT, files, defaultOpts).edges.filter((e) => e.kind === 'imports')
        .length
    ).toBe(1)
  })

  it('builds references edges from markdown wikilinks', () => {
    const files = [
      { path: '/project/docs/index.md', content: `See [[guide]]` },
      { path: '/project/docs/guide.md', content: '' }
    ]
    expect(
      buildProjectMapSnapshot(ROOT, files, defaultOpts).edges.filter((e) => e.kind === 'references')
        .length
    ).toBe(1)
  })

  it('reports unresolved refs', () => {
    const files = [{ path: '/project/src/app.ts', content: `import { foo } from './nonexistent'` }]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(snapshot.unresolvedRefs.length).toBe(1)
    expect(snapshot.unresolvedRefs[0]).toContain('nonexistent')
  })

  it('generates deterministic IDs', () => {
    const files = [{ path: '/project/src/app.ts', content: '' }]
    const s1 = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    const s2 = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(s1.nodes.map((n) => n.id)).toEqual(s2.nodes.map((n) => n.id))
  })

  it('respects maxNodes', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `/project/file${i}.ts`,
      content: ''
    }))
    const snapshot = buildProjectMapSnapshot(ROOT, files, { expandDepth: 2, maxNodes: 10 })
    expect(snapshot.nodes.length).toBeLessThanOrEqual(10)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.totalFileCount).toBe(50)
  })

  it('skips binary files and counts them', () => {
    const files = [
      { path: '/project/image.png', content: '' },
      { path: '/project/app.ts', content: '' }
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(snapshot.nodes.filter((n) => !n.isDirectory).length).toBe(1)
    expect(snapshot.skippedCount).toBe(1)
  })

  it('handles files with read errors', () => {
    const files = [
      { path: '/project/app.ts', content: null as unknown as string, error: 'read failed' }
    ]
    expect(buildProjectMapSnapshot(ROOT, files, defaultOpts).skippedCount).toBe(1)
  })

  it('retains folder structure for skipped files', () => {
    const files = [{ path: '/project/assets/logo.png', content: null, error: 'binary-skipped' }]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(snapshot.skippedCount).toBe(1)
    expect(snapshot.totalFileCount).toBe(1)
    expect(snapshot.nodes.map((node) => node.relativePath)).toEqual(['.', 'assets'])
    expect(snapshot.edges).toEqual([
      expect.objectContaining({
        kind: 'contains',
        source: snapshot.nodes[0].id,
        target: snapshot.nodes[1].id
      })
    ])
  })
})
