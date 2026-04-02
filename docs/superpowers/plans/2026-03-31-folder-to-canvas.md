# Folder-to-Canvas Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map a selected folder's structure and file relationships onto the canvas as positioned cards with typed edges, with preview/apply UX and agent API surface.

**Architecture:** Worker-backed analysis pipeline separated from VaultIndex/KnowledgeGraph. Main process owns file I/O only; renderer Web Worker owns all analysis and layout. Preview/apply pattern with single-batch undo. Agent surface via IPC then MCP.

**Tech Stack:** Electron, TypeScript strict, React, Zustand, Vitest, Web Workers, d3 (for layout reference), p-limit

**Spec:** `docs/superpowers/specs/2026-03-31-folder-to-canvas-design.md`

---

## File Structure

### New Files

### Modified Files

---

## Phase 1A: Shared Types + Pure Analyzers

### Task 1: Project-Map Types

**Files:**

- Create: `src/shared/engine/project-map-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/shared/engine/project-map-types.ts

import type { CanvasNodeType } from '../canvas-types'

/** Edge kinds specific to the project-map domain.
 *  At the canvas level these flow through the (string & {}) escape hatch
 *  on CanvasEdge.kind — no modification to CanvasEdgeKind union needed.
 */
export type ProjectMapEdgeKind = 'contains' | 'imports' | 'references'

export interface ProjectMapNode {
  readonly id: string
  readonly relativePath: string
  readonly name: string
  readonly isDirectory: boolean
  readonly nodeType: CanvasNodeType
  readonly depth: number
  readonly lineCount: number
  readonly children: readonly string[]
  readonly childCount: number
  readonly error?: string
}

export interface ProjectMapEdge {
  readonly source: string
  readonly target: string
  readonly kind: ProjectMapEdgeKind
}

export interface ProjectMapSnapshot {
  readonly rootPath: string
  readonly nodes: readonly ProjectMapNode[]
  readonly edges: readonly ProjectMapEdge[]
  readonly truncated: boolean
  readonly totalFileCount: number
  readonly skippedCount: number
  readonly unresolvedRefs: readonly string[]
}

export interface ProjectMapOptions {
  readonly expandDepth: number
  readonly maxNodes: number
}

export const DEFAULT_PROJECT_MAP_OPTIONS: ProjectMapOptions = {
  expandDepth: 2,
  maxNodes: 200,
} as const

/** Extensions that are treated as binary (skipped, not analyzed). */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.sqlite', '.db',
])

/** Check if a file path has a binary extension. */
export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return false
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/**
 * Generate a stable, deterministic node ID from root path + relative path.
 * Same input always produces same ID.
 */
export function stableNodeId(rootPath: string, relativePath: string): string {
  // Simple hash: use a prefix + base64-like encoding of the key
  const key = `${rootPath}::${relativePath}`
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  return `pm_${(hash >>> 0).toString(36)}`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx tsc --noEmit --project tsconfig.node.json 2>&1 | head -20`
Expected: No errors related to `project-map-types.ts`

- [ ] **Step 3: Commit**

```bash
git add src/shared/engine/project-map-types.ts
git commit -m "feat: add project-map shared types"
```

---

### Task 2: Import Extraction Analyzer

**Files:**

- Create: `src/shared/engine/project-map-analyzers.ts`
- Create: `tests/engine/project-map-analyzers.test.ts`

- [ ] **Step 1: Write failing tests for ES import extraction**

```typescript
// tests/engine/project-map-analyzers.test.ts

import { describe, it, expect } from 'vitest'
import { extractImportSpecifiers } from '@shared/engine/project-map-analyzers'

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
      `const c = require('./c')`,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: FAIL — `extractImportSpecifiers` not found

- [ ] **Step 3: Implement extractImportSpecifiers**

```typescript
// src/shared/engine/project-map-analyzers.ts

/**
 * Project-map analyzers: pure functions for extracting file relationships.
 * Zero dependencies beyond project-map-types. Worker-safe.
 */

import type { ProjectMapEdge, ProjectMapNode } from './project-map-types'
import { stableNodeId, isBinaryPath } from './project-map-types'

// ─── Import Extraction ──────────────────────────────────────────────

/**
 * Extract relative import/require specifiers from JS/TS source code.
 * Only returns specifiers starting with './' or '../'.
 * Skips bare package specifiers, URLs, and aliases.
 */
export function extractImportSpecifiers(code: string): readonly string[] {
  const specifiers: string[] = []

  // ES imports: import ... from '...' and export ... from '...'
  const esImportRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = esImportRe.exec(code)) !== null) {
    const spec = match[1]
    if (spec.startsWith('./') || spec.startsWith('../')) {
      specifiers.push(spec)
    }
  }

  // Dynamic import: import('...')
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicRe.exec(code)) !== null) {
    const spec = match[1]
    if ((spec.startsWith('./') || spec.startsWith('../')) && !specifiers.includes(spec)) {
      specifiers.push(spec)
    }
  }

  // CJS require: require('...')
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = requireRe.exec(code)) !== null) {
    const spec = match[1]
    if ((spec.startsWith('./') || spec.startsWith('../')) && !specifiers.includes(spec)) {
      specifiers.push(spec)
    }
  }

  return specifiers
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add import specifier extraction analyzer"
```

---

### Task 3: Path Resolution

**Files:**

- Modify: `src/shared/engine/project-map-analyzers.ts`
- Modify: `tests/engine/project-map-analyzers.test.ts`

- [ ] **Step 1: Write failing tests for resolveImportPath**

Add to `tests/engine/project-map-analyzers.test.ts`:

```typescript
import { extractImportSpecifiers, resolveImportPath } from '@shared/engine/project-map-analyzers'

