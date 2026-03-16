# Smart Graph Import: Design Specification

## Problem

The current "Import from Graph" button dumps every vault note onto the canvas as a flat grid. With large vaults (50+ notes), this creates an overwhelming, low-signal view: a wall of cards with spaghetti edge connections. The canvas becomes unusable rather than insightful.

## Goal

Replace the bulk import with a focused, command-palette-style picker that lets users import high-signal subsets of their knowledge graph: the neighborhood of a note they're working on, the structural hubs of their vault, or notes sharing a specific tag. Cap imports at 25 nodes to keep the canvas readable.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Palette layout | Command palette (flat searchable list) | Fastest path from intent to action. One click to import. Familiar Cmd+K pattern. Scales with vault size. |
| Trigger | Toolbar button + Cmd+G keyboard shortcut | Power users get keyboard flow, new users discover via toolbar. |
| Neighborhood depth | Sub-menu expansion (1/2/3 hop sub-rows with live counts) | Shows count per depth before committing. Key info for deciding scope. |
| Import cap | Hard cap at 25 notes | Enough for rich exploration, prevents spaghetti. Most-connected nodes kept when filtering. |
| Post-import | Auto-zoom to fit imported cards | Immediate orientation without manual pan/zoom. |

## Interaction Model

### Trigger

User clicks the graph icon in the canvas toolbar OR presses Cmd+G while canvas is focused. Both open the same centered command palette overlay.

### Palette Structure

```
[Search icon] Import graph...                    [Cmd+G]
──────────────────────────────────────────────────────────
● Neighborhood of "Alan Watts"                      ~18
  (click expands to depth sub-rows:)
    1 hop                                            ~6
    2 hops                                          ~18
    3 hops                                          ~25
──────────────────────────────────────────────────────────
● Hub Notes (top 15)                                 15
──────────────────────────────────────────────────────────
● Tag: #naval-reading                                12
● Tag: #first-principles                              8
● Tag: #stoicism                                      5
● Tag: #mental-models                                 4
  ...
```

### Behavior

- **Neighborhood row**: Uses `activeNoteId` from editor store as the center node. If no note is active, row shows disabled with "No active note" hint. Clicking expands to show 1/2/3 hop sub-rows with live counts (capped at 25). Click a sub-row to import.
- **Hub Notes row**: Imports the top 15 most-connected nodes immediately on click.
- **Tag rows**: Auto-populated from all tags discovered across vault artifacts. Each imports all notes with that tag (capped at 25, most-connected first) on click.
- **Search input**: Filters the list by matching tag names, "neighborhood", "hub".
- **Dismiss**: Escape key or click-outside closes the palette.
- **Post-import**: Palette closes, viewport auto-zooms to fit the imported cards.

## Data Flow

```
User clicks import row
  -> Compute node set:
     - Neighborhood: BFS via buildLocalGraphModel(graph, activeNodeId, depth, filters)
     - Hubs: graph.nodes sorted by connectionCount descending, take top 15
     - Tags: graph.nodes filtered by tag membership
  -> Apply 25-node cap (keep most-connected when exceeding)
  -> Filter edges to only those between selected nodes
  -> graphToCanvas({ nodes, edges }, idToPath) -> CanvasNode[] + CanvasEdge[]
  -> addNode/addEdge for each result
  -> Auto-zoom viewport to fit all new cards
```

### Key Functions Used

- `buildLocalGraphModel(graph, activeNodeId, depth, filters)` from `graph-model.ts` for neighborhood mode (BFS traversal). Filters:
  ```typescript
  const IMPORT_FILTERS: GraphFilters = {
    showOrphans: true,       // include orphans, user explicitly chose this subset
    showExistingOnly: true,  // exclude ghost/placeholder nodes
    searchQuery: ''
  }
  ```
- `graph.nodes.sort((a, b) => b.connectionCount - a.connectionCount).slice(0, N)` for hub mode
- `graph.nodes.filter(n => n.tags?.includes(tag))` for tag mode
- `graphToCanvas(filteredGraph, idToPath)` from `graph-to-canvas.ts` for canvas conversion (already handles grid layout and edge mapping)

### Tag Discovery

Collect all unique tags from `vault-store.artifacts` (reliable, complete source; every artifact has `tags: string[]`). For the actual import node set, filter `graph.nodes` by `n.tags?.includes(tag)` so nodes and edges remain graph-consistent.

### idToPath Map Construction

The vault store provides `fileToId: Record<filePath, artifactId>` (path-to-id). `graphToCanvas` needs the inverse (id-to-path). Invert it:

```typescript
function buildIdToPath(fileToId: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [path, id] of Object.entries(fileToId)) {
    map.set(id, path)
  }
  return map
}
```

This utility should be extracted to a shared location since both `CanvasToolbar` and `GraphImportPalette` need it.

## Component Architecture

### New File: `GraphImportPalette.tsx` (~200 lines)

