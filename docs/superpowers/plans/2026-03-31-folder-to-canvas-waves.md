# Folder-to-Canvas Mapping: Wave Execution Plan

> **For agentic workers:** This plan is organized into 6 sequential waves. Each wave contains parallel tasks that touch **no overlapping files**. Execute all tasks within a wave concurrently, then move to the next wave after the wave gate passes.
>
> **Your assignment:** You will be told which **wave** and **task letter** to execute (e.g., "Wave 2, Task B"). Read the wave header for preconditions, then execute only your assigned task.

**Goal:** Map a selected folder's structure and file relationships onto the canvas as positioned cards with typed edges, with preview/apply UX and agent API surface.

**Architecture:** Worker-backed analysis pipeline separated from VaultIndex/KnowledgeGraph. Main process owns file I/O only; renderer Web Worker owns all analysis and layout. Preview/apply pattern with single-batch undo. Agent surface via IPC then MCP.

**Tech Stack:** Electron, TypeScript strict, React, Zustand, Vitest, Web Workers, p-limit

**Spec:** `docs/superpowers/specs/2026-03-31-folder-to-canvas-design.md`

---

## Codebase Orientation

Before starting any task, understand these patterns:

| Pattern | File | What It Does |
|---|---|---|
| IPC channels | `src/shared/ipc-channels.ts` | Typed request/response contracts. Add one line per channel. |
| IPC handlers | `src/main/ipc/filesystem.ts` | `typedHandle('channel', async (args) => { ... })` |
| Preload bridge | `src/preload/index.ts` | `namespace: { method: (arg) => typedInvoke('channel', { arg }) }` |
| Canvas node factory | `src/shared/canvas-types.ts` | `createCanvasNode(type, position, overrides?)` |
| Canvas edge factory | `src/shared/canvas-types.ts` | `createCanvasEdge(fromId, toId, fromSide, toSide, kind?)` |
| Edge kind escape hatch | `src/shared/canvas-types.ts:80` | `kind?: CanvasEdgeKind \| (string & {})` allows arbitrary string kinds |
| Canvas store batch add | `src/renderer/src/store/canvas-store.ts:234` | `addNodesAndEdges(nodes, edges)` atomic mutation |
| Undo/redo | `src/renderer/src/panels/canvas/canvas-commands.ts` | `CommandStack` with `{ execute, undo }` closures |
| Worker message pattern | `src/renderer/src/engine/vault-worker.ts` | Union-typed `onmessage` switch, `postMessage` responses |
| Card registration | `src/renderer/src/panels/canvas/card-registry.ts` | `LazyCards` record, one `lazy(() => import(...))` per type |
| Canvas autosave | `src/renderer/src/store/canvas-autosave.ts` | 2s debounce, `flushCanvasSave()` for immediate persist |
| Edge rendering | `src/renderer/src/panels/canvas/EdgeLayer.tsx` | `edge.hidden` + hover/select reveal logic at lines 44-48 |
| Collision avoidance | `src/renderer/src/panels/canvas/import-logic.ts` | `computeOriginOffset(existingNodes)` returns x-offset |
| Viewport fitting | `src/renderer/src/panels/canvas/import-logic.ts` | `computeImportViewport(nodes, w, h)` returns `CanvasViewport` |
| Edge side computation | `src/renderer/src/panels/canvas/canvas-layout.ts` | `computeOptimalEdgeSides(fromNode, toNode)` |
| File action dispatch | `src/renderer/src/App.tsx:439` | `handleFileAction` switch on `action.actionId` |
| Folder context menu | `src/renderer/src/panels/sidebar/FileContextMenu.tsx:24` | `FOLDER_ACTIONS` array |
| Edge kind colors | `src/renderer/src/design/tokens.ts:142` | `EDGE_KIND_COLORS: Record<string, string>` |

**Test conventions:** Vitest with happy-dom. Test files in `tests/` mirror `src/`. Store tests reset via `store.setState(store.getInitialState())` in `beforeEach`. Run single file: `npx vitest run path/to/file.test.ts`.

**Code style:** Single quotes, no semicolons, 100 char width, strict TypeScript. Immutable data (return new copies). Files under 800 lines.

---

## Wave 1: Foundation Types (3 parallel agents)

**Preconditions:** Clean main branch. No prior waves.

**What this wave builds:** Three independent type/infrastructure foundations that all later waves depend on.

> **CRITICAL:** These three tasks touch completely separate files. No coordination needed.

---

### Wave 1, Task A: Project-Map Shared Types

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

