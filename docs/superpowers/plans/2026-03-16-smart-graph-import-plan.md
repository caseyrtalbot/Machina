# Smart Graph Import Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bulk "Import from Graph" with a command-palette-style picker offering three focused import modes (neighborhood, hubs, by-tag) with a 25-node cap, auto-zoom, and single-operation undo.

**Architecture:** New `GraphImportPalette` component reads from vault/editor/canvas stores, computes filtered node sets using existing `buildLocalGraphModel` and array operations, passes them through `graphToCanvas` with an offset origin, and batch-adds results to the canvas via a single `CommandStack` entry. Triggered by toolbar button or Cmd+G.

**Tech Stack:** React 18, TypeScript, Zustand, existing graph-model.ts BFS, existing graph-to-canvas.ts projection

**Spec:** `docs/superpowers/specs/2026-03-16-smart-graph-import-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/src/panels/canvas/graph-import-logic.ts` | Create | Pure functions: `buildIdToPath`, `computeImportNodes`, `computeImportViewport`, `applyOriginOffset`. All import logic, no React. |
| `src/renderer/src/panels/canvas/GraphImportPalette.tsx` | Create | UI component: centered overlay, search input, rows for neighborhood/hubs/tags, depth sub-rows. |
| `src/renderer/src/panels/canvas/graph-to-canvas.ts` | Modify | Add optional `origin` parameter to `graphToCanvas` for offset placement. |
| `src/renderer/src/panels/canvas/CanvasToolbar.tsx` | Modify | Remove inline import logic, add `onOpenImport` prop. |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Modify | Mount palette, add Cmd+G listener, wire import-with-undo callback. |
| `tests/canvas/graph-import-logic.test.ts` | Create | Tests for all pure functions (buildIdToPath, computeImportViewport, computeImportNodes, computeOriginOffset, collectUniqueTags). |

---

## Chunk 1: Pure Import Logic + Tests

### Task 1: Create `graph-import-logic.ts` with `buildIdToPath` and `computeImportViewport`

**Files:**
- Create: `src/renderer/src/panels/canvas/graph-import-logic.ts`
- Test: `tests/canvas/graph-import-logic.test.ts`

- [ ] **Step 1: Write failing tests for `buildIdToPath` and `computeImportViewport`**

```typescript
// tests/canvas/graph-import-logic.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildIdToPath,
  computeImportViewport
} from '../../src/renderer/src/panels/canvas/graph-import-logic'
import { createCanvasNode } from '../../src/shared/canvas-types'

describe('buildIdToPath', () => {
  it('inverts fileToId record into id-to-path map', () => {
    const fileToId = {
      '/vault/note-a.md': 'id-a',
      '/vault/note-b.md': 'id-b'
    }
    const result = buildIdToPath(fileToId)
    expect(result.get('id-a')).toBe('/vault/note-a.md')
    expect(result.get('id-b')).toBe('/vault/note-b.md')
    expect(result.size).toBe(2)
  })

  it('returns empty map for empty input', () => {
    expect(buildIdToPath({}).size).toBe(0)
  })
})

describe('computeImportViewport', () => {
  it('returns default viewport for empty nodes', () => {
    const vp = computeImportViewport([], 1000, 800)
    expect(vp).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('computes viewport that fits all nodes with padding', () => {
    const nodes = [
      createCanvasNode('note', { x: 0, y: 0 }, { size: { width: 280, height: 200 } }),
      createCanvasNode('note', { x: 360, y: 0 }, { size: { width: 280, height: 200 } })
    ]
    const vp = computeImportViewport(nodes, 1000, 800)
    expect(vp.zoom).toBeGreaterThan(0)
    expect(vp.zoom).toBeLessThanOrEqual(1.0)
  })

  it('never zooms past 1.0', () => {
    const nodes = [createCanvasNode('note', { x: 0, y: 0 }, { size: { width: 100, height: 100 } })]
    const vp = computeImportViewport(nodes, 2000, 2000)
    expect(vp.zoom).toBe(1.0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- tests/canvas/graph-import-logic.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `buildIdToPath` and `computeImportViewport`**

```typescript
// src/renderer/src/panels/canvas/graph-import-logic.ts
import type { CanvasNode, CanvasViewport } from '@shared/canvas-types'