Self-contained component managing its own state:

**State**: open/closed, search query, expanded neighborhood (boolean), computed counts per mode

**Store reads**:
- `useVaultStore`: graph, fileToId, artifacts (for tag discovery)
- `useEditorStore`: activeNoteId (neighborhood center)
- `useCanvasStore`: addNode, addEdge, setViewport

**Rendering**: Fixed overlay (centered, z-50) with semi-transparent backdrop. Uses existing design tokens for colors, border radius, typography.

**Sections**:
1. Search input with Cmd+G badge
2. Neighborhood section (collapsible depth sub-rows)
3. Hub Notes row
4. Tag rows (filtered by search query)

### Modified: `CanvasView.tsx`

- Mount `GraphImportPalette` component
- Add Cmd+G keyboard listener in existing keydown effect
- Pass `containerSize` for auto-zoom computation
- Pass `onImportComplete` callback for auto-zoom

### Modified: `CanvasToolbar.tsx`

- Graph button calls `onOpenImport()` prop instead of directly importing
- Remove inline `graphToCanvas` call and vault store reads
- Simplify to a presentational trigger

### Unchanged: `graph-to-canvas.ts`

Already accepts a filtered `KnowledgeGraph` and `idToPath` map. No modifications needed.

## Auto-Zoom After Import

After importing cards, compute the bounding box of all new nodes and set the viewport to fit with padding:

```typescript
function computeImportViewport(
  nodes: readonly CanvasNode[],
  containerWidth: number,
  containerHeight: number
): CanvasViewport {
  const padding = 100
  const minX = Math.min(...nodes.map(n => n.position.x))
  const minY = Math.min(...nodes.map(n => n.position.y))
  const maxX = Math.max(...nodes.map(n => n.position.x + n.size.width))
  const maxY = Math.max(...nodes.map(n => n.position.y + n.size.height))

  const zoom = Math.min(
    containerWidth / (maxX - minX + padding * 2),
    containerHeight / (maxY - minY + padding * 2),
    1.0  // never zoom past 100%
  )

  return {
    x: -(minX - padding) * zoom,
    y: -(minY - padding) * zoom,
    zoom
  }
}
```

## Import Placement

When the canvas already has nodes, imported cards must not overlap them. Before running `graphToCanvas`, compute the bounding box of existing nodes and offset the grid origin:

```typescript
const existingNodes = useCanvasStore.getState().nodes
if (existingNodes.length > 0) {
  const maxX = Math.max(...existingNodes.map(n => n.position.x + n.size.width))
  gridOriginX = maxX + 200  // 200px gap to the right of existing content
}
```

Pass this offset into `graphToCanvas` (extend it with an optional `origin` parameter), or apply the offset to all returned node positions before adding them to the store.

Auto-zoom after import considers only the new cards, not existing ones. This focuses the user on what they just imported.

## Undo Support

Import is a single undoable operation. Rather than calling `addNode`/`addEdge` individually (which would create 25+ undo steps), wrap the entire import in one `CommandStack.execute()` call:

```typescript
commandStack.current.execute({
  execute: () => {
    for (const node of result.nodes) addNode(node)
    for (const edge of result.edges) addEdge(edge)
  },
  undo: () => {
    for (const node of result.nodes) removeNode(node.id)
    // edges cascade-delete with their nodes, no separate cleanup needed
  }
})
```

One Cmd+Z undoes the entire import.

## Edge Cases

- **No active note**: Neighborhood row disabled with "(no active note)" hint. Hub and tag modes still work.
- **Empty graph**: Palette shows "No notes indexed yet" message. All rows disabled.
- **Empty node set**: `computeImportViewport` returns default viewport `{ x: 0, y: 0, zoom: 1 }` if nodes array is empty.
- **Tag with 0 notes**: Not shown in the list (filtered out).
- **Cap exceeded**: Row shows "(25 of 40)" indicating the cap is active. Most-connected nodes are kept.
- **Duplicate import**: Importing the same set again creates new cards offset to the right of existing content (no overlap). This is intentional: users may want multiple spatial arrangements.
- **Ghost nodes**: Filtered out via `showExistingOnly: true` in neighborhood mode. Hub/tag modes only operate on real artifacts, so ghosts are excluded naturally.
- **Hub count (15) vs cap (25)**: Hub mode intentionally imports only the top 15 to show the structural skeleton, not the full cap. This is a curated view, not a quantity fill.
- **Cmd+G shortcut**: Only active when the canvas panel is focused. Does not conflict with browser/system "Find Next" since the canvas has its own keyboard scope.

## Testing

- `graph-import-palette.test.ts`: Node filtering logic (neighborhood BFS, hub sorting, tag filtering), 25-cap behavior, edge filtering, empty graph handling, disabled neighborhood when no active note
- Existing `graph-to-canvas.test.ts`: Already covers the conversion layer
- Manual verification: Import each mode, verify card count, verify edges, verify auto-zoom