### Wave 1, Task B: Batch File Read IPC

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/filesystem.ts`
- Modify: `src/preload/index.ts`

> **CRITICAL:** This task modifies `ipc-channels.ts` and `preload/index.ts`. Wave 3 Task E also modifies these files, but that's a different wave. Within this wave, no other task touches these files.

- [ ] **Step 1: Add channel type to IPC channels**

In `src/shared/ipc-channels.ts`, add after the `'fs:file-mtime'` line (line 26):

```typescript
'fs:read-files-batch': {
  request: { paths: readonly string[] }
  response: Array<{ path: string; content: string | null; error?: string }>
}
```

- [ ] **Step 2: Add handler in filesystem.ts**

In `src/main/ipc/filesystem.ts`, add inside `registerFilesystemIpc()` before the closing brace:

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

Check: `import fs from 'fs/promises'` must exist at the top. If it's `import { readFile } from 'fs/promises'` instead, use that import style. Read the existing imports and match.

- [ ] **Step 3: Expose in preload**

In `src/preload/index.ts`, add to the `fs` namespace object (look for the `fs: {` block):

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

### Wave 1, Task C: Add project-folder Canvas Node Type

**Files:**
- Modify: `src/shared/canvas-types.ts`

> **NOTE:** After this task, TypeScript will report exhaustiveness errors in `card-registry.ts` because the new type has no card component yet. That's expected and fixed in Wave 2 Task C.

- [ ] **Step 1: Add project-folder to CanvasNodeType union**

In `src/shared/canvas-types.ts`, find the `CanvasNodeType` union (around line 3) and add `'project-folder'`:

```typescript
export type CanvasNodeType =
  | 'text' | 'note' | 'terminal' | 'code' | 'markdown'
  | 'image' | 'pdf' | 'project-file' | 'system-artifact'
  | 'file-view' | 'agent-session'
  | 'project-folder'
```

- [ ] **Step 2: Add size entries**

Add to `MIN_SIZES` record (around line 100):
```typescript
'project-folder': { width: 200, height: 60 },
```

Add to `DEFAULT_SIZES` record (around line 114):
```typescript
'project-folder': { width: 260, height: 80 },
```

- [ ] **Step 3: Add CARD_TYPE_INFO entry**

Add to the `CARD_TYPE_INFO` record (around line 144):
```typescript
'project-folder': { label: 'Folder', icon: '\u{1F4C1}', category: 'tools' },
```

- [ ] **Step 4: Add getDefaultMetadata case**

Add to the switch in `getDefaultMetadata` (around line 160):
```typescript
case 'project-folder':
  return { relativePath: '', rootPath: '', childCount: 0, collapsed: false }
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/canvas-types.ts
git commit -m "feat: add project-folder canvas node type with sizes and metadata"
```

---

### Wave 1 Gate

After all three agents complete, run:

```bash
cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10
```

Expected: May show exhaustiveness errors in `card-registry.ts` for `project-folder` (no card registered yet). That's acceptable -- fixed in Wave 2. No other errors.

---

## Wave 2: Pure Logic (5 parallel tracks, one is a 4-step chain)

**Preconditions:** Wave 1 complete. These files now exist:
- `src/shared/engine/project-map-types.ts` -- ProjectMapNode, ProjectMapEdge, ProjectMapSnapshot, ProjectMapOptions, stableNodeId, isBinaryPath, BINARY_EXTENSIONS
- `src/shared/canvas-types.ts` -- now includes `'project-folder'` in CanvasNodeType
- `src/shared/ipc-channels.ts` -- now includes `'fs:read-files-batch'` channel
- `src/preload/index.ts` -- now includes `fs.readFilesBatch` method

**What this wave builds:** All pure logic modules (no IPC, no UI, no workers yet). Everything here is testable in isolation.

> **CRITICAL:** Task A is a 4-step sequential chain (Tasks A1-A4) that builds the analyzers file incrementally. Tasks B, C, D, E are independent and parallel. No file conflicts exist between any of these tracks.

---

### Wave 2, Task A: Analyzers (4 sequential sub-tasks)

**Files:**
- Create: `src/shared/engine/project-map-analyzers.ts`
- Create: `tests/engine/project-map-analyzers.test.ts`

> **SEQUENTIAL CHAIN:** Complete A1, then A2, then A3, then A4. Each sub-task adds to the same two files.

#### A1: Import Extraction

- [ ] **Step 1: Write failing tests**

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
Expected: FAIL -- `extractImportSpecifiers` not found

- [ ] **Step 3: Implement**

```typescript
// src/shared/engine/project-map-analyzers.ts

/**
 * Project-map analyzers: pure functions for extracting file relationships.
 * Zero dependencies beyond project-map-types. Worker-safe.
 */

import type { ProjectMapEdge, ProjectMapNode, ProjectMapOptions } from './project-map-types'
import type { CanvasNodeType } from '../canvas-types'
import { stableNodeId, isBinaryPath } from './project-map-types'
import * as path from 'path'

// ─── Import Extraction ──────────────────────────────────────────────

/**
 * Extract relative import/require specifiers from JS/TS source code.
 * Only returns specifiers starting with './' or '../'.
 */
export function extractImportSpecifiers(code: string): readonly string[] {
  const specifiers: string[] = []

  const esImportRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = esImportRe.exec(code)) !== null) {
    const spec = match[1]
    if (spec.startsWith('./') || spec.startsWith('../')) {
      specifiers.push(spec)
    }
  }

  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicRe.exec(code)) !== null) {
    const spec = match[1]
    if ((spec.startsWith('./') || spec.startsWith('../')) && !specifiers.includes(spec)) {
      specifiers.push(spec)
    }
  }

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

- [ ] **Step 4: Run tests -- all pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add import specifier extraction analyzer"
```

#### A2: Path Resolution

- [ ] **Step 1: Write failing tests**

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
    expect(resolveImportPath('./utils.ts', '/project/src/app.ts', allFiles, ROOT)).toBe('/project/src/utils.ts')
  })

  it('resolves extensionless import trying extensions in order', () => {
    expect(resolveImportPath('./utils', '/project/src/app.ts', allFiles, ROOT)).toBe('/project/src/utils.ts')
  })

  it('resolves directory import to index file', () => {
    const files = new Set(['/project/src/utils/index.ts', '/project/src/utils/helpers.ts'])
    expect(resolveImportPath('./utils', '/project/src/app.ts', files, ROOT)).toBe('/project/src/utils/index.ts')
  })

  it('resolves .tsx extension', () => {
    expect(resolveImportPath('./components/Button', '/project/src/app.ts', allFiles, ROOT)).toBe('/project/src/components/Button.tsx')
  })

  it('resolves ../lib path', () => {
    expect(resolveImportPath('../lib/helper', '/project/src/app.ts', allFiles, ROOT)).toBe('/project/lib/helper.js')
  })

  it('returns null for bare specifier', () => {
    expect(resolveImportPath('react', '/project/src/app.ts', allFiles, ROOT)).toBeNull()
  })

  it('returns null for path outside root', () => {
    expect(resolveImportPath('../../other/file', '/project/src/app.ts', new Set(['/other/file.ts']), ROOT)).toBeNull()
  })

  it('returns null for non-existent file', () => {
    expect(resolveImportPath('./missing', '/project/src/app.ts', allFiles, ROOT)).toBeNull()
  })

  it('resolves .json extension', () => {
    expect(resolveImportPath('./data', '/project/src/app.ts', allFiles, ROOT)).toBe('/project/src/data.json')
  })

  it('resolves .md extension', () => {
    expect(resolveImportPath('./readme', '/project/src/app.ts', new Set(['/project/src/readme.md']), ROOT)).toBe('/project/src/readme.md')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts 2>&1 | tail -10`
