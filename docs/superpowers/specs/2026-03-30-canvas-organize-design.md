# Canvas Semantic Organization + Sidebar Navigation

**Date**: 2026-03-30
**Status**: Approved

## Overview

Three changes to the canvas and sidebar:

1. **Semantic auto-organize** for canvas cards using vault knowledge graph data
2. **Sidebar click-to-pan** for files on the canvas
3. **Edge count display** on card chrome and sidebar

## 1. Semantic Auto-Organize

### Algorithm

**Clustering**: Cards are grouped by their primary tag (first entry in `artifact.tags[]`). The top-level segment of hierarchical tags is used (e.g., `philosophy/eastern` clusters under `philosophy`). Cards with no tags go into an "Untagged" cluster.

**Cluster grid**: Clusters arrange in a roughly square grid (e.g., 9 clusters in 3x3), sorted alphabetically by tag name. Each cluster gets a bounding box sized to fit its cards in a local sub-grid (2-3 columns depending on card count).

**Intra-cluster ordering**: Within each cluster, cards sort by graph connectivity. Cards with the most edges to other cards in the same cluster go to the center. Hub notes sit at the heart, peripheral notes at the edges.

**Spacing**: 120px gap between clusters for clear visual separation. 24px gap within clusters (matching existing `TILE_GAP` scale).

### Cluster Labels

Floating labels rendered above each cluster's bounding box in canvas coordinate space. They scale with zoom.

Style: mono font, muted color, uppercase, wide letter-spacing (same as `sidebar-kicker` aesthetic).

Labels persist after organize until the user manually moves any card, at which point all labels clear (the spatial contract is broken). Labels also clear and regenerate on the next organize.

### Trigger

Refactor the existing tile layout popover (4-square grid toolbar button):
- New top item: **"Organize by topic"** (the semantic layout)
- Divider
- Existing 5 geometric patterns below

Keyboard: `Cmd+Shift+L` triggers semantic organize. `Cmd+L` remains grid-2x2.

### Scope

- If cards are selected, only selected cards organize (others untouched)
- If no selection, all cards organize
- Layout centers on the current viewport center

### Undo

A single compound command pushed onto the existing `CommandStack`. `Cmd+Z` reverts all card positions in one step. Cluster labels clear on undo.

## 2. Sidebar Click-to-Pan

When a file has the canvas presence indicator (`isOnCanvas`):
- **Single click** pans the canvas to center that card in the viewport at current zoom. If the user is on the editor tab, switch to canvas tab first.
- **Double click** always opens in editor, regardless of canvas presence.

Files not on the canvas behave as before (single click opens in editor).

## 3. Edge Count Display

### Card title bar

A small connection count number in the card shell header for `note` type cards. Shows the total graph edge count for that artifact. Mono font, muted color, no background. Only rendered when count > 0.

### Sidebar threshold

Lower the `canvasConnectionCount` display threshold from `>= 2` to `>= 1` so all on-canvas files with any connections show their count.

## Implementation Surface

| File | Change |
|---|---|
| `src/renderer/src/panels/canvas/canvas-tiling.ts` | Add `computeSemanticLayout()`: tag clustering, graph sort, cluster grid |
| `src/renderer/src/panels/canvas/CanvasToolbar.tsx` | Add "Organize by topic" to tile popover, wire handler |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Register `Cmd+Shift+L`, pass graph/artifacts to organize, render ClusterLabels |
| `src/renderer/src/panels/canvas/ClusterLabels.tsx` | **New**: floating cluster name labels in canvas coords |
| `src/renderer/src/store/canvas-store.ts` | Add `clusterLabels` state + set/clear actions, clear on `moveNode` |
| `src/renderer/src/panels/sidebar/FileTree.tsx` | Click-to-pan when `isOnCanvas`, lower count threshold to >= 1 |
| `src/renderer/src/panels/canvas/CardShell.tsx` | Edge count badge in title bar for note cards |

### Data Flow

```
CanvasView reads artifacts + graph from vault-store
  -> passes to computeSemanticLayout() with current canvas nodes
  -> returns: Map<nodeId, {x, y}> + Array<{label, position}>
  -> canvas-store.applyTileLayout() via CommandStack (undoable)
  -> canvas-store.setClusterLabels()
  -> ClusterLabels component renders labels
  -> any moveNode() call clears clusterLabels
```

### New Types

```typescript
interface ClusterLabel {
  readonly label: string
  readonly position: { readonly x: number; readonly y: number }
}

interface SemanticLayoutResult {
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>
  readonly labels: readonly ClusterLabel[]
}
```

## Dependencies

- Reads from `vault-store` (artifacts, graph) -- no changes to shared engine
- Reads from `canvas-store` (nodes, viewport) -- minor state additions
- No new npm packages