/** Invert vault store's fileToId (path->id) to id->path for graphToCanvas. */
export function buildIdToPath(fileToId: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [path, id] of Object.entries(fileToId)) {
    map.set(id, path)
  }
  return map
}

/**
 * Compute a viewport that fits the imported nodes with padding.
 * Returns default viewport if nodes is empty.
 */
export function computeImportViewport(
  nodes: readonly CanvasNode[],
  containerWidth: number,
  containerHeight: number
): CanvasViewport {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 }

  const padding = 100
  const minX = Math.min(...nodes.map((n) => n.position.x))
  const minY = Math.min(...nodes.map((n) => n.position.y))
  const maxX = Math.max(...nodes.map((n) => n.position.x + n.size.width))
  const maxY = Math.max(...nodes.map((n) => n.position.y + n.size.height))

  const zoom = Math.min(
    containerWidth / (maxX - minX + padding * 2),
    containerHeight / (maxY - minY + padding * 2),
    1.0
  )

  return {
    x: -(minX - padding) * zoom,
    y: -(minY - padding) * zoom,
    zoom
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- tests/canvas/graph-import-logic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/canvas/graph-import-logic.ts tests/canvas/graph-import-logic.test.ts
git commit -m "feat: add buildIdToPath and computeImportViewport utilities"
```

---

### Task 2: Add `computeImportNodes` for all three modes + 25-cap

**Files:**
- Modify: `src/renderer/src/panels/canvas/graph-import-logic.ts`
- Modify: `tests/canvas/graph-import-logic.test.ts`

- [ ] **Step 1: Write failing tests for `computeImportNodes`**

Add to `tests/canvas/graph-import-logic.test.ts`:

```typescript
import {
  buildIdToPath,
  computeImportViewport,
  computeImportNodes,
  IMPORT_CAP,
  HUB_COUNT
} from '../../src/renderer/src/panels/canvas/graph-import-logic'
import type { KnowledgeGraph, GraphNode } from '../../src/shared/types'

function makeNode(id: string, overrides?: Partial<GraphNode>): GraphNode {
  return {
    id,
    title: id,
    type: 'note',
    signal: 'untested',
    connectionCount: 0,
    tags: [],
    ...overrides
  }
}

describe('computeImportNodes', () => {
  describe('hub mode', () => {
    it('returns top N most-connected nodes', () => {
      const nodes = [
        makeNode('a', { connectionCount: 10 }),
        makeNode('b', { connectionCount: 5 }),
        makeNode('c', { connectionCount: 20 }),
        makeNode('d', { connectionCount: 1 })
      ]
      const graph: KnowledgeGraph = { nodes, edges: [] }
      const result = computeImportNodes(graph, { mode: 'hub' })
      expect(result.nodes[0].id).toBe('c')
      expect(result.nodes[1].id).toBe('a')
      expect(result.nodes.length).toBeLessThanOrEqual(HUB_COUNT)
    })
  })

  describe('tag mode', () => {
    it('returns nodes with the specified tag', () => {
      const nodes = [
        makeNode('a', { tags: ['ai', 'ml'] }),
        makeNode('b', { tags: ['ai'] }),
        makeNode('c', { tags: ['design'] })
      ]
      const graph: KnowledgeGraph = { nodes, edges: [] }
      const result = computeImportNodes(graph, { mode: 'tag', tag: 'ai' })
      expect(result.nodes).toHaveLength(2)
      expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    })
  })

  describe('cap enforcement', () => {
    it('caps at IMPORT_CAP nodes, keeping most-connected', () => {
      const nodes = Array.from({ length: 40 }, (_, i) =>
        makeNode(`n${i}`, { connectionCount: 40 - i, tags: ['big'] })
      )
      const graph: KnowledgeGraph = { nodes, edges: [] }
      const result = computeImportNodes(graph, { mode: 'tag', tag: 'big' })
      expect(result.nodes.length).toBe(IMPORT_CAP)
      // Most-connected should be first
      expect(result.nodes[0].connectionCount).toBe(40)
    })
  })

  describe('edge filtering', () => {
    it('only includes edges between selected nodes', () => {
      const nodes = [
        makeNode('a', { connectionCount: 10 }),
        makeNode('b', { connectionCount: 5 }),
        makeNode('c', { connectionCount: 1 })
      ]
      const graph: KnowledgeGraph = {
        nodes,
        edges: [
          { source: 'a', target: 'b', kind: 'connection' },
          { source: 'b', target: 'c', kind: 'connection' },
          { source: 'a', target: 'c', kind: 'connection' }
        ]
      }
      // Hub mode with HUB_COUNT >= 3 returns all, so all edges survive
      const result = computeImportNodes(graph, { mode: 'hub' })
      expect(result.edges.length).toBe(3)
    })
  })

  describe('empty graph', () => {
    it('returns empty result', () => {
      const graph: KnowledgeGraph = { nodes: [], edges: [] }
      const result = computeImportNodes(graph, { mode: 'hub' })
      expect(result.nodes).toEqual([])
      expect(result.edges).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- tests/canvas/graph-import-logic.test.ts`
Expected: FAIL (computeImportNodes not exported)

- [ ] **Step 3: Implement `computeImportNodes`**

Add to `src/renderer/src/panels/canvas/graph-import-logic.ts`:

```typescript
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@shared/types'
import { buildLocalGraphModel, type GraphFilters } from '../graph/graph-model'

export const IMPORT_CAP = 25
export const HUB_COUNT = 15

export const IMPORT_FILTERS: GraphFilters = {
  showOrphans: true,
  showExistingOnly: true,
  searchQuery: ''
}

export type ImportMode =
  | { mode: 'neighborhood'; activeNodeId: string; depth: number }
  | { mode: 'hub' }
  | { mode: 'tag'; tag: string }

interface ImportResult {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

/**
 * Compute the set of graph nodes and edges for a given import mode.
 * Applies the 25-node cap, keeping the most-connected nodes when filtering.
 */
export function computeImportNodes(
  graph: KnowledgeGraph,
  mode: ImportMode
): ImportResult {
  let selectedNodes: GraphNode[]

  if (mode.mode === 'neighborhood') {
    const local = buildLocalGraphModel(graph, mode.activeNodeId, mode.depth, IMPORT_FILTERS)
    selectedNodes = [...local.nodes]
  } else if (mode.mode === 'hub') {
    selectedNodes = [...graph.nodes]
      .filter((n) => !n.id.startsWith('ghost:'))
      .sort((a, b) => b.connectionCount - a.connectionCount)
      .slice(0, HUB_COUNT)
  } else {
    selectedNodes = graph.nodes
      .filter((n) => !n.id.startsWith('ghost:') && n.tags?.includes(mode.tag))
  }

  // Apply cap (most-connected first)
  if (selectedNodes.length > IMPORT_CAP) {
    selectedNodes = [...selectedNodes]
      .sort((a, b) => b.connectionCount - a.connectionCount)
      .slice(0, IMPORT_CAP)
  }

  // Filter edges to only those between selected nodes
  const nodeIds = new Set(selectedNodes.map((n) => n.id))
  const selectedEdges = graph.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  )

  return { nodes: selectedNodes, edges: selectedEdges }
}
```

Note: The import for `buildLocalGraphModel` uses a relative path. Adjust to: `import { buildLocalGraphModel, type GraphFilters } from '../graph/graph-model'` (since graph-import-logic.ts is in the canvas directory, and graph-model.ts is in the graph directory).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- tests/canvas/graph-import-logic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/canvas/graph-import-logic.ts tests/canvas/graph-import-logic.test.ts
git commit -m "feat: add computeImportNodes with hub, tag, neighborhood modes and 25-cap"
```

---

### Task 3: Add origin offset to `graphToCanvas` and `applyOriginOffset` utility

**Files:**
- Modify: `src/renderer/src/panels/canvas/graph-to-canvas.ts`
- Modify: `src/renderer/src/panels/canvas/graph-import-logic.ts`
- Modify: `tests/canvas/graph-import-logic.test.ts`
- Modify: `tests/canvas/graph-to-canvas.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/canvas/graph-import-logic.test.ts`:

```typescript
import { computeOriginOffset } from '../../src/renderer/src/panels/canvas/graph-import-logic'

describe('computeOriginOffset', () => {
  it('returns 0 when canvas is empty', () => {
    expect(computeOriginOffset([])).toBe(0)
  })

  it('returns max right edge + 200 gap when canvas has nodes', () => {
    const nodes = [
      createCanvasNode('text', { x: 100, y: 0 }, { size: { width: 260, height: 140 } }),
      createCanvasNode('text', { x: 500, y: 0 }, { size: { width: 260, height: 140 } })
    ]
    // Max right edge = 500 + 260 = 760, plus 200 gap = 960
    expect(computeOriginOffset(nodes)).toBe(960)
  })
})
```

Add to `tests/canvas/graph-to-canvas.test.ts`:

```typescript
it('applies origin offset to node positions', () => {
  const graph: KnowledgeGraph = {
    nodes: [makeNode({ id: 'a', title: 'A' })],
    edges: []
  }
  const result = graphToCanvas(graph, EMPTY_PATHS, { x: 500, y: 100 })
  expect(result.nodes[0].position.x).toBe(500)
  expect(result.nodes[0].position.y).toBe(100)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- tests/canvas/graph-import-logic.test.ts tests/canvas/graph-to-canvas.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `computeOriginOffset` and add origin param to `graphToCanvas`**

Add to `graph-import-logic.ts`:

```typescript
/** Compute x-offset for new imports to avoid overlapping existing cards. */
export function computeOriginOffset(existingNodes: readonly CanvasNode[]): number {
  if (existingNodes.length === 0) return 0
  const maxX = Math.max(...existingNodes.map((n) => n.position.x + n.size.width))
  return maxX + 200
}
```

Modify `graph-to-canvas.ts` signature to accept optional origin:

```typescript
export function graphToCanvas(
  graph: KnowledgeGraph,
  idToPath: ReadonlyMap<string, string>,
  origin?: { x: number; y: number }
): GraphToCanvasResult {
```

And update `gridPosition` usage inside:

```typescript
const ox = origin?.x ?? 0
const oy = origin?.y ?? 0

const canvasNodes: CanvasNode[] = graph.nodes.map((gNode: GraphNode, index: number) => {
  const pos = gridPosition(index, columns)
  const position = { x: pos.x + ox, y: pos.y + oy }
  // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test -- tests/canvas/graph-import-logic.test.ts tests/canvas/graph-to-canvas.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/caseytalbot/Projects/thought-engine
git add src/renderer/src/panels/canvas/graph-to-canvas.ts src/renderer/src/panels/canvas/graph-import-logic.ts tests/canvas/graph-import-logic.test.ts tests/canvas/graph-to-canvas.test.ts
git commit -m "feat: add origin offset for graph import placement"
```

---

## Chunk 2: UI Component + Integration

### Task 4: Collect unique tags utility and test

**Files:**
- Modify: `src/renderer/src/panels/canvas/graph-import-logic.ts`
- Modify: `tests/canvas/graph-import-logic.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { collectUniqueTags } from '../../src/renderer/src/panels/canvas/graph-import-logic'

describe('collectUniqueTags', () => {
  it('collects and deduplicates tags from artifacts, sorted by frequency', () => {
    const artifacts = [
      { tags: ['ai', 'ml'] },
      { tags: ['ai', 'design'] },
      { tags: ['ml'] }
    ] as Array<{ tags: string[] }>
    const result = collectUniqueTags(artifacts as any)
    // ai: 2 occurrences, ml: 2, design: 1
    expect(result[0]).toEqual({ tag: 'ai', count: 2 })
    expect(result[1]).toEqual({ tag: 'ml', count: 2 })
    expect(result[2]).toEqual({ tag: 'design', count: 1 })
  })

  it('returns empty for no artifacts', () => {
    expect(collectUniqueTags([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement**

Add to `graph-import-logic.ts`:

```typescript
import type { Artifact } from '@shared/types'

export interface TagInfo {
  readonly tag: string
  readonly count: number
}

/** Collect unique tags from artifacts, sorted by frequency descending. */
export function collectUniqueTags(artifacts: readonly Artifact[]): readonly TagInfo[] {
  const freq = new Map<string, number>()
  for (const a of artifacts) {
    for (const tag of a.tags) {
      freq.set(tag, (freq.get(tag) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/graph-import-logic.ts tests/canvas/graph-import-logic.test.ts
git commit -m "feat: add collectUniqueTags for import palette tag rows"
```

---

### Task 5: Create `GraphImportPalette.tsx`

**Files:**
- Create: `src/renderer/src/panels/canvas/GraphImportPalette.tsx`

This is the main UI component. It uses all the pure functions from `graph-import-logic.ts`.

- [ ] **Step 1: Create the component**

```typescript
// src/renderer/src/panels/canvas/GraphImportPalette.tsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useEditorStore } from '../../store/editor-store'
import { useCanvasStore } from '../../store/canvas-store'
import { graphToCanvas } from './graph-to-canvas'
import {
  buildIdToPath,
  computeImportNodes,
  computeImportViewport,
  computeOriginOffset,
  collectUniqueTags,
  IMPORT_CAP,
  HUB_COUNT,
  IMPORT_FILTERS,
  type ImportMode
} from './graph-import-logic'
import { buildLocalGraphModel } from '../graph/graph-model'
import { colors, borderRadius } from '../../design/tokens'

interface GraphImportPaletteProps {
  open: boolean
  onClose: () => void
  onImport: (execute: () => void, undo: () => void) => void
  containerWidth: number
  containerHeight: number
}

export function GraphImportPalette({
  open,
  onClose,
  onImport,
  containerWidth,
  containerHeight
}: GraphImportPaletteProps) {
  const [search, setSearch] = useState('')
  const [neighborhoodExpanded, setNeighborhoodExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const graph = useVaultStore((s) => s.graph)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifacts = useVaultStore((s) => s.artifacts)
  const activeNoteId = useEditorStore((s) => s.activeNoteId)

  const idToPath = useMemo(() => buildIdToPath(fileToId), [fileToId])
  const tags = useMemo(() => collectUniqueTags(artifacts), [artifacts])
  const hasGraph = graph.nodes.length > 0

  // Compute neighborhood counts lazily (only when expanded)
  const neighborhoodCounts = useMemo(() => {
    if (!neighborhoodExpanded || !activeNoteId) return []
    return [1, 2, 3].map((depth) => {
      const local = buildLocalGraphModel(graph, activeNoteId, depth, IMPORT_FILTERS)
      return { depth, count: Math.min(local.nodes.length, IMPORT_CAP) }
    })
  }, [neighborhoodExpanded, activeNoteId, graph])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setSearch('')
      setNeighborhoodExpanded(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleImport = useCallback(
    (mode: ImportMode) => {
      const { nodes: graphNodes, edges: graphEdges } = computeImportNodes(graph, mode)
      if (graphNodes.length === 0) return

      const existingNodes = useCanvasStore.getState().nodes
      const originX = computeOriginOffset(existingNodes)

      const result = graphToCanvas(
        { nodes: graphNodes, edges: graphEdges },
        idToPath,
        { x: originX, y: 0 }
      )

      const { addNode, addEdge, removeNode, setViewport } = useCanvasStore.getState()

      onImport(
        () => {
          for (const node of result.nodes) addNode(node)
          for (const edge of result.edges) addEdge(edge)
          const vp = computeImportViewport(result.nodes, containerWidth, containerHeight)
          setViewport(vp)
        },
        () => {
          for (const node of result.nodes) removeNode(node.id)
        }
      )
      onClose()
    },
    [graph, idToPath, onImport, onClose, containerWidth, containerHeight]
  )

  // Filter tags by search query
  const filteredTags = useMemo(() => {
    if (!search) return tags
    const q = search.toLowerCase()
    return tags.filter((t) => t.tag.toLowerCase().includes(q))
  }, [tags, search])

  const showNeighborhood = !search || 'neighborhood'.includes(search.toLowerCase())
  const showHubs = !search || 'hub'.includes(search.toLowerCase())

  // Active note title for display
  const activeTitle = useMemo(() => {
    if (!activeNoteId) return null
    const artifact = artifacts.find((a) => a.id === activeNoteId)
    return artifact?.title ?? activeNoteId.split('/').pop()?.replace('.md', '') ?? 'Note'
  }, [activeNoteId, artifacts])

  if (!open) return null

  const rowStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderRadius: 4
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
        onClick={onClose}
      />
      {/* Palette */}
      <div
        className="fixed z-50 rounded-lg shadow-xl overflow-hidden"
        style={{
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 360,
          backgroundColor: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`
        }}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: `1px solid ${colors.border.subtle}` }}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke={colors.text.muted} strokeWidth="1.5">
            <circle cx="6" cy="6" r="4" />
            <line x1="9" y1="9" x2="12" y2="12" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Import graph..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: colors.text.primary }}
          />
          <kbd
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ backgroundColor: colors.bg.surface, color: colors.text.muted, fontSize: 10 }}
          >
            &#8984;G
          </kbd>
        </div>

        {!hasGraph ? (
          <div className="px-3 py-6 text-center">
            <span className="text-xs" style={{ color: colors.text.muted }}>No notes indexed yet</span>
          </div>
        ) : (
          <div className="py-1" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {/* Neighborhood section */}
            {showNeighborhood && (
              <>
                <div
                  style={{
                    ...rowStyle,
                    color: activeNoteId ? colors.text.primary : colors.text.muted,
                    cursor: activeNoteId ? 'pointer' : 'default'
                  }}
                  onClick={() => activeNoteId && setNeighborhoodExpanded(!neighborhoodExpanded)}
                  onMouseEnter={(e) => {
                    if (activeNoteId) e.currentTarget.style.backgroundColor = colors.accent.muted
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span style={{ color: colors.accent.default }}>&#9679;</span>
                  <span className="flex-1 truncate">
                    {activeNoteId
                      ? `Neighborhood of "${activeTitle}"`
                      : 'Neighborhood (no active note)'}
                  </span>
                  <span style={{ color: colors.text.muted, fontSize: 10 }}>
                    {activeNoteId ? (neighborhoodExpanded ? '\u25BE' : '\u25B6') : ''}
                  </span>
                </div>
                {neighborhoodExpanded && activeNoteId && neighborhoodCounts.map(({ depth, count }) => (
                  <div
                    key={depth}
                    style={{
                      ...rowStyle,
                      paddingLeft: 36,
                      color: colors.text.secondary
                    }}
                    onClick={() => handleImport({ mode: 'neighborhood', activeNodeId: activeNoteId, depth })}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = colors.accent.muted
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <span className="flex-1">{depth} hop{depth > 1 ? 's' : ''}</span>
                    <span style={{ color: colors.text.muted, fontSize: 10 }}>
                      {count === IMPORT_CAP ? `${count} (cap)` : `~${count}`}
                    </span>
                  </div>
                ))}
                <div style={{ height: 1, backgroundColor: colors.border.subtle, margin: '2px 8px' }} />
              </>
            )}

            {/* Hub Notes */}
            {showHubs && (
              <>
                <div
                  style={{ ...rowStyle, color: colors.text.primary }}
                  onClick={() => handleImport({ mode: 'hub' })}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = colors.accent.muted
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span style={{ color: '#22d3ee' }}>&#9679;</span>
                  <span className="flex-1">Hub Notes (top {HUB_COUNT})</span>
                  <span style={{ color: colors.text.muted, fontSize: 10 }}>
                    {Math.min(graph.nodes.length, HUB_COUNT)}
                  </span>
                </div>
                <div style={{ height: 1, backgroundColor: colors.border.subtle, margin: '2px 8px' }} />
              </>
            )}

            {/* Tag rows */}
            {filteredTags.map(({ tag, count }) => {
              const cappedCount = Math.min(count, IMPORT_CAP)
              const isCapped = count > IMPORT_CAP
              return (
                <div
                  key={tag}
                  style={{ ...rowStyle, color: colors.text.secondary }}
                  onClick={() => handleImport({ mode: 'tag', tag })}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = colors.accent.muted
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span style={{ color: '#f59e0b' }}>&#9679;</span>
                  <span className="flex-1 truncate">Tag: #{tag}</span>
                  <span style={{ color: colors.text.muted, fontSize: 10 }}>
                    {isCapped ? `${cappedCount} of ${count}` : count}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: Only pre-existing App.tsx error

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/panels/canvas/GraphImportPalette.tsx
git commit -m "feat: add GraphImportPalette command palette component"
```

---

### Task 6: Simplify `CanvasToolbar.tsx` and wire up `CanvasView.tsx`

**Files:**
- Modify: `src/renderer/src/panels/canvas/CanvasToolbar.tsx`
- Modify: `src/renderer/src/panels/canvas/CanvasView.tsx`

- [ ] **Step 1: Update `CanvasToolbar.tsx`**

Remove vault store reads, `graphToCanvas` import, and `importFromGraph` function. Add `onOpenImport` prop. The graph button calls this prop instead:

```typescript
// Replace the interface and imports at the top:
import { useCanvasStore } from '../../store/canvas-store'
import { colors, borderRadius } from '../../design/tokens'

interface CanvasToolbarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onAddCard: () => void
  onOpenImport: () => void
}
```

Remove `useVaultStore`, `graphToCanvas` import, `addNode`/`addEdge` reads, `fileToId`, `graph`, and the `importFromGraph` function. Replace `hasGraph` with always-enabled (the palette handles the empty state). Change the button's `onClick` from `importFromGraph` to `onOpenImport`. Remove `style={hasGraph ? btnStyle : disabledStyle}` and just use `btnStyle`.

- [ ] **Step 2: Update `CanvasView.tsx`**

Import the palette and add state + keyboard handler:

```typescript
import { GraphImportPalette } from './GraphImportPalette'

// Inside CanvasView, add:
const [importOpen, setImportOpen] = useState(false)

// Add Cmd+G handler to the existing undo/redo keyboard effect:
// In the handler that checks e.metaKey, add (with canvas focus guard):
if (e.key === 'g') {
  // Only handle Cmd+G when canvas is the active panel (not when editing in editor/terminal)
  if (!containerRef.current?.contains(document.activeElement) &&
      document.activeElement !== document.body) return
  e.preventDefault()
  setImportOpen(true)
}
```

Add the `onImport` callback that wraps in CommandStack:

```typescript
const handleImportExecute = useCallback(
  (execute: () => void, undo: () => void) => {
    commandStack.current.execute({ execute, undo })
  },
  []
)
```

Pass `onOpenImport` to toolbar:

```tsx
<CanvasToolbar
  // ... existing props
  onOpenImport={() => setImportOpen(true)}
/>
```

Mount the palette in the JSX (after `CanvasMinimap`):

```tsx
<GraphImportPalette
  open={importOpen}
  onClose={() => setImportOpen(false)}
  onImport={handleImportExecute}
  containerWidth={containerSize.width}
  containerHeight={containerSize.height}
/>
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`
Expected: Only pre-existing App.tsx error

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/panels/canvas/CanvasToolbar.tsx src/renderer/src/panels/canvas/CanvasView.tsx
git commit -m "feat: wire GraphImportPalette into canvas with Cmd+G and toolbar trigger"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run typecheck`

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm test`

- [ ] **Step 3: Start dev server and manually test**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npm run dev`

Manual checks:
1. Open a canvas, press Cmd+G: palette appears centered
2. Click toolbar graph icon: same palette appears
3. Escape or click backdrop: palette closes
4. With an active note: click Neighborhood, see depth sub-rows with counts
5. Click "2 hops": cards import, auto-zoom to fit, no overlap with existing cards
6. Click Hub Notes: top 15 most-connected appear
7. Type a tag name in search: tag rows filter
8. Click a tag: matching notes import (max 25)
9. Cmd+Z: entire import undone in one step
10. Import on non-empty canvas: new cards appear to the right of existing ones

- [ ] **Step 4: Ask user for screenshot verification**