Expected: FAIL -- `resolveImportPath` not found

- [ ] **Step 3: Implement**

Add to `src/shared/engine/project-map-analyzers.ts`:

```typescript
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
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null

  const resolved = path.resolve(path.dirname(importingFile), specifier)

  if (!resolved.startsWith(rootPath + '/') && resolved !== rootPath) return null

  const hasExtension = path.extname(specifier) !== ''
  if (hasExtension) {
    return allFilePaths.has(resolved) ? resolved : null
  }

  for (const ext of EXTENSION_PRIORITY) {
    const candidate = resolved + ext
    if (allFilePaths.has(candidate)) return candidate
  }

  for (const indexFile of INDEX_PRIORITY) {
    const candidate = path.join(resolved, indexFile)
    if (allFilePaths.has(candidate)) return candidate
  }

  return null
}
```

- [ ] **Step 4: Run tests -- all pass**
- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add deterministic import path resolution"
```

#### A3: Markdown + Config Ref Analyzers

- [ ] **Step 1: Write failing tests**

Add to `tests/engine/project-map-analyzers.test.ts`:

```typescript
import { extractImportSpecifiers, resolveImportPath, extractMarkdownRefs, extractConfigPathRefs } from '@shared/engine/project-map-analyzers'

describe('extractMarkdownRefs', () => {
  it('extracts wikilinks', () => {
    expect(extractMarkdownRefs(`See [[some-note]] and [[another|display text]].`)).toEqual(['some-note', 'another'])
  })
  it('extracts relative markdown links', () => {
    expect(extractMarkdownRefs(`Check [this](./sibling.md) and [that](../other/file.md).`)).toEqual(['./sibling.md', '../other/file.md'])
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
    expect(extractConfigPathRefs(`{"main": "./src/index.ts", "types": "./dist/index.d.ts"}`)).toEqual(['./src/index.ts', './dist/index.d.ts'])
  })
  it('skips non-relative string values', () => {
    expect(extractConfigPathRefs(`{"name": "my-package", "version": "1.0.0"}`)).toEqual([])
  })
  it('extracts paths from YAML-like content', () => {
    expect(extractConfigPathRefs(`main: ./src/index.ts\noutput: ../dist/bundle.js`)).toEqual(['./src/index.ts', '../dist/bundle.js'])
  })
  it('handles empty content', () => {
    expect(extractConfigPathRefs('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**

Add to `src/shared/engine/project-map-analyzers.ts`:

```typescript
// ─── Markdown Reference Extraction ──────────────────────────────────

export function extractMarkdownRefs(content: string): readonly string[] {
  const refs: string[] = []
  const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = wikilinkRe.exec(content)) !== null) {
    refs.push(match[1])
  }
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

export function extractConfigPathRefs(content: string): readonly string[] {
  const refs: string[] = []
  const quotedPathRe = /["'](\.\.\/.+?|\.\/[^"']+?)["']/g
  let match: RegExpExecArray | null
  while ((match = quotedPathRe.exec(content)) !== null) {
    refs.push(match[1])
  }
  const yamlPathRe = /:\s+(\.\.\/.+|\.\/\S+)/g
  while ((match = yamlPathRe.exec(content)) !== null) {
    const val = match[1]
    if (!refs.includes(val)) refs.push(val)
  }
  return refs
}
```

- [ ] **Step 4: Run tests -- all pass**
- [ ] **Step 5: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add markdown and config path reference analyzers"
```

#### A4: Snapshot Builder

- [ ] **Step 1: Write failing tests**

Add to `tests/engine/project-map-analyzers.test.ts`:

```typescript
import { extractImportSpecifiers, resolveImportPath, extractMarkdownRefs, extractConfigPathRefs, buildProjectMapSnapshot } from '@shared/engine/project-map-analyzers'
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
    expect(snapshot.nodes.length).toBe(4) // root + src + 2 files
    expect(snapshot.nodes.filter((n) => n.isDirectory).length).toBe(2)
  })

  it('builds contains edges for parent-child', () => {
    const snapshot = buildProjectMapSnapshot(ROOT, [{ path: '/project/src/app.ts', content: '' }], defaultOpts)
    expect(snapshot.edges.filter((e) => e.kind === 'contains').length).toBe(2) // root->src, src->app
  })

  it('builds imports edges from import specifiers', () => {
    const files = [
      { path: '/project/src/app.ts', content: `import { foo } from './utils'` },
      { path: '/project/src/utils.ts', content: '' },
    ]
    expect(buildProjectMapSnapshot(ROOT, files, defaultOpts).edges.filter((e) => e.kind === 'imports').length).toBe(1)
  })

  it('builds references edges from markdown wikilinks', () => {
    const files = [
      { path: '/project/docs/index.md', content: `See [[guide]]` },
      { path: '/project/docs/guide.md', content: '' },
    ]
    expect(buildProjectMapSnapshot(ROOT, files, defaultOpts).edges.filter((e) => e.kind === 'references').length).toBe(1)
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
    const files = Array.from({ length: 50 }, (_, i) => ({ path: `/project/file${i}.ts`, content: '' }))
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
    expect(snapshot.nodes.filter((n) => !n.isDirectory).length).toBe(1)
    expect(snapshot.skippedCount).toBe(1)
  })

  it('handles files with read errors', () => {
    const files = [{ path: '/project/app.ts', content: null as unknown as string, error: 'read failed' }]
    expect(buildProjectMapSnapshot(ROOT, files, defaultOpts).skippedCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**

Add to `src/shared/engine/project-map-analyzers.ts`. This is the largest addition. See the spec section "Snapshot Builder" for the full implementation. The key parts:

```typescript
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const MD_EXTENSIONS = new Set(['.md', '.mdx'])
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml'])

function inferNodeType(filePath: string): CanvasNodeType {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  if (MD_EXTENSIONS.has(ext)) return 'note'
  return 'project-file'
}

function resolveWikilink(target: string, allFilePaths: ReadonlySet<string>, rootPath: string): string | null {
  const normalized = target.toLowerCase()
  for (const fp of allFilePaths) {
    if (!fp.startsWith(rootPath)) continue
    const stem = path.basename(fp, path.extname(fp)).toLowerCase()
    if (stem === normalized) return fp
  }
  return null
}

export interface FileInput {
  readonly path: string
  readonly content: string | null
  readonly error?: string
}

export function buildProjectMapSnapshot(
  rootPath: string,
  files: readonly FileInput[],
  options: ProjectMapOptions,
): ProjectMapSnapshot {
  // Full implementation in original plan Task 5 Step 3.
  // Key algorithm:
  // 1. Filter out binary/error files (increment skippedCount)
  // 2. Build directory tree nodes via ensureDirNode()
  // 3. Build file nodes with inferNodeType()
  // 4. Walk parent directories up to rootPath, building containment
  // 5. Collect nodes respecting maxNodes (breadth-first truncation)
  // 6. Build containment edges from dir->child relationships
  // 7. Build imports edges from TS/JS files via extractImportSpecifiers + resolveImportPath
  // 8. Build references edges from MD files via extractMarkdownRefs + resolveWikilink/resolveImportPath
  // 9. Build references edges from config files via extractConfigPathRefs + resolveImportPath
  // 10. Return { rootPath, nodes, edges, truncated, totalFileCount, skippedCount, unresolvedRefs }
}
```

> **IMPORTANT:** The full implementation is ~120 lines. Refer to the original plan file `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 5 Step 3 for the complete code. Copy it exactly.

- [ ] **Step 4: Run tests -- all pass**
- [ ] **Step 5: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`

- [ ] **Step 6: Commit**

```bash
git add src/shared/engine/project-map-analyzers.ts tests/engine/project-map-analyzers.test.ts
git commit -m "feat: add project-map snapshot builder with containment, imports, and references"
```

---

### Wave 2, Task B: Reingold-Tilford Tree Layout

**Files:**
- Create: `src/renderer/src/panels/canvas/folder-map-layout.ts`
- Create: `tests/canvas/folder-map-layout.test.ts`

**Imports from Wave 1:**
- `ProjectMapSnapshot` from `@shared/engine/project-map-types`
- `CanvasNode`, `CanvasEdge`, `createCanvasNode`, `createCanvasEdge`, `getDefaultSize` from `@shared/canvas-types`
- `computeOptimalEdgeSides` from `./canvas-layout` (already exists)
- `computeOriginOffset` from `./import-logic` (already exists)

> **NOTE:** This module is imported by the worker (Wave 3 Task A) and must be pure -- no React, no Zustand, no IPC.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/canvas/folder-map-layout.test.ts

import { describe, it, expect } from 'vitest'
import { computeFolderMapLayout } from '../../src/renderer/src/panels/canvas/folder-map-layout'
import type { ProjectMapSnapshot } from '@shared/engine/project-map-types'
import type { CanvasNode } from '@shared/canvas-types'

function makeSnapshot(overrides: Partial<ProjectMapSnapshot> = {}): ProjectMapSnapshot {
  return {
    rootPath: '/project', nodes: [], edges: [], truncated: false,
    totalFileCount: 0, skippedCount: 0, unresolvedRefs: [], ...overrides,
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
      nodes: [{
        id: 'root', relativePath: '.', name: 'project', isDirectory: true,
        nodeType: 'project-folder', depth: 0, lineCount: 0, children: [], childCount: 0,
      }],
    })
    const result = computeFolderMapLayout(snapshot, { x: 100, y: 200 }, [])
    expect(result.nodes.length).toBe(1)
    expect(result.nodes[0].position.x).toBe(100)
    expect(result.nodes[0].position.y).toBe(200)
  })

  it('places children below parent with levelGap spacing', () => {
    const snapshot = makeSnapshot({
      nodes: [
        { id: 'root', relativePath: '.', name: 'project', isDirectory: true, nodeType: 'project-folder', depth: 0, lineCount: 0, children: ['child1'], childCount: 1 },
        { id: 'child1', relativePath: 'app.ts', name: 'app.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 10, children: [], childCount: 0 },
      ],
      edges: [{ source: 'root', target: 'child1', kind: 'contains' }],
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const root = result.nodes.find((n) => n.metadata.relativePath === '.')!
    const child = result.nodes.find((n) => n.metadata.relativePath === 'app.ts')!
    expect(child.position.y).toBeGreaterThan(root.position.y)
  })

  it('centers parent over multiple children', () => {
    const snapshot = makeSnapshot({
      nodes: [
        { id: 'root', relativePath: '.', name: 'project', isDirectory: true, nodeType: 'project-folder', depth: 0, lineCount: 0, children: ['c1', 'c2', 'c3'], childCount: 3 },
        { id: 'c1', relativePath: 'a.ts', name: 'a.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 5, children: [], childCount: 0 },
        { id: 'c2', relativePath: 'b.ts', name: 'b.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 5, children: [], childCount: 0 },
        { id: 'c3', relativePath: 'c.ts', name: 'c.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 5, children: [], childCount: 0 },
      ],
      edges: [
        { source: 'root', target: 'c1', kind: 'contains' },
        { source: 'root', target: 'c2', kind: 'contains' },
        { source: 'root', target: 'c3', kind: 'contains' },
      ],
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const root = result.nodes.find((n) => n.metadata.relativePath === '.')!
    const childXs = result.nodes.filter((n) => n.metadata.relativePath !== '.').map((n) => n.position.x + n.size.width / 2)
    const childCenter = (Math.min(...childXs) + Math.max(...childXs)) / 2
    const rootCenter = root.position.x + root.size.width / 2
    expect(Math.abs(rootCenter - childCenter)).toBeLessThan(10)
  })

  it('avoids collision with existing canvas nodes', () => {
    const snapshot = makeSnapshot({
      nodes: [{ id: 'root', relativePath: '.', name: 'project', isDirectory: true, nodeType: 'project-folder', depth: 0, lineCount: 0, children: [], childCount: 0 }],
    })
    const existing: CanvasNode[] = [{
      id: 'existing', type: 'text', position: { x: 0, y: 0 },
      size: { width: 300, height: 200 }, content: 'test', metadata: {},
    }]
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, existing)
    expect(result.nodes[0].position.x).toBeGreaterThanOrEqual(500)
  })

  it('creates import edges with hidden flag', () => {
    const snapshot = makeSnapshot({
      nodes: [
        { id: 'root', relativePath: '.', name: 'project', isDirectory: true, nodeType: 'project-folder', depth: 0, lineCount: 0, children: ['f1', 'f2'], childCount: 2 },
        { id: 'f1', relativePath: 'a.ts', name: 'a.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 10, children: [], childCount: 0 },
        { id: 'f2', relativePath: 'b.ts', name: 'b.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 10, children: [], childCount: 0 },
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

  it('produces deterministic output', () => {
    const snapshot = makeSnapshot({
      nodes: [
        { id: 'root', relativePath: '.', name: 'project', isDirectory: true, nodeType: 'project-folder', depth: 0, lineCount: 0, children: ['c1', 'c2'], childCount: 2 },
        { id: 'c1', relativePath: 'a.ts', name: 'a.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 5, children: [], childCount: 0 },
        { id: 'c2', relativePath: 'b.ts', name: 'b.ts', isDirectory: false, nodeType: 'project-file', depth: 1, lineCount: 5, children: [], childCount: 0 },
      ],
      edges: [{ source: 'root', target: 'c1', kind: 'contains' }, { source: 'root', target: 'c2', kind: 'contains' }],
    })
    const r1 = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const r2 = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    expect(r1.nodes.map((n) => n.position)).toEqual(r2.nodes.map((n) => n.position))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**

> The full implementation is ~200 lines. Refer to `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 6 Step 3 for the complete code. Key algorithm: variable-size Reingold-Tilford with bottom-up subtree width computation, top-down position assignment, collision resolution via `computeOriginOffset()`, and cross-link edge creation with `computeOptimalEdgeSides()`. Import/reference edges get `hidden: true`.

- [ ] **Step 4: Run tests -- all pass**
- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/folder-map-layout.ts tests/canvas/folder-map-layout.test.ts
git commit -m "feat: add Reingold-Tilford tree layout for folder maps"
```

---

### Wave 2, Task C: ProjectFolderCard + Card Registry

**Files:**
- Create: `src/renderer/src/panels/canvas/ProjectFolderCard.tsx`
- Modify: `src/renderer/src/panels/canvas/card-registry.ts`

**Imports from Wave 1:** `CanvasNode` from `@shared/canvas-types` (now includes `'project-folder'`)

> **NOTE:** This task fixes the exhaustiveness error in `card-registry.ts` from Wave 1 Task C.

- [ ] **Step 1: Create ProjectFolderCard**

> Full component code in `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 10 Step 1. Key details: folder icon, name, child count badge, relativePath subtitle. Uses `colors` from `design/tokens`.

- [ ] **Step 2: Add to card registry**

In `src/renderer/src/panels/canvas/card-registry.ts`, add:

```typescript
'project-folder': lazy(() => import('./ProjectFolderCard')),
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`
Expected: No errors (exhaustiveness error now resolved)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/panels/canvas/ProjectFolderCard.tsx src/renderer/src/panels/canvas/card-registry.ts
git commit -m "feat: add ProjectFolderCard component and register in card registry"
```

---

### Wave 2, Task D: Edge Styling for New Edge Kinds

**Files:**
- Modify: `src/renderer/src/design/tokens.ts`
- Modify: `src/renderer/src/panels/canvas/EdgeLayer.tsx`

> **NOTE:** No other task in any wave touches these two files.

- [ ] **Step 1: Add edge kind colors**

In `src/renderer/src/design/tokens.ts`, add to `EDGE_KIND_COLORS` (after line 149, before closing `} as const`):

```typescript
contains: '#4e5661',    // oklch(0.45 0.02 255) subtle structural gray
imports: '#5b8dd9',     // oklch(0.65 0.12 260) muted blue
references: '#9887e8',  // oklch(0.68 0.14 290) muted purple
```

- [ ] **Step 2: Add zoom-threshold reveal and per-kind stroke styling to EdgeLayer**

In `src/renderer/src/panels/canvas/EdgeLayer.tsx`:

1. Add `zoom` prop to `EdgePath` and pass from `EdgeLayer`:

```typescript
function EdgePath({ edge, nodes, zoom }: { edge: CanvasEdge; nodes: readonly CanvasNode[]; zoom: number }) {
```

2. Update hidden-edge logic (lines 44-48) to include zoom threshold:

```typescript
if (edge.hidden) {
  const endpointHovered = hoveredNodeId === edge.fromNode || hoveredNodeId === edge.toNode
  const endpointSelected = selectedNodeIds.has(edge.fromNode) || selectedNodeIds.has(edge.toNode)
  const zoomRevealed = zoom > 0.8 && (edge.kind === 'imports' || edge.kind === 'references')
  if (!endpointHovered && !endpointSelected && !zoomRevealed) return null
}
```

3. Add per-kind stroke styling after `kindColor` (line 50):

```typescript
const strokeDasharray = edge.kind === 'imports' ? '6 4' : edge.kind === 'references' ? '2 4' : undefined
const strokeWidthBase = edge.kind === 'contains' ? 1 : 1.5
```

Apply `strokeDasharray` and `strokeWidthBase` to the visible `<path>` element.

4. In `EdgeLayer`, read zoom from store and pass to each `EdgePath`:

```typescript
const zoom = useCanvasStore((s) => s.viewport.zoom)
// In the map:
<EdgePath key={edge.id} edge={edge} nodes={nodes} zoom={zoom} />
```

- [ ] **Step 3: Run existing edge tests**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/ 2>&1 | tail -10`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/design/tokens.ts src/renderer/src/panels/canvas/EdgeLayer.tsx
git commit -m "feat: add edge styling for contains/imports/references kinds with zoom threshold"
```

---

### Wave 2, Task E: Canvas Mutation Types

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
    summary: { addedNodes: nodes.length, addedEdges: edges.length, movedNodes: 0, skippedFiles, unresolvedRefs },
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/shared/canvas-mutation-types.ts
git commit -m "feat: add canvas mutation types and folder-map plan builder"
```

---

### Wave 2 Gate

After all tracks complete:

```bash
cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npx vitest run tests/engine/project-map-analyzers.test.ts tests/canvas/folder-map-layout.test.ts 2>&1 | tail -20
```

Expected: Zero type errors. All analyzer and layout tests pass.

---

## Wave 3: Worker + Components (5 parallel agents)

**Preconditions:** Waves 1-2 complete. These files now exist in addition to Wave 1:
- `src/shared/engine/project-map-analyzers.ts` -- extractImportSpecifiers, resolveImportPath, extractMarkdownRefs, extractConfigPathRefs, buildProjectMapSnapshot, FileInput
- `src/renderer/src/panels/canvas/folder-map-layout.ts` -- computeFolderMapLayout
- `src/renderer/src/panels/canvas/ProjectFolderCard.tsx` + registered in card-registry
- `src/shared/canvas-mutation-types.ts` -- CanvasMutationOp, CanvasMutationPlan, buildFolderMapPlan
- Edge styling in EdgeLayer.tsx + tokens.ts

**What this wave builds:** The worker, UI components, entry points, and canvas IPC. All create new files or touch files no other task in this wave touches.

---

### Wave 3, Task A: Project-Map Worker

**Files:**
- Create: `src/renderer/src/workers/project-map-worker.ts`
- Create: `tests/canvas/project-map-worker.test.ts`

**Imports:** `buildProjectMapSnapshot` from `@shared/engine/project-map-analyzers`, `computeFolderMapLayout` from `../panels/canvas/folder-map-layout`

> **NOTE:** The worker exports `processWorkerMessage` and `resetWorkerState` for testability. The `self.onmessage` wiring only runs in worker context.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/canvas/project-map-worker.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { processWorkerMessage, resetWorkerState } from '../../src/renderer/src/workers/project-map-worker'

describe('project-map-worker', () => {
  let posted: unknown[]
  beforeEach(() => { posted = []; resetWorkerState() })
  const post = (msg: unknown) => { posted.push(msg) }

  it('start initializes operation', () => {
    processWorkerMessage({ type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } }, post)
    expect(posted).toEqual([])
  })

  it('append-files posts progress', () => {
    processWorkerMessage({ type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } }, post)
    processWorkerMessage({ type: 'append-files', operationId: 'op1', files: [{ path: '/project/app.ts', content: 'const x = 1' }] }, post)
    expect(posted.length).toBe(1)
    expect((posted[0] as { type: string }).type).toBe('progress')
  })

  it('ignores append-files with wrong operationId', () => {
    processWorkerMessage({ type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } }, post)
    processWorkerMessage({ type: 'append-files', operationId: 'stale', files: [{ path: '/project/app.ts', content: '' }] }, post)
    expect(posted).toEqual([])
  })

  it('finalize produces result', () => {
    processWorkerMessage({ type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } }, post)
    processWorkerMessage({ type: 'append-files', operationId: 'op1', files: [{ path: '/project/app.ts', content: '' }] }, post)
    posted = []
    processWorkerMessage({ type: 'finalize', operationId: 'op1', existingNodes: [] }, post)
    expect(posted.length).toBe(1)
    expect((posted[0] as { type: string }).type).toBe('result')
  })

  it('cancel clears state', () => {
    processWorkerMessage({ type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } }, post)
    processWorkerMessage({ type: 'cancel', operationId: 'op1' }, post)
    processWorkerMessage({ type: 'append-files', operationId: 'op1', files: [{ path: '/project/app.ts', content: '' }] }, post)
    expect(posted).toEqual([])
  })

  it('finalize with wrong operationId is ignored', () => {
    processWorkerMessage({ type: 'start', operationId: 'op1', rootPath: '/project', options: { expandDepth: 2, maxNodes: 200 } }, post)
    processWorkerMessage({ type: 'finalize', operationId: 'wrong', existingNodes: [] }, post)
    expect(posted).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**

> Full implementation in `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 8 Step 3. Key: union-typed messages, `processWorkerMessage` exported for testing, `resetWorkerState` for test cleanup, `self.onmessage` wiring guarded by `typeof document === 'undefined'`.

- [ ] **Step 4: Run tests -- all pass**
- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/workers/project-map-worker.ts tests/canvas/project-map-worker.test.ts
git commit -m "feat: add project-map worker with append/finalize/cancel protocol"
```

---

### Wave 3, Task B: Entry Points (Sidebar + App.tsx)

**Files:**
- Modify: `src/renderer/src/panels/sidebar/FileContextMenu.tsx`
- Modify: `src/renderer/src/App.tsx`

> **NOTE:** No other task in this wave touches these files. This task adds UI entry points that will be wired to the orchestrator in Wave 5.

- [ ] **Step 1: Add 'map-to-canvas' to FOLDER_ACTIONS**

In `src/renderer/src/panels/sidebar/FileContextMenu.tsx`, update `FOLDER_ACTIONS` (line 24):

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

- [ ] **Step 2: Add handler + state in App.tsx**

In `src/renderer/src/App.tsx`:

1. Add state near other `useState` calls:
```typescript
const [pendingFolderMap, setPendingFolderMap] = useState<string | null>(null)
```

2. Add case to `handleFileAction` switch (after the `delete` case, around line 488):
```typescript
case 'map-to-canvas': {
  const { setActiveTabId } = useEditorStore.getState()
  setActiveTabId('canvas')
  setPendingFolderMap(action.path)
  break
}
```

3. Find where CommandPalette items are built and add a command item:
```typescript
{ id: 'map-vault-root', title: 'Map Vault Root', category: 'command' as const }
```

4. Handle its selection:
```typescript
if (item.id === 'map-vault-root') {
  const vaultPath = useVaultStore.getState().vaultPath
  if (vaultPath) {
    useEditorStore.getState().setActiveTabId('canvas')
    setPendingFolderMap(vaultPath)
  }
}
```

5. Pass `pendingFolderMap` and `setPendingFolderMap` as props to the CanvasView component (it will consume them in Wave 5).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/sidebar/FileContextMenu.tsx src/renderer/src/App.tsx
git commit -m "feat: add Map to Canvas entry points in sidebar and command palette"
```

---

### Wave 3, Task C: SVG Preview Layer

**Files:**
- Create: `src/renderer/src/panels/canvas/FolderMapPreview.tsx`

**Imports:** `CanvasMutationPlan` from `@shared/canvas-mutation-types`, `colors` from `../../design/tokens`

> Full component code in `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 17 Step 1. Key: SVG layer with semi-transparent rects for add-node ops, thin lines for add-edge ops, fixed-position confirmation bar with Apply/Cancel buttons. Does NOT render full CardShell components.

- [ ] **Step 1: Create the component**
- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/FolderMapPreview.tsx
git commit -m "feat: add lightweight SVG preview layer with confirmation bar"
```

---

### Wave 3, Task D: Pending-Apply Safety + Undo

**Files:**
- Create: `src/renderer/src/panels/canvas/folder-map-apply.ts`
- Create: `tests/canvas/folder-map-apply.test.ts`

**Imports:** `CanvasMutationPlan` from `@shared/canvas-mutation-types`, `useCanvasStore`, `CommandStack`

> Full implementation and tests in `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 18. Key exports: `applyFolderMapPlan(plan, commandStack)`, `getPendingApply()`, `rollbackPendingApplyIfNeeded()`.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests -- all pass**
- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/folder-map-apply.ts tests/canvas/folder-map-apply.test.ts
git commit -m "feat: add folder-map apply with pending-apply safety and undo integration"
```

---

### Wave 3, Task E: Canvas Snapshot/Apply IPC

**Files:**
- Modify: `src/shared/ipc-channels.ts` (also modified in Wave 1 Task B -- no conflict, different channels)
- Create: `src/main/ipc/canvas.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts` (also modified in Wave 1 Task B -- no conflict, different namespace)

> **CRITICAL:** This task modifies `ipc-channels.ts` and `preload/index.ts` which were also modified in Wave 1. Those changes are already committed. Read the current state of these files before editing -- don't assume the original line numbers.

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

> Full implementation in `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 21 Step 2. Key: `registerCanvasIpc()` function with `validateOp()` helper, optimistic locking via `expectedMtime`, atomic plan rejection on validation failure.

- [ ] **Step 3: Register in main/index.ts**

Add `import { registerCanvasIpc } from './ipc/canvas'` and call `registerCanvasIpc()` in the registration block.

- [ ] **Step 4: Expose in preload**

In `src/preload/index.ts`, add a `canvas` namespace:

```typescript
canvas: {
  getSnapshot: (canvasPath: string) => typedInvoke('canvas:get-snapshot', { canvasPath }),
  applyPlan: (canvasPath: string, expectedMtime: string, plan: any) =>
    typedInvoke('canvas:apply-plan', { canvasPath, expectedMtime, plan }),
},
```

- [ ] **Step 5: Verify it compiles**
- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/canvas.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add canvas:get-snapshot and canvas:apply-plan IPC with validation"
```

---

### Wave 3 Gate

```bash
cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck && npx vitest run tests/engine/ tests/canvas/ 2>&1 | tail -20
```

Expected: Zero type errors. All tests pass.

---

## Wave 4: Orchestrator + MCP (2 parallel agents)

**Preconditions:** Waves 1-3 complete. Key additions from Wave 3:
- `src/renderer/src/workers/project-map-worker.ts` -- processWorkerMessage, ProjectMapWorkerIn/Out
- `src/renderer/src/panels/canvas/FolderMapPreview.tsx` -- preview component
- `src/renderer/src/panels/canvas/folder-map-apply.ts` -- applyFolderMapPlan, rollbackPendingApplyIfNeeded
- `src/main/ipc/canvas.ts` -- canvas:get-snapshot, canvas:apply-plan handlers registered
- Entry points wired in FileContextMenu.tsx and App.tsx (pendingFolderMap state)

---

### Wave 4, Task A: Folder-Map Orchestrator

**Files:**
- Create: `src/renderer/src/panels/canvas/folder-map-orchestrator.ts`

**Imports:** `ProjectMapWorkerIn/Out` from worker, `buildFolderMapPlan` from mutation types, `isBinaryPath` from project-map-types, `window.api.fs.listAllFiles` and `window.api.fs.readFilesBatch` from preload

> Full implementation in `docs/superpowers/plans/2026-03-31-folder-to-canvas.md`, Task 12 Step 1. Key exports: `mapFolderToCanvas(rootPath, existingNodes, onProgress, options?)`, `cancelFolderMap()`, `FolderMapProgress`, `FolderMapResult`.

- [ ] **Step 1: Implement the orchestrator**
- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/folder-map-orchestrator.ts
git commit -m "feat: add folder-map orchestrator with chunked reads and worker coordination"
```

---

### Wave 4, Task B: MCP Tools

**Files:**
- Modify: `src/main/services/mcp-server.ts`

> **CRITICAL:** Read the full `mcp-server.ts` file first. Follow the exact patterns used by existing tools (`vault.read_file`, `vault.write_file`). Three tools to add:
>
> 1. `project.map_folder` -- read tool, triggers folder analysis, returns ProjectMapSnapshot
> 2. `canvas.get_snapshot` -- read tool, reads canvas file + mtime
> 3. `canvas.apply_plan` -- write tool, MUST go through `ElectronHitlGate`, validates and applies CanvasMutationPlan

- [ ] **Step 1: Read mcp-server.ts to understand patterns**
- [ ] **Step 2: Add three MCP tools following existing patterns**
- [ ] **Step 3: Verify it compiles**
- [ ] **Step 4: Commit**

```bash
git add src/main/services/mcp-server.ts
git commit -m "feat: add project.map_folder, canvas.get_snapshot, canvas.apply_plan MCP tools"
```

---

### Wave 4 Gate

```bash
cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10
```

Expected: Zero type errors.

---

## Wave 5: Integration (sequential)

**Preconditions:** Waves 1-4 complete. All modules exist. This wave wires them together.

> **SEQUENTIAL:** This wave has one task and one quality gate. Run them in order.

---

### Wave 5, Task A: Wire Orchestrator + Preview/Apply into CanvasView

**Files:**
- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx`

> **CRITICAL:** This is the integration task. Read the current state of CanvasView.tsx carefully before editing. It's 659 lines. Make surgical additions:

- [ ] **Step 1: Add imports**

```typescript
import { mapFolderToCanvas, cancelFolderMap } from './folder-map-orchestrator'
import type { FolderMapProgress } from './folder-map-orchestrator'
import { FolderMapPreview } from './FolderMapPreview'
import { applyFolderMapPlan } from './folder-map-apply'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { computeImportViewport } from './import-logic'
```

- [ ] **Step 2: Add props and state**

Add to the component props interface:
```typescript
pendingFolderMap?: string | null
onFolderMapConsumed?: () => void
```

Add state:
```typescript
const [folderMapProgress, setFolderMapProgress] = useState<FolderMapProgress | null>(null)
const [previewPlan, setPreviewPlan] = useState<CanvasMutationPlan | null>(null)
```

- [ ] **Step 3: Add effect to trigger mapping**

```typescript
useEffect(() => {
  if (!pendingFolderMap) return
  onFolderMapConsumed?.()

  void (async () => {
    try {
      const existingNodes = useCanvasStore.getState().nodes
      const result = await mapFolderToCanvas(pendingFolderMap, existingNodes, setFolderMapProgress)
      if (result) setPreviewPlan(result.plan)
    } catch (err) {
      console.error('Folder map failed:', err)
    } finally {
      setFolderMapProgress(null)
    }
  })()

  return () => cancelFolderMap()
}, [pendingFolderMap])
```

- [ ] **Step 4: Add apply/cancel handlers**

```typescript
const handleApplyPlan = useCallback(() => {
  if (!previewPlan) return
  applyFolderMapPlan(previewPlan, commandStack.current)
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

const handleCancelPlan = useCallback(() => { setPreviewPlan(null) }, [])
```

- [ ] **Step 5: Add preview + progress to render**

Inside `<CanvasSurface>` children (before the closing `</CanvasSurface>`):

```tsx
{previewPlan && (
  <FolderMapPreview plan={previewPlan} onApply={handleApplyPlan} onCancel={handleCancelPlan} />
)}
```

Add progress indicator as a sibling after `</CanvasSurface>`:

```tsx
{folderMapProgress && folderMapProgress.phase !== 'idle' && folderMapProgress.phase !== 'done' && (
  <div style={{
    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
    padding: '8px 16px', borderRadius: '8px',
    background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)',
    fontSize: '13px', color: 'var(--color-text-secondary)', zIndex: 10,
  }}>
    {folderMapProgress.phase === 'error'
      ? `\u26A0 ${folderMapProgress.errorMessage ?? 'Mapping failed'}`
      : `Mapping\u2026 ${folderMapProgress.filesProcessed}/${folderMapProgress.totalFiles} files`
    }
  </div>
)}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck 2>&1 | tail -10`

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasView.tsx
git commit -m "feat: wire folder-map orchestrator, preview, and apply into CanvasView"
```

---

### Wave 5 Gate (Phase 1 + 2 Quality Gate)

```bash
cd /Users/caseytalbot/Projects/thought-engine && npm run check 2>&1 | tail -20
```

Expected: lint + typecheck + test all pass clean.

---

## Wave 6: Final Quality Gate (sequential)

**Preconditions:** All waves complete. Full feature is integrated.

- [ ] **Step 1: Run full quality gate**

```bash
cd /Users/caseytalbot/Projects/thought-engine && npm run check 2>&1 | tail -20
```

Expected: lint + typecheck + test all pass clean.

- [ ] **Step 2: Run all new test files specifically**

```bash
cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/engine/project-map-analyzers.test.ts tests/canvas/folder-map-layout.test.ts tests/canvas/project-map-worker.test.ts tests/canvas/folder-map-apply.test.ts 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 3: Verify no regressions in existing canvas tests**

```bash
cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/canvas/ 2>&1 | tail -20
```

Expected: All pass including existing tests (canvas-store, canvas-commands, canvas-layout, etc.)

---

## Quick Reference: Wave Summary

| Wave | Agents | Tasks | Creates | Duration Est. |
|------|--------|-------|---------|---------------|
| **1** | 3 parallel | A: types, B: batch IPC, C: project-folder type | 1 new file, 3 modified | Short |
| **2** | 5 parallel (1 chain) | A: analyzers (chain of 4), B: layout, C: folder card, D: edge styling, E: mutation types | 5 new files, 2 modified | Medium (analyzer chain is critical path) |
| **3** | 5 parallel | A: worker, B: entry points, C: preview, D: apply safety, E: canvas IPC | 5 new files, 4 modified | Medium |
| **4** | 2 parallel | A: orchestrator, B: MCP tools | 1 new file, 1 modified | Short |
| **5** | 1 sequential | A: wire CanvasView | 1 modified (CanvasView.tsx) | Short |
| **6** | 1 sequential | Quality gate | None | Short |

**Critical path:** Wave 2 Task A (4-step analyzer chain) is the longest single track. Everything else in Wave 2 will finish before it.

**Cross-references to full code:** Several tasks in Waves 2-4 reference `docs/superpowers/plans/2026-03-31-folder-to-canvas.md` for complete implementation code. That file remains the source of truth for detailed code blocks that were too large to duplicate here.