describe('resolveImportPath', () => {
  const ROOT = '/project'
  const allFiles = new Set([
    '/project/src/utils.ts',
    '/project/src/utils/index.ts',
    '/project/src/components/Button.tsx',
    '/project/src/data.json',
    '/project/src/notes/idea.md',
    '/project/lib/helper.js',
  ])

  it('resolves relative import with explicit extension', () => {
    const result = resolveImportPath('./utils.ts', '/project/src/app.ts', allFiles, ROOT)
    expect(result).toBe('/project/src/utils.ts')
  })

  it('resolves extensionless import trying extensions in order', () => {
    const result = resolveImportPath('./utils', '/project/src/app.ts', allFiles, ROOT)
    expect(result).toBe('/project/src/utils.ts')
  })

  it('resolves directory import to index file', () => {
    // When './utils' resolves to a directory with index.ts
    const files = new Set(['/project/src/utils/index.ts', '/project/src/utils/helpers.ts'])
    const result = resolveImportPath('./utils', '/project/src/app.ts', files, ROOT)
    expect(result).toBe('/project/src/utils/index.ts')
  })

  it('resolves .tsx extension', () => {
    const result = resolveImportPath('./components/Button', '/project/src/app.ts', allFiles, ROOT)
    expect(result).toBe('/project/src/components/Button.tsx')
  })

  it('resolves ../lib path', () => {
    const result = resolveImportPath('../lib/helper', '/project/src/app.ts', allFiles, ROOT)
    expect(result).toBe('/project/lib/helper.js')
  })

  it('returns null for bare specifier', () => {
    const result = resolveImportPath('react', '/project/src/app.ts', allFiles, ROOT)
    expect(result).toBeNull()
  })

  it('returns null for path outside root', () => {
    const outsideFiles = new Set(['/other/file.ts'])
    const result = resolveImportPath('../../other/file', '/project/src/app.ts', outsideFiles, ROOT)
    expect(result).toBeNull()
  })

  it('returns null for non-existent file', () => {
    const result = resolveImportPath('./missing', '/project/src/app.ts', allFiles, ROOT)
    expect(result).toBeNull()
  })

  it('resolves .json extension', () => {
    const result = resolveImportPath('./data', '/project/src/app.ts', allFiles, ROOT)
    // .ts first, but no /project/src/data.ts exists; .tsx no; .js no; ... .json yes
    expect(result).toBe('/project/src/data.json')
  })

  it('resolves .md extension', () => {
    const files = new Set(['/project/src/readme.md'])
    const result = resolveImportPath('./readme', '/project/src/app.ts', files, ROOT)
    expect(result).toBe('/project/src/readme.md')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: FAIL — `resolveImportPath` not found

- [ ] **Step 3: Implement resolveImportPath**

Add to `src/shared/engine/project-map-analyzers.ts`:

```typescript
import * as path from 'path'

// ─── Path Resolution ──────────────────────────────────────────────

const EXTENSION_PRIORITY = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md'] as const
const INDEX_PRIORITY = EXTENSION_PRIORITY.map((ext) => `index${ext}`)

/**
 * Resolve a single import specifier to an absolute file path.
 * Returns null if: bare specifier, outside root, or no file match.
 */
export function resolveImportPath(
  specifier: string,
  importingFile: string,
  allFilePaths: ReadonlySet<string>,
  rootPath: string,
): string | null {
  // Only resolve relative specifiers
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null

  const resolved = path.resolve(path.dirname(importingFile), specifier)

  // Boundary check
  if (!resolved.startsWith(rootPath + '/') && resolved !== rootPath) return null

  // 1. Explicit extension — exact match
  const hasExtension = path.extname(specifier) !== ''
  if (hasExtension) {
    return allFilePaths.has(resolved) ? resolved : null
  }

  // 2. Try with each extension
  for (const ext of EXTENSION_PRIORITY) {
    const candidate = resolved + ext
    if (allFilePaths.has(candidate)) return candidate
  }

  // 3. Directory resolution — try index files
  for (const indexFile of INDEX_PRIORITY) {
    const candidate = path.join(resolved, indexFile)
    if (allFilePaths.has(candidate)) return candidate
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add deterministic import path resolution"
```

---

### Task 4: Markdown + Config Ref Analyzers

**Files:**

- Modify: `src/shared/engine/project-map-analyzers.ts`
- Modify: `tests/engine/project-map-analyzers.test.ts`

- [ ] **Step 1: Write failing tests for markdown and config analyzers**

Add to `tests/engine/project-map-analyzers.test.ts`:

```typescript
import {
  extractImportSpecifiers,
  resolveImportPath,
  extractMarkdownRefs,
  extractConfigPathRefs,
} from '@shared/engine/project-map-analyzers'

describe('extractMarkdownRefs', () => {
  it('extracts wikilinks', () => {
    const md = `See [[some-note]] and also [[another|display text]].`
    expect(extractMarkdownRefs(md)).toEqual(['some-note', 'another'])
  })

  it('extracts relative markdown links', () => {
    const md = `Check [this](./sibling.md) and [that](../other/file.md).`
    expect(extractMarkdownRefs(md)).toEqual(['./sibling.md', '../other/file.md'])
  })

  it('skips absolute URLs', () => {
    const md = `Visit [site](https://example.com) and [ftp](ftp://host/file).`
    expect(extractMarkdownRefs(md)).toEqual([])
  })

  it('extracts both wikilinks and relative links', () => {
    const md = `[[note1]] and [link](./file.md)`
    expect(extractMarkdownRefs(md)).toEqual(['note1', './file.md'])
  })

  it('handles empty content', () => {
    expect(extractMarkdownRefs('')).toEqual([])
  })
})

describe('extractConfigPathRefs', () => {
  it('extracts relative path values from JSON', () => {
    const json = `{"main": "./src/index.ts", "types": "./dist/index.d.ts"}`
    expect(extractConfigPathRefs(json)).toEqual(['./src/index.ts', './dist/index.d.ts'])
  })

  it('skips non-relative string values', () => {
    const json = `{"name": "my-package", "version": "1.0.0", "license": "MIT"}`
    expect(extractConfigPathRefs(json)).toEqual([])
  })

  it('extracts paths from YAML-like content', () => {
    const yaml = `main: ./src/index.ts\noutput: ../dist/bundle.js`
    expect(extractConfigPathRefs(yaml)).toEqual(['./src/index.ts', '../dist/bundle.js'])
  })

  it('handles empty content', () => {
    expect(extractConfigPathRefs('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement markdown and config analyzers**

Add to `src/shared/engine/project-map-analyzers.ts`:

```typescript
// ─── Markdown Reference Extraction ──────────────────────────────────

/**
 * Extract wikilinks and relative markdown links from markdown content.
 * Returns raw specifier strings (wikilink targets or relative paths).
 */
export function extractMarkdownRefs(content: string): readonly string[] {
  const refs: string[] = []

  // Wikilinks: [[target]] or [[target|display]]
  const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = wikilinkRe.exec(content)) !== null) {
    refs.push(match[1])
  }

  // Relative markdown links: [text](./path) or [text](../path)
  const mdLinkRe = /\[(?:[^\]]*)\]\((\.[^)]+)\)/g
  while ((match = mdLinkRe.exec(content)) !== null) {
    const href = match[1]
    if (href.startsWith('./') || href.startsWith('../')) {
      refs.push(href)
    }
  }

  return refs
}

// ─── Config Path Reference Extraction ────────────────────────────────

/**
 * Extract relative path strings from JSON/YAML/TOML content.
 * Only returns values that look like relative paths (start with ./ or ../).
 */
export function extractConfigPathRefs(content: string): readonly string[] {
  const refs: string[] = []

  // Match quoted string values that start with ./ or ../
  const quotedPathRe = /["'](\.\.\/.+?|\.\/[^"']+?)["']/g
  let match: RegExpExecArray | null
  while ((match = quotedPathRe.exec(content)) !== null) {
    refs.push(match[1])
  }

  // Match unquoted YAML values: key: ./path or key: ../path
  const yamlPathRe = /:\s+(\.\.\/.+|\.\/\S+)/g
  while ((match = yamlPathRe.exec(content)) !== null) {
    const val = match[1]
    if (!refs.includes(val)) {
      refs.push(val)
    }
  }

  return refs
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add markdown and config path reference analyzers"
```

---

### Task 5: Snapshot Builder (buildProjectMapSnapshot)

**Files:**

- Modify: `src/shared/engine/project-map-analyzers.ts`
- Modify: `tests/engine/project-map-analyzers.test.ts`

- [ ] **Step 1: Write failing tests for buildProjectMapSnapshot**

Add to `tests/engine/project-map-analyzers.test.ts`:

```typescript
import {
  extractImportSpecifiers,
  resolveImportPath,
  extractMarkdownRefs,
  extractConfigPathRefs,
  buildProjectMapSnapshot,
} from '@shared/engine/project-map-analyzers'
import type { ProjectMapOptions } from '@shared/engine/project-map-types'

describe('buildProjectMapSnapshot', () => {
  const ROOT = '/project'
  const defaultOpts: ProjectMapOptions = { expandDepth: 2, maxNodes: 200 }

  it('builds nodes for a simple folder', () => {
    const files = [
      { path: '/project/src/app.ts', content: '' },
      { path: '/project/src/utils.ts', content: '' },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    // Root folder + src folder + 2 files = 4 nodes
    expect(snapshot.nodes.length).toBe(4)
    expect(snapshot.nodes.filter((n) => n.isDirectory).length).toBe(2)
    expect(snapshot.nodes.filter((n) => !n.isDirectory).length).toBe(2)
  })

  it('builds contains edges for parent-child', () => {
    const files = [
      { path: '/project/src/app.ts', content: '' },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    const containsEdges = snapshot.edges.filter((e) => e.kind === 'contains')
    // root -> src, src -> app.ts
    expect(containsEdges.length).toBe(2)
  })

  it('builds imports edges from import specifiers', () => {
    const files = [
      { path: '/project/src/app.ts', content: `import { foo } from './utils'` },
      { path: '/project/src/utils.ts', content: '' },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    const importEdges = snapshot.edges.filter((e) => e.kind === 'imports')
    expect(importEdges.length).toBe(1)
  })

  it('builds references edges from markdown wikilinks', () => {
    const files = [
      { path: '/project/docs/index.md', content: `See [[guide]]` },
      { path: '/project/docs/guide.md', content: '' },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    const refEdges = snapshot.edges.filter((e) => e.kind === 'references')
    expect(refEdges.length).toBe(1)
  })

  it('reports unresolved refs', () => {
    const files = [
      { path: '/project/src/app.ts', content: `import { foo } from './nonexistent'` },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(snapshot.unresolvedRefs.length).toBe(1)
    expect(snapshot.unresolvedRefs[0]).toContain('nonexistent')
  })

  it('generates deterministic IDs', () => {
    const files = [{ path: '/project/src/app.ts', content: '' }]
    const snap1 = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    const snap2 = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    expect(snap1.nodes.map((n) => n.id)).toEqual(snap2.nodes.map((n) => n.id))
  })

  it('respects maxNodes', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `/project/file${i}.ts`,
      content: '',
    }))
    const snapshot = buildProjectMapSnapshot(ROOT, files, { expandDepth: 2, maxNodes: 10 })
    expect(snapshot.nodes.length).toBeLessThanOrEqual(10)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.totalFileCount).toBe(50)
  })

  it('skips binary files and counts them', () => {
    const files = [
      { path: '/project/image.png', content: '' },
      { path: '/project/app.ts', content: '' },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts)
    const fileNodes = snapshot.nodes.filter((n) => !n.isDirectory)
    expect(fileNodes.length).toBe(1) // only app.ts
    expect(snapshot.skippedCount).toBe(1)
  })

  it('handles files with read errors', () => {
    const files = [
      { path: '/project/app.ts', content: null as unknown as string, error: 'read failed' },
    ]
    const snapshot = buildProjectMapSnapshot(ROOT, files, defaultOpts as ProjectMapOptions)
    expect(snapshot.skippedCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: FAIL — `buildProjectMapSnapshot` not found

- [ ] **Step 3: Implement buildProjectMapSnapshot**

Add to `src/shared/engine/project-map-analyzers.ts`:

```typescript
import type { ProjectMapEdge, ProjectMapNode, ProjectMapOptions } from './project-map-types'
import { stableNodeId, isBinaryPath } from './project-map-types'

// ─── File Type Detection ─────────────────────────────────────────────

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const MD_EXTENSIONS = new Set(['.md', '.mdx'])
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml'])

function inferNodeType(filePath: string): CanvasNodeType {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  if (MD_EXTENSIONS.has(ext)) return 'note'
  if (TS_EXTENSIONS.has(ext) || CONFIG_EXTENSIONS.has(ext)) return 'project-file'
  return 'project-file'
}

// ─── Wikilink Resolution ──────────────────────────────────────────────

function resolveWikilink(
  target: string,
  allFilePaths: ReadonlySet<string>,
  rootPath: string,
): string | null {
  const normalized = target.toLowerCase()
  for (const fp of allFilePaths) {
    if (!fp.startsWith(rootPath)) continue
    const stem = path.basename(fp, path.extname(fp)).toLowerCase()
    if (stem === normalized) return fp
  }
  return null
}

// ─── Snapshot Builder ──────────────────────────────────────────────

export interface FileInput {
  readonly path: string
  readonly content: string | null
  readonly error?: string
}

/**
 * Build a ProjectMapSnapshot from a root path and file contents.
 * Pure function — no I/O. Extracts containment, imports, and references.
 */
export function buildProjectMapSnapshot(
  rootPath: string,
  files: readonly FileInput[],
  options: ProjectMapOptions,
): ProjectMapSnapshot {
  const allFilePaths = new Set(files.filter((f) => f.content !== null).map((f) => f.path))
  const nodes: ProjectMapNode[] = []
  const edges: ProjectMapEdge[] = []
  const unresolvedRefs: string[] = []
  let skippedCount = 0

  // Track directories we've seen
  const dirNodes = new Map<string, ProjectMapNode>()

  // Ensure root dir node exists
  function ensureDirNode(dirPath: string, depth: number): ProjectMapNode {
    const existing = dirNodes.get(dirPath)
    if (existing) return existing
    const relativePath = dirPath === rootPath ? '' : path.relative(rootPath, dirPath)
    const node: ProjectMapNode = {
      id: stableNodeId(rootPath, relativePath || '.'),
      relativePath: relativePath || '.',
      name: path.basename(dirPath) || path.basename(rootPath),
      isDirectory: true,
      nodeType: 'project-folder' as CanvasNodeType,
      depth,
      lineCount: 0,
      children: [],
      childCount: 0,
    }
    dirNodes.set(dirPath, node)
    return node
  }

  // Build directory tree + file nodes
  const fileNodes = new Map<string, ProjectMapNode>()

  for (const file of files) {
    if (file.content === null || file.error) {
      skippedCount++
      continue
    }

    if (isBinaryPath(file.path)) {
      skippedCount++
      continue
    }

    const relativePath = path.relative(rootPath, file.path)
    const depth = relativePath.split(path.sep).length
    const lineCount = file.content.split('\n').length

    const node: ProjectMapNode = {
      id: stableNodeId(rootPath, relativePath),
      relativePath,
      name: path.basename(file.path),
      isDirectory: false,
      nodeType: inferNodeType(file.path),
      depth,
      lineCount,
      children: [],
      childCount: 0,
    }
    fileNodes.set(file.path, node)

    // Ensure parent directories exist
    let parentPath = path.dirname(file.path)
    let childPath = file.path
    let parentDepth = depth - 1

    while (parentPath.length >= rootPath.length) {
      const parentNode = ensureDirNode(parentPath, parentDepth)
      const childId = childPath === file.path
        ? node.id
        : (dirNodes.get(childPath)?.id ?? fileNodes.get(childPath)?.id ?? '')

      if (childId && !(parentNode.children as string[]).includes(childId)) {
        ;(parentNode.children as string[]).push(childId)
      }

      if (parentPath === rootPath) break
      childPath = parentPath
      parentPath = path.dirname(parentPath)
      parentDepth--
    }
  }

  // Collect all nodes, respecting maxNodes
  const allDirNodes = [...dirNodes.values()]
  const allFileNodes = [...fileNodes.values()]
  const totalFileCount = allFileNodes.length

  // Sort by depth for breadth-first truncation
  const sortedNodes = [...allDirNodes, ...allFileNodes].sort((a, b) => a.depth - b.depth)

  const truncated = sortedNodes.length > options.maxNodes
  const includedNodes = sortedNodes.slice(0, options.maxNodes)
  const includedIds = new Set(includedNodes.map((n) => n.id))

  // Update childCount for directories
  for (const node of includedNodes) {
    if (node.isDirectory) {
      ;(node as { childCount: number }).childCount = (node.children as string[]).length
    }
  }

  nodes.push(...includedNodes)

  // Build containment edges
  for (const dirNode of allDirNodes) {
    if (!includedIds.has(dirNode.id)) continue
    for (const childId of dirNode.children) {
      if (includedIds.has(childId)) {
        edges.push({ source: dirNode.id, target: childId, kind: 'contains' })
      }
    }
  }

  // Build import/reference edges
  for (const file of files) {
    if (file.content === null || file.error || isBinaryPath(file.path)) continue
    const sourceNode = fileNodes.get(file.path)
    if (!sourceNode || !includedIds.has(sourceNode.id)) continue

    const ext = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()

    // TS/JS imports
    if (TS_EXTENSIONS.has(ext)) {
      const specifiers = extractImportSpecifiers(file.content)
      for (const spec of specifiers) {
        const resolved = resolveImportPath(spec, file.path, allFilePaths, rootPath)
        if (resolved) {
          const targetNode = fileNodes.get(resolved)
          if (targetNode && includedIds.has(targetNode.id)) {
            edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'imports' })
          }
        } else {
          unresolvedRefs.push(`${sourceNode.relativePath}: ${spec}`)
        }
      }
    }

    // Markdown refs
    if (MD_EXTENSIONS.has(ext)) {
      const refs = extractMarkdownRefs(file.content)
      for (const ref of refs) {
        // Try as relative path first
        if (ref.startsWith('./') || ref.startsWith('../')) {
          const resolved = resolveImportPath(ref, file.path, allFilePaths, rootPath)
          if (resolved) {
            const targetNode = fileNodes.get(resolved)
            if (targetNode && includedIds.has(targetNode.id)) {
              edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references' })
            }
          } else {
            unresolvedRefs.push(`${sourceNode.relativePath}: ${ref}`)
          }
        } else {
          // Wikilink — resolve by filename stem
          const resolved = resolveWikilink(ref, allFilePaths, rootPath)
          if (resolved) {
            const targetNode = fileNodes.get(resolved)
            if (targetNode && includedIds.has(targetNode.id)) {
              edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references' })
            }
          } else {
            unresolvedRefs.push(`${sourceNode.relativePath}: [[${ref}]]`)
          }
        }
      }
    }

    // Config path refs
    if (CONFIG_EXTENSIONS.has(ext)) {
      const refs = extractConfigPathRefs(file.content)
      for (const ref of refs) {
        const resolved = resolveImportPath(ref, file.path, allFilePaths, rootPath)
        if (resolved) {
          const targetNode = fileNodes.get(resolved)
          if (targetNode && includedIds.has(targetNode.id)) {
            edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references' })
          }
        }
        // Config refs that don't resolve are silently ignored (not added to unresolvedRefs)
      }
    }
  }

  return {
    rootPath,
    nodes,
    edges,
    truncated,
    totalFileCount,
    skippedCount,
    unresolvedRefs,
  }
}
```

Note: You will need to add the `CanvasNodeType` import at the top of the file:

```typescript
import type { CanvasNodeType } from '../canvas-types'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add project-map snapshot builder with containment, imports, and references"
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

---

## Phase 1B: Tree Layout Module

### Task 6: Reingold-Tilford Tree Layout

**Files:**

- Create: `src/renderer/src/panels/canvas/folder-map-layout.ts`
- Create: `tests/canvas/folder-map-layout.test.ts`

- [ ] **Step 1: Write failing tests for computeFolderMapLayout**

```typescript
// tests/canvas/folder-map-layout.test.ts

import { describe, it, expect } from 'vitest'
import { computeFolderMapLayout } from '../../src/renderer/src/panels/canvas/folder-map-layout'
import type { ProjectMapSnapshot } from '@shared/engine/project-map-types'
import type { CanvasNode } from '@shared/canvas-types'

function makeSnapshot(overrides: Partial<ProjectMapSnapshot> = {}): ProjectMapSnapshot {
  return {
    rootPath: '/project',
    nodes: [],
    edges: [],
    truncated: false,
    totalFileCount: 0,
    skippedCount: 0,
    unresolvedRefs: [],
    ...overrides,
  }
}

describe('computeFolderMapLayout', () => {
  it('returns empty result for empty snapshot', () => {
    const result = computeFolderMapLayout(makeSnapshot(), { x: 0, y: 0 }, [])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('positions root node at origin', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: [],
          childCount: 0,
        },
      ],
    })
    const result = computeFolderMapLayout(snapshot, { x: 100, y: 200 }, [])
    expect(result.nodes.length).toBe(1)
    expect(result.nodes[0].position.x).toBe(100)
    expect(result.nodes[0].position.y).toBe(200)
  })

  it('places children below parent with levelGap spacing', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root', relativePath: '.', name: 'project',
          isDirectory: true, nodeType: 'project-folder', depth: 0,
          lineCount: 0, children: ['child1'], childCount: 1,
        },
        {
          id: 'child1', relativePath: 'app.ts', name: 'app.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 10, children: [], childCount: 0,
        },
      ],
      edges: [{ source: 'root', target: 'child1', kind: 'contains' }],
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    expect(result.nodes.length).toBe(2)
    const root = result.nodes.find((n) => n.metadata.relativePath === '.')!
    const child = result.nodes.find((n) => n.metadata.relativePath === 'app.ts')!
    expect(child.position.y).toBeGreaterThan(root.position.y)
  })

  it('centers parent over multiple children', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root', relativePath: '.', name: 'project',
          isDirectory: true, nodeType: 'project-folder', depth: 0,
          lineCount: 0, children: ['c1', 'c2', 'c3'], childCount: 3,
        },
        {
          id: 'c1', relativePath: 'a.ts', name: 'a.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 5, children: [], childCount: 0,
        },
        {
          id: 'c2', relativePath: 'b.ts', name: 'b.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 5, children: [], childCount: 0,
        },
        {
          id: 'c3', relativePath: 'c.ts', name: 'c.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 5, children: [], childCount: 0,
        },
      ],
      edges: [
        { source: 'root', target: 'c1', kind: 'contains' },
        { source: 'root', target: 'c2', kind: 'contains' },
        { source: 'root', target: 'c3', kind: 'contains' },
      ],
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const root = result.nodes.find((n) => n.metadata.relativePath === '.')!
    const children = result.nodes.filter((n) => !n.metadata.relativePath?.toString().includes('.'))
    const childXs = result.nodes
      .filter((n) => n.metadata.relativePath !== '.')
      .map((n) => n.position.x + n.size.width / 2)
    const childCenter = (Math.min(...childXs) + Math.max(...childXs)) / 2
    const rootCenter = root.position.x + root.size.width / 2
    // Parent should be roughly centered over children
    expect(Math.abs(rootCenter - childCenter)).toBeLessThan(10)
  })

  it('avoids collision with existing canvas nodes', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root', relativePath: '.', name: 'project',
          isDirectory: true, nodeType: 'project-folder', depth: 0,
          lineCount: 0, children: [], childCount: 0,
        },
      ],
    })
    const existingNodes: CanvasNode[] = [
      {
        id: 'existing',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        content: 'test',
        metadata: {},
      },
    ]
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, existingNodes)
    // Should be shifted right to avoid the existing node
    expect(result.nodes[0].position.x).toBeGreaterThanOrEqual(500)
  })

  it('creates contains edges between canvas nodes', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root', relativePath: '.', name: 'project',
          isDirectory: true, nodeType: 'project-folder', depth: 0,
          lineCount: 0, children: ['child1'], childCount: 1,
        },
        {
          id: 'child1', relativePath: 'app.ts', name: 'app.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 10, children: [], childCount: 0,
        },
      ],
      edges: [{ source: 'root', target: 'child1', kind: 'contains' }],
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
    const containsEdge = result.edges.find((e) => e.kind === 'contains')
    expect(containsEdge).toBeDefined()
  })

  it('creates import edges with hidden flag', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root', relativePath: '.', name: 'project',
          isDirectory: true, nodeType: 'project-folder', depth: 0,
          lineCount: 0, children: ['f1', 'f2'], childCount: 2,
        },
        {
          id: 'f1', relativePath: 'a.ts', name: 'a.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 10, children: [], childCount: 0,
        },
        {
          id: 'f2', relativePath: 'b.ts', name: 'b.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 10, children: [], childCount: 0,
        },
      ],
      edges: [
        { source: 'root', target: 'f1', kind: 'contains' },
        { source: 'root', target: 'f2', kind: 'contains' },
        { source: 'f1', target: 'f2', kind: 'imports' },
      ],
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const importEdge = result.edges.find((e) => e.kind === 'imports')
    expect(importEdge).toBeDefined()
    expect(importEdge!.hidden).toBe(true)
  })

  it('produces deterministic output for same input', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root', relativePath: '.', name: 'project',
          isDirectory: true, nodeType: 'project-folder', depth: 0,
          lineCount: 0, children: ['c1', 'c2'], childCount: 2,
        },
        {
          id: 'c1', relativePath: 'a.ts', name: 'a.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 5, children: [], childCount: 0,
        },
        {
          id: 'c2', relativePath: 'b.ts', name: 'b.ts',
          isDirectory: false, nodeType: 'project-file', depth: 1,
          lineCount: 5, children: [], childCount: 0,
        },
      ],
      edges: [
        { source: 'root', target: 'c1', kind: 'contains' },
        { source: 'root', target: 'c2', kind: 'contains' },
      ],
    })
    const r1 = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const r2 = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    expect(r1.nodes.map((n) => n.position)).toEqual(r2.nodes.map((n) => n.position))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/folder-map-layout.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement computeFolderMapLayout**

```typescript
// src/renderer/src/panels/canvas/folder-map-layout.ts

/**
 * Reingold-Tilford tree layout for folder maps.
 * Pure functions — imported by both the worker and tests.
 */

import type { CanvasNode, CanvasEdge, CanvasNodeType } from '@shared/canvas-types'
import { createCanvasNode, createCanvasEdge, getDefaultSize } from '@shared/canvas-types'
import type { ProjectMapSnapshot, ProjectMapEdge } from '@shared/engine/project-map-types'
import { computeOptimalEdgeSides } from './canvas-layout'
import { computeOriginOffset } from './import-logic'

export interface TreeLayoutOptions {
  readonly levelGap: number
  readonly siblingGap: number
  readonly clusterGap: number
}

export interface FolderMapLayoutResult {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

const DEFAULT_LAYOUT_OPTIONS: TreeLayoutOptions = {
  levelGap: 200,
  siblingGap: 40,
  clusterGap: 120,
}

const FOLDER_SIZE = { width: 260, height: 80 }

// ─── Internal tree node for layout computation ──────────────────────

interface LayoutNode {
  readonly pmId: string
  readonly name: string
  readonly isDirectory: boolean
  readonly nodeType: CanvasNodeType
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly metadata: Record<string, unknown>
  readonly children: LayoutNode[]
  subtreeWidth: number
  x: number
  y: number
}

function getNodeSize(isDirectory: boolean, nodeType: CanvasNodeType): { width: number; height: number } {
  if (isDirectory) return FOLDER_SIZE
  return getDefaultSize(nodeType)
}

// ─── Build layout tree from snapshot ────────────────────────────────

function buildLayoutTree(snapshot: ProjectMapSnapshot): LayoutNode | null {
  const nodeMap = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const childIds = new Set(
    snapshot.edges.filter((e) => e.kind === 'contains').map((e) => e.target),
  )

  // Root is the node that is never a child
  const rootPm = snapshot.nodes.find((n) => !childIds.has(n.id) && n.isDirectory)
  if (!rootPm) return snapshot.nodes.length > 0 ? leafNode(snapshot.nodes[0], snapshot.rootPath) : null

  function buildNode(pmId: string): LayoutNode | null {
    const pm = nodeMap.get(pmId)
    if (!pm) return null

    const size = getNodeSize(pm.isDirectory, pm.nodeType)
    const children: LayoutNode[] = []

    if (pm.isDirectory) {
      const childEdges = snapshot.edges.filter((e) => e.kind === 'contains' && e.source === pmId)
      for (const edge of childEdges) {
        const child = buildNode(edge.target)
        if (child) children.push(child)
      }
      // Sort: directories first, then alphabetical
      children.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }

    const metadata: Record<string, unknown> = pm.isDirectory
      ? { relativePath: pm.relativePath, rootPath: snapshot.rootPath, childCount: pm.childCount, collapsed: false }
      : { relativePath: pm.relativePath, folderMapRoot: snapshot.rootPath }

    return {
      pmId,
      name: pm.name,
      isDirectory: pm.isDirectory,
      nodeType: pm.nodeType,
      width: size.width,
      height: size.height,
      depth: pm.depth,
      metadata,
      children,
      subtreeWidth: 0,
      x: 0,
      y: 0,
    }
  }

  return buildNode(rootPm.id)
}

function leafNode(pm: { id: string; name: string; isDirectory: boolean; nodeType: CanvasNodeType; relativePath: string; depth: number }, rootPath: string): LayoutNode {
  const size = getNodeSize(pm.isDirectory, pm.nodeType)
  return {
    pmId: pm.id, name: pm.name, isDirectory: pm.isDirectory, nodeType: pm.nodeType,
    width: size.width, height: size.height, depth: pm.depth,
    metadata: { relativePath: pm.relativePath, rootPath },
    children: [], subtreeWidth: 0, x: 0, y: 0,
  }
}

// ─── Reingold-Tilford layout passes ──────────────────────────────────

function computeSubtreeWidths(node: LayoutNode, opts: TreeLayoutOptions): void {
  if (node.children.length === 0) {
    node.subtreeWidth = node.width
    return
  }
  for (const child of node.children) {
    computeSubtreeWidths(child, opts)
  }
  const gap = node.children[0]?.isDirectory ? opts.clusterGap : opts.siblingGap
  const childrenWidth = node.children.reduce((sum, c) => sum + c.subtreeWidth, 0)
    + (node.children.length - 1) * gap
  node.subtreeWidth = Math.max(node.width, childrenWidth)
}

function assignPositions(
  node: LayoutNode,
  x: number,
  y: number,
  opts: TreeLayoutOptions,
): void {
  // Center this node over its subtree
  node.x = x + (node.subtreeWidth - node.width) / 2
  node.y = y

  if (node.children.length === 0) return

  const gap = node.children[0]?.isDirectory ? opts.clusterGap : opts.siblingGap
  let childX = x
  for (const child of node.children) {
    assignPositions(child, childX, y + node.height + opts.levelGap, opts)
    childX += child.subtreeWidth + gap
  }
}

// ─── Collect positioned nodes into CanvasNode[] ──────────────────────

function collectCanvasNodes(node: LayoutNode, rootPath: string): CanvasNode[] {
  const result: CanvasNode[] = []

  function walk(n: LayoutNode): void {
    const canvasNode = createCanvasNode(
      n.isDirectory ? ('project-folder' as CanvasNodeType) : n.nodeType,
      { x: n.x, y: n.y },
      {
        size: { width: n.width, height: n.height },
        content: n.isDirectory ? '' : `${rootPath}/${n.metadata.relativePath}`,
        metadata: n.metadata,
      },
    )
    // Override the random ID with the deterministic project-map ID
    ;(canvasNode as { id: string }).id = n.pmId
    result.push(canvasNode)

    for (const child of n.children) {
      walk(child)
    }
  }

  walk(node)
  return result
}

// ─── Build canvas edges ──────────────────────────────────────────────

function buildCanvasEdges(
  snapshot: ProjectMapSnapshot,
  canvasNodes: readonly CanvasNode[],
): CanvasEdge[] {
  const nodeMap = new Map(canvasNodes.map((n) => [n.id, n]))
  const edges: CanvasEdge[] = []

  for (const pmEdge of snapshot.edges) {
    const from = nodeMap.get(pmEdge.source)
    const to = nodeMap.get(pmEdge.target)
    if (!from || !to) continue

    const { fromSide, toSide } = computeOptimalEdgeSides(from, to)
    const edge = createCanvasEdge(from.id, to.id, fromSide, toSide, pmEdge.kind)

    // imports and references edges are hidden by default
    if (pmEdge.kind === 'imports' || pmEdge.kind === 'references') {
      ;(edge as { hidden: boolean }).hidden = true
    }

    edges.push(edge)
  }

  return edges
}

// ─── Public API ──────────────────────────────────────────────────────

export function computeFolderMapLayout(
  snapshot: ProjectMapSnapshot,
  origin: { x: number; y: number },
  existingNodes: readonly CanvasNode[],
  options?: Partial<TreeLayoutOptions>,
): FolderMapLayoutResult {
  if (snapshot.nodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options }

  const tree = buildLayoutTree(snapshot)
  if (!tree) return { nodes: [], edges: [] }

  // 1. Bottom-up: compute subtree widths
  computeSubtreeWidths(tree, opts)

  // 2. Top-down: assign positions starting at origin
  assignPositions(tree, origin.x, origin.y, opts)

  // 3. Collect into canvas nodes
  const canvasNodes = collectCanvasNodes(tree, snapshot.rootPath)

  // 4. Collision resolution: shift right if overlapping existing nodes
  if (existingNodes.length > 0) {
    const offset = computeOriginOffset(existingNodes)
    if (offset > origin.x) {
      const shift = offset - origin.x
      for (const node of canvasNodes) {
        ;(node.position as { x: number }).x += shift
      }
    }
  }

  // 5. Build edges
  const canvasEdges = buildCanvasEdges(snapshot, canvasNodes)

  return { nodes: canvasNodes, edges: canvasEdges }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/folder-map-layout.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/folder-map-layout.ts tests/canvas/folder-map-layout.test.ts
git commit -m "feat: add Reingold-Tilford tree layout for folder maps"
```

---

## Phase 1C: Worker + Batch IPC

### Task 7: Batch File Read IPC Channel

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/filesystem.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add channel type to IPC channels**

In `src/shared/ipc-channels.ts`, add after the `'fs:file-mtime'` line (line 26):

```typescript
'fs:read-files-batch': {
  request: { paths: readonly string[] }
  response: Array<{ path: string; content: string | null; error?: string }>
}
```

- [ ] **Step 2: Add handler in filesystem.ts**

In `src/main/ipc/filesystem.ts`, add before the closing of `registerFilesystemIpc()`:

```typescript
typedHandle('fs:read-files-batch', async (args) => {
  const MAX_BATCH_SIZE = 50
  if (args.paths.length > MAX_BATCH_SIZE) {
    throw new Error(`fs:read-files-batch: batch size ${args.paths.length} exceeds max ${MAX_BATCH_SIZE}`)
  }

  const pLimit = (await import('p-limit')).default
  const limit = pLimit(8)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const results = await Promise.all(
      args.paths.map((filePath) =>
        limit(async () => {
          if (controller.signal.aborted) {
            return { path: filePath, content: null, error: 'timeout' }
          }
          try {
            const resolved = guardPath(filePath, 'fs:read-files-batch')
            const content = await fs.readFile(resolved, 'utf-8')
            return { path: filePath, content }
          } catch (err) {
            return { path: filePath, content: null, error: String(err) }
          }
        }),
      ),
    )
    return results
  } finally {
    clearTimeout(timeout)
  }
})
```

Add `import fs from 'fs/promises'` at the top if not already present.

- [ ] **Step 3: Expose in preload**

In `src/preload/index.ts`, add to the `fs` namespace:

```typescript
readFilesBatch: (paths: readonly string[]) => typedInvoke('fs:read-files-batch', { paths }),
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/filesystem.ts src/preload/index.ts
git commit -m "feat: add fs:read-files-batch IPC channel with PathGuard and p-limit"
```

---

### Task 8: Project-Map Worker

**Files:**

- Create: `src/renderer/src/workers/project-map-worker.ts`
- Create: `tests/canvas/project-map-worker.test.ts`

- [ ] **Step 1: Write failing tests for worker protocol**

```typescript
// tests/canvas/project-map-worker.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the worker logic directly by importing the message handler
// The worker file exports a processMessage function for testability
import { processWorkerMessage, resetWorkerState } from '../../src/renderer/src/workers/project-map-worker'

describe('project-map-worker', () => {
  let posted: unknown[]

  beforeEach(() => {
    posted = []
    resetWorkerState()
  })

  const postMessage = (msg: unknown) => { posted.push(msg) }

  it('start initializes operation', () => {
    processWorkerMessage(
      { type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } },
      postMessage,
    )
    // No output on start, just initialization
    expect(posted).toEqual([])
  })

  it('append-files posts progress', () => {
    processWorkerMessage(
      { type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } },
      postMessage,
    )
    processWorkerMessage(
      {
        type: 'append-files',
        operationId: 'op1',
        files: [{ path: '/project/app.ts', content: 'const x = 1' }],
      },
      postMessage,
    )
    expect(posted.length).toBe(1)
    expect((posted[0] as { type: string }).type).toBe('progress')
    expect((posted[0] as { operationId: string }).operationId).toBe('op1')
  })

  it('ignores append-files with wrong operationId', () => {
    processWorkerMessage(
      { type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } },
      postMessage,
    )
    processWorkerMessage(
      {
        type: 'append-files',
        operationId: 'stale-op',
        files: [{ path: '/project/app.ts', content: '' }],
      },
      postMessage,
    )
    expect(posted).toEqual([]) // silently ignored
  })

  it('finalize produces result', () => {
    processWorkerMessage(
      { type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } },
      postMessage,
    )
    processWorkerMessage(
      {
        type: 'append-files',
        operationId: 'op1',
        files: [{ path: '/project/app.ts', content: '' }],
      },
      postMessage,
    )
    posted = [] // clear progress messages
    processWorkerMessage(
      { type: 'finalize', operationId: 'op1', existingNodes: [] },
      postMessage,
    )
    expect(posted.length).toBe(1)
    const result = posted[0] as { type: string; snapshot: { nodes: unknown[] } }
    expect(result.type).toBe('result')
    expect(result.snapshot.nodes.length).toBeGreaterThan(0)
  })

  it('cancel clears state', () => {
    processWorkerMessage(
      { type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } },
      postMessage,
    )
    processWorkerMessage({ type: 'cancel', operationId: 'op1' }, postMessage)
    // After cancel, append-files with same op should be ignored
    processWorkerMessage(
      {
        type: 'append-files',
        operationId: 'op1',
        files: [{ path: '/project/app.ts', content: '' }],
      },
      postMessage,
    )
    expect(posted).toEqual([])
  })

  it('finalize with wrong operationId is ignored', () => {
    processWorkerMessage(
      { type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } },
      postMessage,
    )
    processWorkerMessage(
      { type: 'finalize', operationId: 'wrong', existingNodes: [] },
      postMessage,
    )
    expect(posted).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/project-map-worker.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the worker**

```typescript
// src/renderer/src/workers/project-map-worker.ts

/**
 * Project-map Web Worker: receives file chunks, analyzes them,
 * computes tree layout, returns positioned canvas nodes + edges.
 *
 * Follows the vault-worker pattern of union-typed messages.
 * Exports processWorkerMessage + resetWorkerState for testability.
 */

import type { CanvasNode } from '@shared/canvas-types'
import type { ProjectMapOptions } from '@shared/engine/project-map-types'
import type { FileInput } from '@shared/engine/project-map-analyzers'
import { buildProjectMapSnapshot } from '@shared/engine/project-map-analyzers'
import { computeFolderMapLayout } from '../panels/canvas/folder-map-layout'

// ─── Message types ──────────────────────────────────────────────────

export type ProjectMapWorkerIn =
  | { type: 'start'; operationId: string; rootPath: string; options: ProjectMapOptions }
  | { type: 'append-files'; operationId: string; files: Array<{ path: string; content: string | null; error?: string }> }
  | { type: 'finalize'; operationId: string; existingNodes: readonly CanvasNode[] }
  | { type: 'cancel'; operationId: string }

export type ProjectMapWorkerOut =
  | { type: 'progress'; operationId: string; phase: 'analyzing' | 'laying-out'; filesProcessed: number; totalFiles: number }
  | { type: 'result'; operationId: string; snapshot: ReturnType<typeof buildProjectMapSnapshot>; nodes: CanvasNode[]; edges: CanvasNode[] }
  | { type: 'error'; operationId: string; message: string }

// ─── Worker state ──────────────────────────────────────────────────

let currentOperationId: string | null = null
let currentRootPath = ''
let currentOptions: ProjectMapOptions = { expandDepth: 2, maxNodes: 200 }
let accumulatedFiles: FileInput[] = []

export function resetWorkerState(): void {
  currentOperationId = null
  currentRootPath = ''
  currentOptions = { expandDepth: 2, maxNodes: 200 }
  accumulatedFiles = []
}

// ─── Message handler ────────────────────────────────────────────────

export function processWorkerMessage(
  msg: ProjectMapWorkerIn,
  post: (msg: unknown) => void,
): void {
  switch (msg.type) {
    case 'start': {
      currentOperationId = msg.operationId
      currentRootPath = msg.rootPath
      currentOptions = msg.options
      accumulatedFiles = []
      break
    }

    case 'append-files': {
      if (msg.operationId !== currentOperationId) return // stale, ignore
      for (const file of msg.files) {
        accumulatedFiles.push(file)
      }
      post({
        type: 'progress',
        operationId: msg.operationId,
        phase: 'analyzing',
        filesProcessed: accumulatedFiles.length,
        totalFiles: accumulatedFiles.length, // total unknown until finalize
      })
      break
    }

    case 'finalize': {
      if (msg.operationId !== currentOperationId) return // stale, ignore
      try {
        const snapshot = buildProjectMapSnapshot(currentRootPath, accumulatedFiles, currentOptions)
        const layout = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [...msg.existingNodes])
        post({
          type: 'result',
          operationId: msg.operationId,
          snapshot,
          nodes: layout.nodes,
          edges: layout.edges,
        })
      } catch (err) {
        post({
          type: 'error',
          operationId: msg.operationId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }

    case 'cancel': {
      if (msg.operationId === currentOperationId) {
        resetWorkerState()
      }
      break
    }
  }
}

// ─── Wire up as Web Worker (only runs in worker context) ─────────────

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
  self.onmessage = (e: MessageEvent<ProjectMapWorkerIn>) => {
    processWorkerMessage(e.data, (msg) => self.postMessage(msg))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/project-map-worker.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/workers/project-map-worker.ts tests/canvas/project-map-worker.test.ts
git commit -m "feat: add project-map worker with append/finalize/cancel protocol"
```

---

## Phase 1D: Canvas Model Extensions + UI Wiring

### Task 9: Add project-folder Node Type

**Files:**

- Modify: `src/shared/canvas-types.ts`

- [ ] **Step 1: Add project-folder to CanvasNodeType union**

In `src/shared/canvas-types.ts`, update the `CanvasNodeType` union (around line 3):

Change:

```typescript
export type CanvasNodeType =
  | 'text' | 'note' | 'terminal' | 'code' | 'markdown'
  | 'image' | 'pdf' | 'project-file' | 'system-artifact'
  | 'file-view' | 'agent-session'
```

To:

```typescript
export type CanvasNodeType =
  | 'text' | 'note' | 'terminal' | 'code' | 'markdown'
  | 'image' | 'pdf' | 'project-file' | 'system-artifact'
  | 'file-view' | 'agent-session'
  | 'project-folder'
```

- [ ] **Step 2: Add size entries**

Add to `MIN_SIZES` (around line 100):

```typescript
'project-folder': { width: 200, height: 60 },
```

Add to `DEFAULT_SIZES` (around line 114):

```typescript
'project-folder': { width: 260, height: 80 },
```

- [ ] **Step 3: Add CARD_TYPE_INFO entry**

Add to `CARD_TYPE_INFO` (around line 144):

```typescript
'project-folder': { label: 'Folder', icon: '\u{1F4C1}', category: 'tools' },
```

- [ ] **Step 4: Add getDefaultMetadata case**

Add to the switch in `getDefaultMetadata` (around line 160):

```typescript
case 'project-folder':
  return { relativePath: '', rootPath: '', childCount: 0, collapsed: false }
```

- [ ] **Step 5: Verify it compiles — TypeScript will flag any missing exhaustiveness**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -20`

If there are exhaustiveness errors in other files (like `card-registry.ts`), note them — they'll be fixed in the next task.

- [ ] **Step 6: Commit**

```bash
git add src/shared/canvas-types.ts
git commit -m "feat: add project-folder canvas node type with sizes and metadata"
```

---

### Task 10: ProjectFolderCard Component + Card Registry

**Files:**

- Create: `src/renderer/src/panels/canvas/ProjectFolderCard.tsx`
- Modify: `src/renderer/src/panels/canvas/card-registry.ts`

- [ ] **Step 1: Create ProjectFolderCard**

```tsx
// src/renderer/src/panels/canvas/ProjectFolderCard.tsx

import type { CanvasNode } from '@shared/canvas-types'
import { colors } from '../../design/tokens'

interface ProjectFolderCardProps {
  readonly node: CanvasNode
}

export default function ProjectFolderCard({ node }: ProjectFolderCardProps) {
  const { relativePath, childCount, collapsed } = node.metadata as {
    relativePath?: string
    childCount?: number
    collapsed?: boolean
  }

  const folderName = node.metadata.relativePath === '.'
    ? (node.metadata.rootPath as string)?.split('/').pop() ?? 'Root'
    : (relativePath ?? '').split('/').pop() ?? 'Folder'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '12px 16px',
        borderRadius: '8px',
        background: `color-mix(in oklch, ${colors.bg.elevated} 80%, transparent)`,
        backdropFilter: 'blur(8px)',
        border: `1px solid ${colors.border.subtle}`,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px', opacity: 0.7 }}>
          {collapsed ? '\u{1F4C1}' : '\u{1F4C2}'}
        </span>
        <span
          style={{
            fontWeight: 600,
            fontSize: '13px',
            color: colors.text.primary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {folderName}
        </span>
        {typeof childCount === 'number' && childCount > 0 && (
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '10px',
              background: colors.bg.muted,
              color: colors.text.secondary,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {childCount}
          </span>
        )}
      </div>
      {relativePath && relativePath !== '.' && (
        <div
          style={{
            fontSize: '11px',
            color: colors.text.tertiary,
            marginTop: '4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {relativePath}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add to card registry**

In `src/renderer/src/panels/canvas/card-registry.ts`, add the lazy import for `project-folder`:

```typescript
'project-folder': lazy(() => import('./ProjectFolderCard')),
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/ProjectFolderCard.tsx src/renderer/src/panels/canvas/card-registry.ts
git commit -m "feat: add ProjectFolderCard component and register in card registry"
```

---

### Task 11: Edge Styling for New Edge Kinds

**Files:**

- Modify: `src/renderer/src/design/tokens.ts`
- Modify: `src/renderer/src/panels/canvas/EdgeLayer.tsx`

- [ ] **Step 1: Add edge kind colors to design tokens**

In `src/renderer/src/design/tokens.ts`, add to `EDGE_KIND_COLORS` (after line 149):

```typescript
contains: '#4e5661',    // oklch(0.45 0.02 255) subtle structural gray
imports: '#5b8dd9',     // oklch(0.65 0.12 260) muted blue
references: '#9887e8',  // oklch(0.68 0.14 290) muted purple (reuses existing 'related')
```

Note: `contains` reuses the existing `co-occurrence` color value. `references` reuses the existing `related` value.

- [ ] **Step 2: Add edge styling and viewport filtering to EdgeLayer**

In `src/renderer/src/panels/canvas/EdgeLayer.tsx`, update the `EdgePath` component to add per-kind styling and zoom-threshold visibility.

Add a `zoom` selector and viewport bounds to `EdgeLayer`:

After line 92 (start of `EdgeLayer` component), add viewport filtering and zoom:

```typescript
const zoom = useCanvasStore((s) => s.viewport.zoom)
const viewport = useCanvasStore((s) => s.viewport)
```

Add a helper above `EdgeLayer` for viewport bounds check:

```typescript
function isEdgeInViewport(
  edge: CanvasEdge,
  nodes: readonly CanvasNode[],
  viewport: { x: number; y: number; zoom: number },
  containerWidth: number,
  containerHeight: number,
): boolean {
  const from = nodes.find((n) => n.id === edge.fromNode)
  const to = nodes.find((n) => n.id === edge.toNode)
  if (!from || !to) return false

  const vLeft = -viewport.x / viewport.zoom
  const vTop = -viewport.y / viewport.zoom
  const vRight = vLeft + containerWidth / viewport.zoom
  const vBottom = vTop + containerHeight / viewport.zoom

  const fromInView = from.position.x + from.size.width > vLeft && from.position.x < vRight
    && from.position.y + from.size.height > vTop && from.position.y < vBottom
  const toInView = to.position.x + to.size.width > vLeft && to.position.x < vRight
    && to.position.y + to.size.height > vTop && to.position.y < vBottom

  return fromInView || toInView
}
```

Update `EdgePath` to add zoom-based reveal for `imports`/`references`:

In the hidden-edge logic (line 44-48), add zoom threshold check:

```typescript
if (edge.hidden) {
  const endpointHovered = hoveredNodeId === edge.fromNode || hoveredNodeId === edge.toNode
  const endpointSelected = selectedNodeIds.has(edge.fromNode) || selectedNodeIds.has(edge.toNode)
  const zoomRevealed = zoom > 0.8 && (edge.kind === 'imports' || edge.kind === 'references')
  if (!endpointHovered && !endpointSelected && !zoomRevealed) return null
}
```

Add per-kind stroke styling after line 50 (`kindColor`):

```typescript
const strokeDasharray = edge.kind === 'imports' ? '6 4' : edge.kind === 'references' ? '2 4' : undefined
const strokeWidthBase = edge.kind === 'contains' ? 1 : 1.5
```

Apply `strokeDasharray` and `strokeWidthBase` to the visible `<path>` element, replacing the hardcoded `1.5` strokeWidth.

- [ ] **Step 3: Pass zoom to EdgePath**

`EdgePath` needs to receive `zoom` as a prop. Add `zoom: number` to its props and pass it from the `EdgeLayer` map call.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 5: Run existing edge tests to ensure no regressions**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/ 2>&1 | tail -10`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/design/tokens.ts src/renderer/src/panels/canvas/EdgeLayer.tsx
git commit -m "feat: add edge styling for contains/imports/references kinds with zoom threshold"
```

---

### Task 12: Folder-Map Orchestrator

**Files:**

- Create: `src/renderer/src/panels/canvas/folder-map-orchestrator.ts`

- [ ] **Step 1: Implement the orchestrator**

```typescript
// src/renderer/src/panels/canvas/folder-map-orchestrator.ts

/**
 * Orchestrates folder-to-canvas mapping: chunked IPC reads, worker coordination,
 * progress tracking, and cancellation. In Phase 1D, applies directly to canvas.
 * Preview/apply flow added in Slice 2.
 */

import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import type { ProjectMapOptions, ProjectMapSnapshot } from '@shared/engine/project-map-types'
import { DEFAULT_PROJECT_MAP_OPTIONS, isBinaryPath } from '@shared/engine/project-map-types'
import type { ProjectMapWorkerIn, ProjectMapWorkerOut } from '../workers/project-map-worker'

const CHUNK_SIZE = 50

// ─── Progress state ──────────────────────────────────────────────────

export interface FolderMapProgress {
  readonly phase: 'idle' | 'listing' | 'reading' | 'analyzing' | 'laying-out' | 'done' | 'error' | 'cancelled'
  readonly filesProcessed: number
  readonly totalFiles: number
  readonly errorMessage?: string
}

export type ProgressCallback = (progress: FolderMapProgress) => void

// ─── Orchestrator result ─────────────────────────────────────────────

export interface FolderMapResult {
  readonly snapshot: ProjectMapSnapshot
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

// ─── Main orchestration function ─────────────────────────────────────

let currentOperationId: string | null = null

function generateOperationId(): string {
  return `fmo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Cancel any in-flight folder map operation.
 */
export function cancelFolderMap(): void {
  currentOperationId = null
}

/**
 * Map a folder to canvas nodes + edges.
 * Returns the result or null if cancelled.
 */
export async function mapFolderToCanvas(
  rootPath: string,
  existingNodes: readonly CanvasNode[],
  onProgress: ProgressCallback,
  options: Partial<ProjectMapOptions> = {},
): Promise<FolderMapResult | null> {
  const opts = { ...DEFAULT_PROJECT_MAP_OPTIONS, ...options }
  const operationId = generateOperationId()
  currentOperationId = operationId

  const isCancelled = () => currentOperationId !== operationId

  try {
    // 1. List files
    onProgress({ phase: 'listing', filesProcessed: 0, totalFiles: 0 })
    const allFiles = await window.api.fs.listAllFiles(rootPath)
    if (isCancelled()) return null

    const textFiles = allFiles.filter((f) => !f.isDirectory && !isBinaryPath(f.path))
    const totalFiles = textFiles.length

    if (totalFiles === 0) {
      onProgress({ phase: 'done', filesProcessed: 0, totalFiles: 0 })
      return null
    }

    // 2. Create worker
    const worker = new Worker(
      new URL('../workers/project-map-worker.ts', import.meta.url),
      { type: 'module' },
    )

    return await new Promise<FolderMapResult | null>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ProjectMapWorkerOut>) => {
        if (isCancelled()) {
          worker.terminate()
          resolve(null)
          return
        }

        const msg = e.data
        switch (msg.type) {
          case 'progress':
            onProgress({
              phase: msg.phase,
              filesProcessed: msg.filesProcessed,
              totalFiles,
            })
            break
          case 'result':
            onProgress({ phase: 'done', filesProcessed: totalFiles, totalFiles })
            worker.terminate()
            resolve({
              snapshot: msg.snapshot,
              nodes: msg.nodes as readonly CanvasNode[],
              edges: msg.edges as readonly CanvasEdge[],
            })
            break
          case 'error':
            onProgress({ phase: 'error', filesProcessed: 0, totalFiles, errorMessage: msg.message })
            worker.terminate()
            reject(new Error(msg.message))
            break
        }
      }

      worker.onerror = (err) => {
        onProgress({ phase: 'error', filesProcessed: 0, totalFiles, errorMessage: err.message })
        worker.terminate()
        reject(new Error(err.message))
      }

      // Start the worker
      const startMsg: ProjectMapWorkerIn = { type: 'start', operationId, rootPath, options: opts }
      worker.postMessage(startMsg)

      // Read files in chunks
      void (async () => {
        try {
          for (let i = 0; i < textFiles.length; i += CHUNK_SIZE) {
            if (isCancelled()) {
              worker.postMessage({ type: 'cancel', operationId })
              worker.terminate()
              resolve(null)
              return
            }

            const chunk = textFiles.slice(i, i + CHUNK_SIZE)
            onProgress({ phase: 'reading', filesProcessed: i, totalFiles })

            const results = await window.api.fs.readFilesBatch(chunk.map((f) => f.path))
            if (isCancelled()) {
              worker.terminate()
              resolve(null)
              return
            }

            worker.postMessage({
              type: 'append-files',
              operationId,
              files: results,
            } satisfies ProjectMapWorkerIn)
          }

          // Finalize
          onProgress({ phase: 'laying-out', filesProcessed: totalFiles, totalFiles })
          worker.postMessage({
            type: 'finalize',
            operationId,
            existingNodes: [...existingNodes],
          } satisfies ProjectMapWorkerIn)
        } catch (err) {
          worker.terminate()
          reject(err)
        }
      })()
    })
  } catch (err) {
    if (!isCancelled()) {
      onProgress({
        phase: 'error',
        filesProcessed: 0,
        totalFiles: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/folder-map-orchestrator.ts
git commit -m "feat: add folder-map orchestrator with chunked reads and worker coordination"
```

---

### Task 13: Entry Points (Sidebar + Command Palette + App.tsx)

**Files:**

- Modify: `src/renderer/src/panels/sidebar/FileContextMenu.tsx`
- Modify: `src/renderer/src/design/components/CommandPalette.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add 'map-to-canvas' to FOLDER_ACTIONS**

In `src/renderer/src/panels/sidebar/FileContextMenu.tsx`, update `FOLDER_ACTIONS` (line 24-30):

```typescript
const FOLDER_ACTIONS: readonly ContextMenuAction[] = [
  { id: 'new-file',       label: 'New note in folder' },
  { id: 'map-to-canvas',  label: 'Map to Canvas',       separator: true },
  { id: 'copy-path',      label: 'Copy path',           separator: true },
  { id: 'reveal-finder',  label: 'Reveal in Finder',    separator: true },
  { id: 'rename',         label: 'Rename...' },
  { id: 'delete',         label: 'Delete',              danger: true },
]
```

- [ ] **Step 2: Add 'map-to-canvas' handler in App.tsx**

In `src/renderer/src/App.tsx`, add a case to the `handleFileAction` switch (around line 488, after the `delete` case):

```typescript
case 'map-to-canvas': {
  // Switch to canvas tab and trigger folder mapping
  const { setActiveTabId } = useEditorStore.getState()
  setActiveTabId('canvas')
  // Store the path to map — CanvasView will pick it up
  setPendingFolderMap(action.path)
  break
}
```

Add state for the pending folder map near the top of the App component (around where other useState calls are):

```typescript
const [pendingFolderMap, setPendingFolderMap] = useState<string | null>(null)
```

Pass `pendingFolderMap` and `setPendingFolderMap` to `CanvasView` (this will be wired in Task 14).

- [ ] **Step 3: Add "Map Vault Root" command to CommandPalette**

In `src/renderer/src/design/components/CommandPalette.tsx`, this command will be passed in via the `items` prop from `App.tsx`. In `App.tsx`, where CommandPalette items are built, add a command item:

```typescript
{
  id: 'map-vault-root',
  title: 'Map Vault Root',
  category: 'command' as const,
}
```

And handle its selection in the `onSelect` handler:

```typescript
if (item.id === 'map-vault-root') {
  const vaultPath = useVaultStore.getState().vaultPath
  if (vaultPath) {
    const { setActiveTabId } = useEditorStore.getState()
    setActiveTabId('canvas')
    setPendingFolderMap(vaultPath)
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`
Expected: No errors (may have temporary errors if CanvasView doesn't accept the props yet — acceptable, fixed in Task 14)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/sidebar/FileContextMenu.tsx src/renderer/src/App.tsx
git commit -m "feat: add Map to Canvas entry points in sidebar and command palette"
```

---

### Task 14: Wire Orchestrator into CanvasView

**Files:**

- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx`

- [ ] **Step 1: Add folder map orchestration to CanvasView**

In `src/renderer/src/panels/canvas/CanvasView.tsx`, add the following:

1. Import the orchestrator:

```typescript
import { mapFolderToCanvas, cancelFolderMap } from './folder-map-orchestrator'
import type { FolderMapProgress } from './folder-map-orchestrator'
```

2. Add props for the pending folder map:

```typescript
// In the component props (or receive via a store/callback pattern)
pendingFolderMap?: string | null
onFolderMapConsumed?: () => void
```

3. Add state for progress:

```typescript
const [folderMapProgress, setFolderMapProgress] = useState<FolderMapProgress | null>(null)
```

4. Add an effect to trigger mapping when `pendingFolderMap` changes:

```typescript
useEffect(() => {
  if (!pendingFolderMap) return
  onFolderMapConsumed?.()

  const existingNodes = useCanvasStore.getState().nodes
  const addNodesAndEdges = useCanvasStore.getState().addNodesAndEdges

  void (async () => {
    try {
      const result = await mapFolderToCanvas(
        pendingFolderMap,
        existingNodes,
        setFolderMapProgress,
      )
      if (!result) return // cancelled or empty

      // Wrap in undo command
      const { nodes: newNodes, edges: newEdges } = result
      commandStack.current.execute({
        execute: () => addNodesAndEdges(newNodes, newEdges),
        undo: () => {
          const store = useCanvasStore.getState()
          for (const node of newNodes) store.removeNode(node.id)
        },
      })

      // Auto-fit viewport for large maps
      if (newNodes.length > 50) {
        const allNodes = useCanvasStore.getState().nodes
        const canvasEl = document.querySelector('[data-canvas-surface]')
        if (canvasEl) {
          const { computeImportViewport } = await import('./import-logic')
          const vp = computeImportViewport(allNodes, canvasEl.clientWidth, canvasEl.clientHeight)
          useCanvasStore.getState().setViewport(vp)
        }
      }
    } catch (err) {
      console.error('Folder map failed:', err)
    } finally {
      setFolderMapProgress(null)
    }
  })()

  return () => cancelFolderMap()
}, [pendingFolderMap])
```

5. Render a progress indicator when mapping is in progress (simple overlay):

```typescript
{folderMapProgress && folderMapProgress.phase !== 'idle' && folderMapProgress.phase !== 'done' && (
  <div style={{
    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
    padding: '8px 16px', borderRadius: '8px',
    background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)',
    fontSize: '13px', color: 'var(--color-text-secondary)', zIndex: 10,
    display: 'flex', alignItems: 'center', gap: '8px',
  }}>
    <span style={{ animation: 'te-fade-in 0.5s ease-in-out infinite alternate' }}>
      {folderMapProgress.phase === 'error' ? '\u26A0' : '\u2026'}
    </span>
    {folderMapProgress.phase === 'error'
      ? folderMapProgress.errorMessage ?? 'Mapping failed'
      : `Mapping folder\u2026 ${folderMapProgress.filesProcessed}/${folderMapProgress.totalFiles} files`
    }
  </div>
)}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasView.tsx
git commit -m "feat: wire folder-map orchestrator into CanvasView with progress and undo"
```

---

### Task 15: Phase 1 Quality Gate

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`
Expected: Clean

- [ ] **Step 2: Run all tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 3: Run lint**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run lint 2>&1 | tail -10`
Expected: Clean

---

## Phase 2: Canvas Preview/Apply

### Task 16: Canvas Mutation Types

**Files:**

- Create: `src/shared/canvas-mutation-types.ts`

- [ ] **Step 1: Create mutation types**

```typescript
// src/shared/canvas-mutation-types.ts

import type { CanvasNode, CanvasEdge } from './canvas-types'

export type CanvasMutationOp =
  | { readonly type: 'add-node'; readonly node: CanvasNode }
  | { readonly type: 'add-edge'; readonly edge: CanvasEdge }
  | { readonly type: 'move-node'; readonly nodeId: string; readonly position: { x: number; y: number } }
  | { readonly type: 'resize-node'; readonly nodeId: string; readonly size: { width: number; height: number } }
  | { readonly type: 'update-metadata'; readonly nodeId: string; readonly metadata: Partial<Record<string, unknown>> }
  | { readonly type: 'remove-node'; readonly nodeId: string }
  | { readonly type: 'remove-edge'; readonly edgeId: string }

export interface CanvasMutationPlan {
  readonly id: string
  readonly operationId: string
  readonly source: 'folder-map' | 'agent' | 'expand-folder'
  readonly ops: readonly CanvasMutationOp[]
  readonly summary: {
    readonly addedNodes: number
    readonly addedEdges: number
    readonly movedNodes: number
    readonly skippedFiles: number
    readonly unresolvedRefs: number
  }
}

/** Build a CanvasMutationPlan from folder-map result nodes and edges. */
export function buildFolderMapPlan(
  operationId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  skippedFiles: number,
  unresolvedRefs: number,
): CanvasMutationPlan {
  const ops: CanvasMutationOp[] = [
    ...nodes.map((node) => ({ type: 'add-node' as const, node })),
    ...edges.map((edge) => ({ type: 'add-edge' as const, edge })),
  ]

  return {
    id: `plan_${Date.now().toString(36)}`,
    operationId,
    source: 'folder-map',
    ops,
    summary: {
      addedNodes: nodes.length,
      addedEdges: edges.length,
      movedNodes: 0,
      skippedFiles,
      unresolvedRefs,
    },
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/canvas-mutation-types.ts
git commit -m "feat: add canvas mutation types and folder-map plan builder"
```

---

### Task 17: Preview Layer

**Files:**

- Create: `src/renderer/src/panels/canvas/FolderMapPreview.tsx`
- Modify: `src/renderer/src/panels/canvas/CanvasSurface.tsx`

- [ ] **Step 1: Create FolderMapPreview component**

```tsx
// src/renderer/src/panels/canvas/FolderMapPreview.tsx

import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { colors } from '../../design/tokens'

interface FolderMapPreviewProps {
  readonly plan: CanvasMutationPlan
  readonly onApply: () => void
  readonly onCancel: () => void
}

export function FolderMapPreview({ plan, onApply, onCancel }: FolderMapPreviewProps) {
  const addNodeOps = plan.ops.filter((op) => op.type === 'add-node')
  const addEdgeOps = plan.ops.filter((op) => op.type === 'add-edge')

  // Build a map of node IDs to positions for edge drawing
  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const op of addNodeOps) {
    if (op.type === 'add-node') {
      nodePositions.set(op.node.id, {
        x: op.node.position.x,
        y: op.node.position.y,
        width: op.node.size.width,
        height: op.node.size.height,
      })
    }
  }

  // Compute bounding box for SVG viewBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pos of nodePositions.values()) {
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + pos.width)
    maxY = Math.max(maxY, pos.y + pos.height)
  }

  const folderCount = addNodeOps.filter(
    (op) => op.type === 'add-node' && op.node.type === 'project-folder',
  ).length
  const fileCount = addNodeOps.length - folderCount
  const edgeCount = addEdgeOps.length

  return (
    <>
      {/* Ghost rects rendered in canvas transform space */}
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {/* Preview edges */}
        {addEdgeOps.map((op) => {
          if (op.type !== 'add-edge') return null
          const from = nodePositions.get(op.edge.fromNode)
          const to = nodePositions.get(op.edge.toNode)
          if (!from || !to) return null
          const x1 = from.x + from.width / 2
          const y1 = from.y + from.height / 2
          const x2 = to.x + to.width / 2
          const y2 = to.y + to.height / 2
          return (
            <line
              key={op.edge.id}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={colors.text.tertiary}
              strokeWidth={1}
              strokeOpacity={0.3}
            />
          )
        })}

        {/* Preview rects */}
        {addNodeOps.map((op) => {
          if (op.type !== 'add-node') return null
          const { x, y } = op.node.position
          const { width, height } = op.node.size
          const name = op.node.metadata.relativePath as string
            ?? op.node.content?.split('/').pop()
            ?? ''
          return (
            <g key={op.node.id}>
              <rect
                x={x} y={y} width={width} height={height}
                rx={6}
                fill={colors.bg.elevated}
                fillOpacity={0.15}
                stroke={colors.accent.default}
                strokeWidth={1}
                strokeDasharray="4 3"
                strokeOpacity={0.5}
              />
              <text
                x={x + width / 2}
                y={y + height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={colors.text.secondary}
                fontSize={11}
                opacity={0.7}
              >
                {name.length > 30 ? `\u2026${name.slice(-28)}` : name}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Confirmation bar — rendered in fixed screen space, not canvas transform */}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 20px',
          borderRadius: '10px',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
          backdropFilter: 'blur(12px)',
          fontSize: '13px',
          color: 'var(--color-text-secondary)',
          zIndex: 100,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <span>
          Map {addNodeOps.length} items — {folderCount} folders, {fileCount} files, {edgeCount} links
          {plan.summary.skippedFiles > 0 && `. ${plan.summary.skippedFiles} skipped`}
        </span>
        <button
          onClick={onApply}
          style={{
            padding: '4px 14px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--color-accent-default)',
            color: 'var(--color-text-on-accent)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 14px',
            borderRadius: '6px',
            border: '1px solid var(--color-border-subtle)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Mount in CanvasSurface**

In `src/renderer/src/panels/canvas/CanvasSurface.tsx`, the `FolderMapPreview` SVG portion should be rendered as a child inside the viewport transform div (alongside `EdgeLayer` and cards). The confirmation bar renders in fixed screen space so it stays put regardless of pan/zoom.

The preview component will be conditionally rendered by `CanvasView` and passed as a child to `CanvasSurface` (since `CanvasSurface` renders `{children}` inside the viewport transform div).

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/FolderMapPreview.tsx
git commit -m "feat: add lightweight SVG preview layer with confirmation bar"
```

---

### Task 18: Pending-Apply Safety + Undo

**Files:**

- Create: `src/renderer/src/panels/canvas/folder-map-apply.ts`
- Create: `tests/canvas/folder-map-apply.test.ts`

- [ ] **Step 1: Write failing tests for applyFolderMap**

```typescript
// tests/canvas/folder-map-apply.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'
import { CommandStack } from '../../src/renderer/src/panels/canvas/canvas-commands'

// We test the apply logic directly
import { applyFolderMapPlan, getPendingApply } from '../../src/renderer/src/panels/canvas/folder-map-apply'
import type { CanvasMutationPlan } from '../../src/shared/canvas-mutation-types'

describe('folder-map-apply', () => {
  let commandStack: CommandStack

  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
    // Set a filePath so save logic can work
    useCanvasStore.getState().loadCanvas('/test/canvas.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    commandStack = new CommandStack()
  })

  function makePlan(nodeCount: number): {
    plan: CanvasMutationPlan
    nodes: ReturnType<typeof createCanvasNode>[]
    edges: ReturnType<typeof createCanvasEdge>[]
  } {
    const nodes = Array.from({ length: nodeCount }, (_, i) =>
      createCanvasNode('project-file', { x: i * 100, y: 0 }),
    )
    const edges = nodeCount > 1
      ? [createCanvasEdge(nodes[0].id, nodes[1].id, 'right', 'left', 'contains')]
      : []
    const plan: CanvasMutationPlan = {
      id: 'plan_test',
      operationId: 'op_test',
      source: 'folder-map',
      ops: [
        ...nodes.map((n) => ({ type: 'add-node' as const, node: n })),
        ...edges.map((e) => ({ type: 'add-edge' as const, edge: e })),
      ],
      summary: { addedNodes: nodeCount, addedEdges: edges.length, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 },
    }
    return { plan, nodes, edges }
  }

  it('apply adds nodes and edges to store', () => {
    const { plan, nodes } = makePlan(3)
    applyFolderMapPlan(plan, commandStack)
    expect(useCanvasStore.getState().nodes.length).toBe(3)
  })

  it('undo removes all added nodes', () => {
    const { plan } = makePlan(3)
    applyFolderMapPlan(plan, commandStack)
    expect(useCanvasStore.getState().nodes.length).toBe(3)
    commandStack.undo()
    expect(useCanvasStore.getState().nodes.length).toBe(0)
  })

  it('redo restores nodes', () => {
    const { plan } = makePlan(2)
    applyFolderMapPlan(plan, commandStack)
    commandStack.undo()
    commandStack.redo()
    expect(useCanvasStore.getState().nodes.length).toBe(2)
  })

  it('pendingApply is null after successful apply', () => {
    const { plan } = makePlan(1)
    applyFolderMapPlan(plan, commandStack)
    // After synchronous apply, pending should be cleared
    // (In real usage, flush is async — this tests the sync path)
    expect(getPendingApply()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/folder-map-apply.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement folder-map-apply**

```typescript
// src/renderer/src/panels/canvas/folder-map-apply.ts

/**
 * Pending-apply safety and undo wrapping for folder map commits.
 * Separated from orchestrator for single-responsibility.
 */

import type { CanvasFile, CanvasNode, CanvasEdge } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { useCanvasStore } from '../../store/canvas-store'
import type { CommandStack } from './canvas-commands'

interface PendingApply {
  readonly operationId: string
  readonly canvasPath: string
  readonly preApplySnapshot: CanvasFile
}

let pendingApply: PendingApply | null = null

export function getPendingApply(): PendingApply | null {
  return pendingApply
}

/**
 * Apply a folder map plan to the canvas store, wrapped in a CommandStack
 * command for single Cmd+Z undo.
 */
export function applyFolderMapPlan(
  plan: CanvasMutationPlan,
  commandStack: CommandStack,
): void {
  const store = useCanvasStore.getState()
  const canvasPath = store.filePath

  // Extract nodes and edges from plan ops
  const newNodes: CanvasNode[] = []
  const newEdges: CanvasEdge[] = []
  for (const op of plan.ops) {
    if (op.type === 'add-node') newNodes.push(op.node)
    if (op.type === 'add-edge') newEdges.push(op.edge)
  }

  // Capture pre-apply snapshot for rollback
  if (canvasPath) {
    pendingApply = {
      operationId: plan.operationId,
      canvasPath,
      preApplySnapshot: store.toCanvasFile(),
    }
  }

  // Wrap in undo command
  commandStack.execute({
    execute: () => {
      useCanvasStore.getState().addNodesAndEdges(newNodes, newEdges)
    },
    undo: () => {
      const s = useCanvasStore.getState()
      for (const node of newNodes) s.removeNode(node.id)
    },
  })

  // Clear pending marker (async flush would happen via autosave)
  pendingApply = null
}

/**
 * If a pending apply exists during quit, rollback to pre-apply snapshot.
 * Called from the coordinated quit flow.
 */
export function rollbackPendingApplyIfNeeded(): void {
  if (!pendingApply) return
  const snapshot = pendingApply.preApplySnapshot
  useCanvasStore.getState().loadCanvas(pendingApply.canvasPath, snapshot)
  pendingApply = null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/folder-map-apply.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/folder-map-apply.ts tests/canvas/folder-map-apply.test.ts
git commit -m "feat: add folder-map apply with pending-apply safety and undo integration"
```

---

### Task 19: Wire Preview/Apply Flow into CanvasView

**Files:**

- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx`
- Modify: `src/renderer/src/panels/canvas/folder-map-orchestrator.ts`

- [ ] **Step 1: Update orchestrator to return plan instead of applying directly**

Modify `mapFolderToCanvas` in `folder-map-orchestrator.ts` to return a `CanvasMutationPlan` (from `buildFolderMapPlan`) instead of raw nodes/edges, so CanvasView can show the preview first.

Update the return type and add the plan builder import:

```typescript
import { buildFolderMapPlan } from '@shared/canvas-mutation-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'

export interface FolderMapResult {
  readonly plan: CanvasMutationPlan
  readonly snapshot: ProjectMapSnapshot
}
```

In the worker `result` handler, build the plan:

```typescript
case 'result':
  onProgress({ phase: 'done', filesProcessed: totalFiles, totalFiles })
  worker.terminate()
  resolve({
    plan: buildFolderMapPlan(
      operationId,
      msg.nodes as CanvasNode[],
      msg.edges as CanvasEdge[],
      msg.snapshot.skippedCount,
      msg.snapshot.unresolvedRefs.length,
    ),
    snapshot: msg.snapshot,
  })
  break
```

- [ ] **Step 2: Update CanvasView to show preview before applying**

In `CanvasView.tsx`, update the folder map effect to:

1. Store the plan in state: `const [previewPlan, setPreviewPlan] = useState<CanvasMutationPlan | null>(null)`
2. When `mapFolderToCanvas` completes, set the preview plan instead of applying immediately
3. Render `<FolderMapPreview>` when `previewPlan` is set
4. On Apply: call `applyFolderMapPlan(previewPlan, commandStack.current)` and clear preview
5. On Cancel: clear preview plan

```typescript
import { FolderMapPreview } from './FolderMapPreview'
import { applyFolderMapPlan } from './folder-map-apply'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'

// In component:
const [previewPlan, setPreviewPlan] = useState<CanvasMutationPlan | null>(null)

// In the folder map effect, change the result handling:
const result = await mapFolderToCanvas(pendingFolderMap, existingNodes, setFolderMapProgress)
if (result) {
  setPreviewPlan(result.plan)
}

// Add handlers:
const handleApplyPlan = useCallback(() => {
  if (!previewPlan) return
  applyFolderMapPlan(previewPlan, commandStack.current)

  // Auto-fit for large maps
  const addNodeOps = previewPlan.ops.filter((op) => op.type === 'add-node')
  if (addNodeOps.length > 50) {
    const allNodes = useCanvasStore.getState().nodes
    const canvasEl = document.querySelector('[data-canvas-surface]')
    if (canvasEl) {
      const vp = computeImportViewport(allNodes, canvasEl.clientWidth, canvasEl.clientHeight)
      useCanvasStore.getState().setViewport(vp)
    }
  }

  setPreviewPlan(null)
}, [previewPlan])

const handleCancelPlan = useCallback(() => {
  setPreviewPlan(null)
}, [])

// In render, inside CanvasSurface children:
{previewPlan && (
  <FolderMapPreview
    plan={previewPlan}
    onApply={handleApplyPlan}
    onCancel={handleCancelPlan}
  />
)}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasView.tsx src/renderer/src/panels/canvas/folder-map-orchestrator.ts
git commit -m "feat: wire preview/apply flow into CanvasView with confirmation bar"
```

---

### Task 20: Phase 2 Quality Gate

- [ ] **Step 1: Run full quality gate**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run check 2>&1 | tail -20`
Expected: lint + typecheck + test all pass clean

---

## Phase 3: Agent Canvas Planning

### Task 21: Canvas Snapshot/Apply IPC

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Create or modify: `src/main/ipc/canvas.ts` (new file for canvas IPC handlers)
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add IPC channel types**

In `src/shared/ipc-channels.ts`, add:

```typescript
'canvas:get-snapshot': {
  request: { canvasPath: string }
  response: { file: import('./canvas-types').CanvasFile; mtime: string }
}
'canvas:apply-plan': {
  request: {
    canvasPath: string
    expectedMtime: string
    plan: import('./canvas-mutation-types').CanvasMutationPlan
  }
  response: { applied: boolean; mtime: string } | { error: 'stale' | 'validation-failed'; message: string }
}
```

- [ ] **Step 2: Create canvas IPC handler**

```typescript
// src/main/ipc/canvas.ts

import { typedHandle } from './typed-ipc'
import { readFile, stat } from 'fs/promises'
import type { CanvasFile } from '@shared/canvas-types'
import type { CanvasMutationPlan, CanvasMutationOp } from '@shared/canvas-mutation-types'

function validateOp(op: CanvasMutationOp, existingNodeIds: Set<string>, addedNodeIds: Set<string>): string | null {
  switch (op.type) {
    case 'add-node':
      if (!op.node.type || !op.node.position || !op.node.size) return 'add-node: missing required fields'
      addedNodeIds.add(op.node.id)
      return null
    case 'add-edge':
      if (!existingNodeIds.has(op.edge.fromNode) && !addedNodeIds.has(op.edge.fromNode))
        return `add-edge: fromNode ${op.edge.fromNode} not found`
      if (!existingNodeIds.has(op.edge.toNode) && !addedNodeIds.has(op.edge.toNode))
        return `add-edge: toNode ${op.edge.toNode} not found`
      return null
    case 'move-node':
    case 'resize-node':
    case 'update-metadata':
      if (!existingNodeIds.has(op.nodeId)) return `${op.type}: nodeId ${op.nodeId} not found`
      return null
    case 'remove-node':
      if (!existingNodeIds.has(op.nodeId)) return `remove-node: nodeId ${op.nodeId} not found`
      return null
    case 'remove-edge':
      return null // edges validated at apply time
    default:
      return `unknown op type`
  }
}

export function registerCanvasIpc(): void {
  typedHandle('canvas:get-snapshot', async (args) => {
    const content = await readFile(args.canvasPath, 'utf-8')
    const file: CanvasFile = JSON.parse(content)
    const stats = await stat(args.canvasPath)
    return { file, mtime: stats.mtime.toISOString() }
  })

  typedHandle('canvas:apply-plan', async (args) => {
    // Optimistic lock: check mtime
    const stats = await stat(args.canvasPath)
    const currentMtime = stats.mtime.toISOString()
    if (currentMtime !== args.expectedMtime) {
      return { error: 'stale' as const, message: `Canvas modified since snapshot (expected ${args.expectedMtime}, got ${currentMtime})` }
    }

    // Validate all ops
    const content = await readFile(args.canvasPath, 'utf-8')
    const file: CanvasFile = JSON.parse(content)
    const existingNodeIds = new Set(file.nodes.map((n) => n.id))
    const addedNodeIds = new Set<string>()

    for (const op of args.plan.ops) {
      const error = validateOp(op, existingNodeIds, addedNodeIds)
      if (error) {
        return { error: 'validation-failed' as const, message: error }
      }
    }

    // Validation passed — the actual apply happens in the renderer via preview/apply flow
    // This IPC just validates and signals readiness
    return { applied: true, mtime: currentMtime }
  })
}
```

- [ ] **Step 3: Register in main/index.ts**

Add import and call `registerCanvasIpc()` in the registration block.

- [ ] **Step 4: Expose in preload**

In `src/preload/index.ts`, add a `canvas` namespace:

```typescript
canvas: {
  getSnapshot: (canvasPath: string) => typedInvoke('canvas:get-snapshot', { canvasPath }),
  applyPlan: (canvasPath: string, expectedMtime: string, plan: CanvasMutationPlan) =>
    typedInvoke('canvas:apply-plan', { canvasPath, expectedMtime, plan }),
},
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/canvas.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add canvas:get-snapshot and canvas:apply-plan IPC with validation"
```

---

### Task 22: MCP Tools

**Files:**

- Modify: `src/main/services/mcp-server.ts`

- [ ] **Step 1: Add three MCP tools**

In `src/main/services/mcp-server.ts`, add:

1. `project.map_folder` — triggers folder analysis and returns `ProjectMapSnapshot`
2. `canvas.get_snapshot` — reads canvas file and returns `CanvasFile` + mtime
3. `canvas.apply_plan` — validates and applies a `CanvasMutationPlan` via HITL gate

Each tool should follow the existing pattern in the file: Zod schema for input, HITL gate for writes, Spotlighting for read outputs.

The `canvas.apply_plan` tool must go through `ElectronHitlGate` (same as `vault.write_file`).

Implementation details depend heavily on the existing MCP server patterns — the implementing agent should read the full `mcp-server.ts` file and follow the established patterns exactly.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/services/mcp-server.ts
git commit -m "feat: add project.map_folder, canvas.get_snapshot, canvas.apply_plan MCP tools"
```

---

### Task 23: Phase 3 Quality Gate

- [ ] **Step 1: Run full quality gate**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run check 2>&1 | tail -20`
Expected: lint + typecheck + test all pass clean

- [ ] **Step 2: Run targeted vitest for new test files**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts tests/canvas/folder-map-layout.test.ts tests/canvas/project-map-worker.test.ts tests/canvas/folder-map-apply.test.ts 2>&1 | tail -20`
Expected: All pass