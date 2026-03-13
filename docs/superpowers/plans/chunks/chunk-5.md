## Chunk 5: Phase 3 — Interaction

### Task 30: Create useGraphHighlight hook (hover/click state machine)

**Files:**
- Create: `src/renderer/src/panels/graph/useGraphHighlight.ts`
- Test: `tests/graph/useGraphHighlight.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/useGraphHighlight.test.ts
import { describe, it, expect } from 'vitest'
import { buildAdjacencyList, computeConnectedSet, easeOut, interpolateGlow } from '../../src/renderer/src/panels/graph/useGraphHighlight'
import type { SimEdge } from '../../src/renderer/src/panels/graph/GraphRenderer'
```

Tests to write:

**buildAdjacencyList:**
- `builds bidirectional adjacency from edges with string IDs`
- `handles edges where source/target are SimNode objects`
- `returns empty map for no edges`

**computeConnectedSet:**
- `returns the node itself and its immediate neighbors`
- `returns singleton set for a node with no neighbors`
- `returns correct set for isolated cluster`

**easeOut:**
- `returns 0 at t=0`
- `returns 1 at t=1`
- `returns values between 0 and 1 for intermediate t`
- `decelerates (second half covers less distance than first)`

**interpolateGlow:**
- `returns startValue at elapsed=0`
- `returns target when fully elapsed (fade-in, 200ms)`
- `returns target when fully elapsed (fade-out, 300ms)`
- `interpolates partially for mid-transition`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caseytalbot/Projects/thought-engine && npx vitest run tests/graph/useGraphHighlight.test.ts`
Expected: FAIL with "cannot find module" or export not found

- [ ] **Step 3: Implement the hook and pure functions**

```typescript
// src/renderer/src/panels/graph/useGraphHighlight.ts
import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { useGraphStore } from '../../store/graph-store'
import type { SimNode, SimEdge } from './GraphRenderer'

export type HighlightMode = 'idle' | 'hover' | 'click'

export interface HighlightState {
  mode: HighlightMode
  focusedNodeId: string | null
  connectedSet: ReadonlySet<string>
  /** Current glow intensity 0-1, interpolated over time per spec 3A */
  glowIntensity: number
}

const EMPTY_SET: ReadonlySet<string> = new Set()

// Spec 3A: 200ms ease-out in, 300ms ease-out out
const GLOW_FADE_IN_MS = 200
const GLOW_FADE_OUT_MS = 300
```

**Pure functions** (exported for testing):

- `getEdgeNodeId(node: string | SimNode): string` -- extracts ID from either string or SimNode
- `buildAdjacencyList(edges: readonly SimEdge[]): Map<string, Set<string>>` -- bidirectional adjacency from edges
- `computeConnectedSet(nodeId: string, adjacency: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string>` -- node + immediate neighbors
- `easeOut(t: number): number` -- `1 - Math.pow(1 - t, 2)` deceleration curve
- `interpolateGlow(startValue: number, target: number, startTime: number, now: number): { value: number; done: boolean }` -- uses GLOW_FADE_IN_MS for fade-in, GLOW_FADE_OUT_MS for fade-out, applies easeOut

**Hook** `useGraphHighlight(edges: readonly SimEdge[])`:

State machine driven by `clickLockedRef` and `hoveredNodeId` from graph store:
- `focusedNodeId = clickLockedRef.current ?? hoveredNodeId`
- `mode`: `'click'` if click-locked, `'hover'` if hoveredNodeId, else `'idle'`
- `connectedSet`: memoized from `computeConnectedSet(focusedNodeId, adjacency)`

Glow interpolation via rAF loop:
- `glowRef` tracks `{ current, target, startValue, startTime }`
- `tickGlow` callback reads `glowRef`, calls `interpolateGlow`, updates state, schedules next rAF if not done
- `setGlowTarget(target)` starts a new transition when focus changes
- Effect drives `setGlowTarget(focusedNodeId ? 1 : 0)` on focusedNodeId change
- Cleanup cancels rAF on unmount

Returns:
```typescript
return {
  state: { mode, focusedNodeId, connectedSet, glowIntensity },
  adjacency,
  handleHover: (nodeId: string | null) => setHoveredNode(nodeId),
  handleClick: (nodeId: string | null) => { /* sets clickLockedRef + setSelectedNode */ },
  handleDoubleClick: (nodeId: string) => { /* clears lock + selection + hover */ },
}
```

**V&C:**
Run tests, then full suite. Commit: `feat: add useGraphHighlight hook with adjacency list and connected set computation`

---

### Task 31: Create glow sprite cache

**Files:**
- Create: `src/renderer/src/panels/graph/glowSprites.ts`
- Test: `tests/graph/glowSprites.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/glowSprites.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { GlowSpriteCache } from '../../src/renderer/src/panels/graph/glowSprites'
```

Mock `OffscreenCanvas` for Node test environment with `getContext()` returning a stub 2d context and `transferToImageBitmap()` returning `{ width, height, close: () => {} }`. Polyfill via `globalThis.OffscreenCanvas = MockOffscreenCanvas`.

Tests:
- `creates a sprite for a given color and radius`
- `returns the same sprite for repeated calls with same params`
- `returns different sprites for different colors`
- `returns different sprites for different radii`
- `clears all cached sprites`

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement the glow sprite cache**

```typescript
// src/renderer/src/panels/graph/glowSprites.ts

interface GlowSprite {
  bitmap: ImageBitmap | { width: number; height: number; close: () => void }
  width: number
  height: number
}

const GLOW_PADDING = 16
const AMBIENT_BLUR = 8
```

**`GlowSpriteCache` class:**
- `private cache = new Map<string, GlowSprite>()`
- `get(color: string, radius: number): GlowSprite` -- cache key is `${color}:${radius}`, creates on miss
- `clear(): void` -- closes all bitmaps, clears map

**`createGlowSprite(color, radius)`:** Creates `OffscreenCanvas` of size `(radius + GLOW_PADDING) * 2`. Draws ambient glow (shadowColor, shadowBlur=AMBIENT_BLUR, globalAlpha=0.3) then solid core (full alpha). Returns `{ bitmap: canvas.transferToImageBitmap(), width: size, height: size }`.

**`drawGlowSprite(ctx, sprite, x, y, alpha): void`:** Draws sprite.bitmap centered at (x,y) with given alpha, restoring previous globalAlpha.

**V&C:**
Run tests. Commit: `feat: add offscreen canvas glow sprite cache for graph node rendering`

---

### Task 32: Enhance GraphRenderer with glow sprites, dimming, edge brightening, labels, frame budget, and edge LOD

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphRenderer.ts`

- [ ] **Step 1: Rewrite renderGraph with highlight-aware rendering, frame budget monitoring, and edge LOD**

Keep `createSimulation`, `SimNode`, `SimEdge`, and `findNodeAt` unchanged. Key changes from spec:
- **NodeSizeMode**: imported from `graph-settings-store` (canonical location) and re-exported (issue #27)
- **Extreme zoom-out edge LOD** (spec 3E): at `k < 0.2`, edges drawn as single low-alpha overlay
- **Frame budget monitoring** (spec 3E): `performance.now()` instrumentation, warns >16ms, returns frame duration
- **Adaptive quality**: `skipAmbientSprites` option skips glow sprites when budget exceeded

**New imports:**
```typescript
import { ARTIFACT_COLORS, colors } from '../../design/tokens'
import { SIGNAL_OPACITY } from '@shared/types'
import { GlowSpriteCache, drawGlowSprite } from './glowSprites'
import type { HighlightState } from './useGraphHighlight'
import type { NodeSizeMode } from '../../store/graph-settings-store'
export type { NodeSizeMode }
```

**New types and constants:**
```typescript
export interface NodeSizeConfig {
  mode: NodeSizeMode
  baseSize: number
}

const DEFAULT_SIZE_CONFIG: NodeSizeConfig = { mode: 'degree', baseSize: 4 }

const EDGE_COLOR_MAP: Record<RelationshipKind, { color: string; width: number; dash: number[] }> = {
  connection: { color: colors.border.default, width: 1, dash: [] },
  cluster: { color: colors.semantic.cluster + '66', width: 1.5, dash: [] },
  tension: { color: colors.semantic.tension + '66', width: 1, dash: [4, 4] },
  appears_in: { color: '#3A3A3E', width: 1, dash: [] },
}

const HIGHLIGHT_EDGE_WIDTH = 1.5
const HIGHLIGHT_EDGE_ALPHA = 0.7
const DIM_ALPHA = 0.08
const HOVER_SHADOW_BLUR = 14
const LABEL_FONT = '12px Inter, sans-serif'
const SELECTED_RING_OFFSET = 4
const SELECTED_RING_ALPHA = 0.4

interface RenderOptions {
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
  skipAmbientSprites?: boolean
}
```

**`computeNodeRadius(node, config, charCount?): number`:** Switch on `config.mode`:
- `'uniform'`: return base
- `'content'`: `base + Math.log(Math.max(chars, 100) / 100) * 2`
- `'degree'` (default): `base + Math.sqrt(node.connectionCount) * 2.5`

**`nodeRadius(connectionCount): number`:** Legacy alias using DEFAULT_SIZE_CONFIG.

**`renderGraph(ctx, nodes, edges, width, height, selectedId, hoveredId, options?): number`:**

Returns frame duration in ms. Rendering pipeline (8 stages):

1. **Clear + background gradient** -- radial from `#111113` center to `colors.bg.base`
2. **Compute highlight context** -- extract connectedSet, sizeConfig from options
3. **Compute viewport culling bounds** -- transform options to graph-space min/max with CULL_MARGIN=40
4. **Edge LOD check** -- if `zoomK < 0.2`, batch all edges into single beginPath/stroke at alpha 0.06
5. **Draw individual edges** (skip if LOD overlay) -- per-edge viewport culling, highlight-aware coloring: connected edges get accent color + HIGHLIGHT_EDGE_WIDTH, dimmed edges get DIM_ALPHA, normal edges get 0.4 alpha
6. **Determine LOD level** -- `isLowDetail = zoomLevel < 0.4`, `showLabelsAtZoom = zoomLevel >= 1.0`
7. **Draw nodes** -- per-node viewport culling, then for each visible node:
   - If `isLowDetail`: simple fillRect, continue
   - If not dimmed and not skipAmbientSprites: draw glow sprite at 0.6 alpha
   - If focused/connected and not reducedMotion: real-time shadowBlur (14 or 16)
   - Draw node circle with artifact color and signal opacity (dimmed to DIM_ALPHA if not in connectedSet)
   - If selected: outer ring at +4px offset, accent color, 0.4 alpha
   - Reset shadow
   - If label should show (focused/hovered/connected AND showLabelsAtZoom): draw title above node
8. **Frame budget** -- measure duration, warn if >16ms, return duration

- [ ] **Step 2: Run typecheck + all tests**

**V&C:**
Commit: `feat: enhance GraphRenderer with glow sprites, dimming, edge brightening, viewport culling, LOD, frame budget, edge overlay`

---

### Task 33: Create useGraphAnimation hook (enter/exit transitions, rename detection, rAF batching)

**Files:**
- Create: `src/renderer/src/panels/graph/useGraphAnimation.ts`
- Test: `tests/graph/useGraphAnimation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/useGraphAnimation.test.ts
import { describe, it, expect } from 'vitest'
import { diffNodes, detectRenames } from '../../src/renderer/src/panels/graph/useGraphAnimation'
import type { SimNode } from '../../src/renderer/src/panels/graph/GraphRenderer'

function makeNode(id: string, title: string = id, x: number = 0, y: number = 0): SimNode {
  return { id, title, type: 'note', signal: 'untested', connectionCount: 0, x, y }
}
```

Tests:

**diffNodes:**
- `detects added nodes`
- `detects removed nodes`
- `handles empty arrays`
- `detects simultaneous adds and removes`

**detectRenames:**
- `matches a remove+add with the same id as a rename`
- `returns empty when no matching IDs`
- `handles multiple renames`

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement the hook**

```typescript
// src/renderer/src/panels/graph/useGraphAnimation.ts
import { useRef, useCallback, useEffect } from 'react'
import type { SimNode } from './GraphRenderer'

export interface NodeDiff {
  added: readonly SimNode[]
  removed: readonly SimNode[]
  kept: readonly SimNode[]
}

export interface RenameEntry {
  id: string
  oldX: number
  oldY: number
}

export interface AnimatingNode {
  id: string
  progress: number    // 0 to 1
  type: 'enter' | 'exit'
  startTime: number
}

const ENTER_DURATION = 400
const EXIT_DURATION = 200
const REHEAT_ALPHA = 0.3
```

**Pure functions** (exported for testing):

- `diffNodes(prev, next): NodeDiff` -- set-based diff on node IDs
- `detectRenames(removed, added): readonly RenameEntry[]` -- matching IDs between removed/added lists, captures old position

**Hook** `useGraphAnimation(onRestart: (alpha: number) => void, reducedMotion: boolean)`:

Internal state:
- `batchRef`: `{ enterNodes: Map<string, AnimatingNode>, exitNodes: Map<string, AnimatingNode> }`
- `pendingChangesRef`: accumulates add/remove changes
- `rafIdRef`: coalesces flush to single rAF

Behavior:
- `queueEnter(nodes)` / `queueExit(nodes)`: push to pendingChangesRef, schedule flush via rAF
- `flushPendingChanges`: processes pending changes into enter/exit maps (skipped if reducedMotion), calls `onRestart(REHEAT_ALPHA)` for gentle reheat
- `getNodeTransition(nodeId, now): { opacity: number; scale: number }` -- returns interpolated values for enter (400ms ease-out cubic, scale 0.5->1) or exit (200ms, scale 1->0.5, opacity 1->0). Cleans up completed animations. Returns `{ opacity: 1, scale: 1 }` for non-animating nodes.
- `hasActiveAnimations(): boolean` -- checks both maps

Returns: `{ queueEnter, queueExit, getNodeTransition, hasActiveAnimations, diffNodes, detectRenames }`

**V&C:**
Run tests. Commit: `feat: add useGraphAnimation hook with enter/exit transitions, rename detection, rAF batching`

---

### Task 34: Create SkillsPanel

**Files:**
- Create: `src/renderer/src/panels/skills/SkillsPanel.tsx`
- Modify: `src/main/ipc/filesystem.ts` (register `vault:list-commands` and `vault:read-file` handlers)
- Modify: `src/preload/index.ts` (add `listCommands`, `readFile`, and `deleteFile` to the `vault` namespace)
- Modify: `src/preload/api.d.ts` (declare the new vault methods on `window.api`)

> **Note**: This task adds two new IPC handlers to `src/main/ipc/filesystem.ts`: `vault:list-commands` (lists `.md` files in a directory) and `vault:read-file` (reads a file's UTF-8 content). These are exposed as `window.api.vault.listCommands()` and `window.api.vault.readFile()` via the preload. A `deleteFile` method is also added to the `vault` namespace (delegating to the existing `fs:delete-file` handler) for use by Task 40's `GraphContextMenu`.

- [ ] **Step 1: Register IPC handlers and preload API**

Add to `src/main/ipc/filesystem.ts` (alongside the existing `fs:*` handlers):

```typescript
ipcMain.handle('vault:list-commands', async (_event, dirPath: string): Promise<string[]> => {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(dirPath)
    return entries.filter((f) => f.endsWith('.md')).map((f) => `${dirPath}/${f}`)
  } catch {
    return []
  }
})

ipcMain.handle('vault:read-file', async (_event, filePath: string): Promise<string> => {
  const { readFile } = await import('node:fs/promises')
  return readFile(filePath, 'utf-8')
})
```

Add to the `vault` namespace in `src/preload/index.ts` (inside the existing `api.vault` object):

```typescript
listCommands: (dirPath: string): Promise<string[]> =>
  ipcRenderer.invoke('vault:list-commands', dirPath),
readFile: (filePath: string): Promise<string> =>
  ipcRenderer.invoke('vault:read-file', filePath),
deleteFile: (filePath: string): Promise<void> =>
  ipcRenderer.invoke('fs:delete-file', { path: filePath }),
```

> **Note**: `deleteFile` delegates to the existing `fs:delete-file` IPC handler. No main-process change needed. Types in `api.d.ts` are inferred automatically from the preload methods.

- [ ] **Step 2: Implement the SkillsPanel**

Component: `src/renderer/src/panels/skills/SkillsPanel.tsx`

**Interfaces:**
```typescript
interface SkillEntry {
  name: string
  description: string
  path: string
}
```

**`parseSkillDescription(content: string): string`:** Scans lines for first meaningful content (skipping `#` headings, `---`). Returns up to 120 chars, or `'No description'`.

**`EmptyState` component:** Centered message explaining `.claude/commands/` directory with code snippets styled in `colors.bg.elevated` / `colors.accent.default`.

**`SkillCard` component:** Flex row with name (truncated, `colors.text.primary`), description (truncated, `colors.text.muted`), and a "Run" button that appears on group hover. Styled with `colors.bg.surface` background, `colors.border.default` border.

**`SkillsPanel` component:**
- Reads `vaultPath` from `useVaultStore`
- Effect loads skills: calls `window.api.vault.listCommands(${vaultPath}/.claude/commands)`, then `window.api.vault.readFile` for each file, parses descriptions, sorts alphabetically. Uses cancellation flag for cleanup.
- `handleRun`: dispatches `CustomEvent('run-skill', { detail: { command: skill.name, path: skill.path } })` for TerminalPanel to listen for
- Renders: loading state, empty state (no skills), or header ("Skills (N)") + scrollable list of SkillCards

- [ ] **Step 3: Run typecheck**

**V&C:**
Commit: `feat: add SkillsPanel with vault IPC for reading .claude/commands/`

---

### Task 35: Refactor GraphControls to Graph/Skills toggle and update graph-store

> **Key change**: This task adds `'skills'` to the `ContentView` type in graph-store.

**Files:**
- Modify: `src/renderer/src/store/graph-store.ts`
- Modify: `src/renderer/src/panels/graph/GraphControls.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Update graph-store ContentView union**

Add `'skills'` to the `ContentView` type:

```typescript
type ContentView = 'editor' | 'graph' | 'skills'
```

No other changes to graph-store. All existing fields (`selectedNodeId`, `hoveredNodeId`, `typeFilters`, `signalFilter`) and actions remain unchanged.

- [ ] **Step 2: Refactor GraphControls to Graph/Skills pill toggle**

Replace the entire GraphControls component. Remove the Editor button, replace with Skills. Only renders when `contentView !== 'editor'`:

```typescript
export function GraphControls() {
  const { contentView, setContentView } = useGraphStore()
  if (contentView === 'editor') return null
  // Pill toggle with Graph and Skills buttons
  // Active: backgroundColor = colors.accent.muted, color = colors.text.primary
  // Inactive: transparent bg, color = colors.text.muted
}
```

Container: absolute positioned `top-3 left-1/2 -translate-x-1/2`, z-10. Inner pill: `colors.bg.surface` bg, `colors.border.default` border, `rounded-lg`.

- [ ] **Step 3: Update App.tsx ContentArea to render SkillsPanel and update command palette entry**

Import `SkillsPanel` and update ContentArea to handle three-way content view:

```typescript
{contentView === 'graph' && <GraphPanel onNodeClick={handleNodeClick} />}
{contentView === 'editor' && <EditorPanel onNavigate={handleNavigate} />}
{contentView === 'skills' && <SkillsPanel />}
```

Update `BUILT_IN_COMMANDS`: change `cmd:toggle-view` label to `'Cycle View'`.

Update `toggleView` callback in `WorkspaceShell` to cycle: `editor -> graph -> skills -> graph`:

```typescript
const toggleView = useCallback(() => {
  if (contentView === 'editor') setContentView('graph')
  else if (contentView === 'graph') setContentView('skills')
  else setContentView('graph')
}, [contentView, setContentView])
```

**V&C:**
Run typecheck, tests. Commit: `feat: refactor content view to graph/skills toggle, add skills to ContentArea`

---

### Task 36: Update useKeyboard with Cmd+G cycle logic

**Files:**
- Modify: `src/renderer/src/hooks/useKeyboard.ts`

- [ ] **Step 1: Rename callback from `onToggleView` to `onCycleView`**

The cycle logic lives in `WorkspaceShell`'s `toggleView` callback (updated in Task 35). The hook delegates to it. This task renames the callback for clarity:

In `KeyboardConfig` interface: `onCycleView?: () => void`

In `META_KEY_BINDINGS` array: `{ key: 'g', handler: 'onCycleView' }`

- [ ] **Step 2: Update the consumer in App.tsx WorkspaceShell**

```typescript
useKeyboard({
  onCommandPalette: () => setPaletteOpen(true),
  onCycleView: toggleView,
  onToggleSourceMode: toggleSourceMode,
  onEscape: () => setPaletteOpen(false)
})
```

**V&C:**
Run typecheck, tests. Commit: `refactor: rename onToggleView to onCycleView in useKeyboard for graph/skills cycle`

---

### Task 37: Add node sizing modes to GraphSettingsPanel and GraphRenderer

**Files:**
- Modify: `src/renderer/src/store/graph-settings-store.ts`
- Modify: `src/renderer/src/panels/graph/GraphSettingsPanel.tsx`

- [ ] **Step 1: Verify graph-settings-store exports NodeSizeMode**

Task 23 established `groups`, `GroupConfig`, `setGroupVisible`, `setGroupColor`, `persist` middleware, and `vaultStorage`. All must be preserved. This step ONLY adds the `export` keyword:

```typescript
// Change:  type NodeSizeMode = 'degree' | 'uniform' | 'content'
// To:
export type NodeSizeMode = 'degree' | 'uniform' | 'content'
```

- [ ] **Step 2: Add Node Size Mode dropdown to GraphSettingsPanel**

Import `type NodeSizeMode` from the store. Add selector for `nodeSizeMode`, `setNodeSizeMode`.

Add dropdown in the Display section (above the existing node size slider):

```typescript
<select value={nodeSizeMode} onChange={(e) => setNodeSizeMode(e.target.value as NodeSizeMode)}>
  <option value="degree">Degree (connections)</option>
  <option value="uniform">Uniform</option>
  <option value="content">Content length</option>
</select>
```

Styled: `colors.bg.elevated` bg, `colors.text.primary` text, `colors.border.default` border.

**V&C:**
Run typecheck. Commit: `feat: add node size mode dropdown to graph settings (degree, uniform, content)`

---

### Task 38: Create GraphRendererInterface abstraction

**Files:**
- Create: `src/renderer/src/panels/graph/GraphRendererInterface.ts`

- [ ] **Step 1: Implement the pluggable renderer interface**

```typescript
// src/renderer/src/panels/graph/GraphRendererInterface.ts
import type { SimNode, SimEdge, NodeSizeConfig } from './GraphRenderer'
import { renderGraph, findNodeAt } from './GraphRenderer'
import type { HighlightState } from './useGraphHighlight'

export interface GraphRendererInterface {
  render(params: RenderParams): void
  hitTest(nodes: readonly SimNode[], x: number, y: number): SimNode | null
  resize(width: number, height: number, dpr: number): void
  dispose(): void
}

export interface RenderParams {
  ctx: CanvasRenderingContext2D
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  width: number
  height: number
  selectedId: string | null
  hoveredId: string | null
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
}
```

**`Canvas2DGraphRenderer` class** implements `GraphRendererInterface`:
- `render(params)`: delegates to `renderGraph(params.ctx, params.nodes, params.edges, params.width, params.height, params.selectedId, params.hoveredId, { highlight, sizeConfig, transform, canvasWidth, canvasHeight, reducedMotion })`
- `hitTest(nodes, x, y)`: delegates to `findNodeAt(nodes, x, y)`
- `resize(width, height, dpr)`: stores dimensions internally
- `dispose()`: no-op (Canvas2D has no GPU resources; GlowSpriteCache is module-scoped)

**V&C:**
Run typecheck. Commit: `feat: add GraphRendererInterface abstraction for pluggable graph renderers`

---

### Task 39: Create GraphMinimap component

**Files:**
- Create: `src/renderer/src/panels/graph/GraphMinimap.tsx`

- [ ] **Step 1: Implement the minimap**

```typescript
// src/renderer/src/panels/graph/GraphMinimap.tsx
import { useRef, useEffect, useCallback } from 'react'
import type { SimNode, SimEdge } from './GraphRenderer'
import { ARTIFACT_COLORS, colors } from '../../design/tokens'

interface GraphMinimapProps {
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  onPan: (x: number, y: number) => void
}

const MINIMAP_WIDTH = 120
const MINIMAP_HEIGHT = 80
const MINIMAP_PADDING = 8
const NODE_DOT_SIZE = 2
const VIEWPORT_RECT_COLOR = 'rgba(108, 99, 255, 0.5)'
const VIEWPORT_RECT_BORDER = 'rgba(108, 99, 255, 0.8)'
const MINIMAP_BG = 'rgba(17, 17, 19, 0.85)'
```

**`computeGraphBounds(nodes): { minX, minY, maxX, maxY }`:** Scans all nodes for min/max coordinates, adds 10% padding. Returns `{ 0, 0, 100, 100 }` for empty arrays.

**`GraphMinimap` component:**

Rendering (via `renderMinimap` callback, called in effect on prop changes):
1. Set up canvas at `MINIMAP_WIDTH x MINIMAP_HEIGHT` with DPR scaling
2. Fill background with `MINIMAP_BG`, stroke border
3. Compute graph bounds and scale factor to fit minimap with padding
4. Draw edges as faint lines (alpha 0.15, lineWidth 0.5)
5. Draw nodes as colored dots (`fillRect`, alpha 0.7, `NODE_DOT_SIZE`)
6. Compute viewport rectangle from transform and draw filled (alpha 0.15) + stroked

Click handler: converts minimap click coordinates back to graph-space using the same bounds/scale math, calls `onPan(graphX, graphY)`.

Positioned: `absolute bottom-3 left-3`, cursor-crosshair, rounded, z-10.

**V&C:**
Run typecheck. Commit: `feat: add GraphMinimap component with thumbnail rendering and click-to-pan`

---

### Task 40: Create GraphContextMenu component

> **Correction**: `VaultFile` has no `id` field. Use `fileToId` map from vault-store to resolve `nodeId` to file path. Also, `deleteFile` call must be awaited.

**Files:**
- Create: `src/renderer/src/panels/graph/GraphContextMenu.tsx`
- Test: `tests/graph/GraphContextMenu.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/graph/GraphContextMenu.test.ts
import { describe, it, expect } from 'vitest'
import { CONTEXT_MENU_ITEMS } from '../../src/renderer/src/panels/graph/GraphContextMenu'
```

Tests:
- `has exactly 4 menu items`
- `marks only Delete as dangerous`
- `has unique action identifiers`
- `has non-empty labels for all items`

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement the GraphContextMenu component**

```typescript
// src/renderer/src/panels/graph/GraphContextMenu.tsx
import { useEffect, useRef, useCallback, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { colors } from '../../design/tokens'

interface GraphContextMenuProps {
  x: number
  y: number
  nodeId: string
  onClose: () => void
  onOpenInEditor: (id: string) => void
}

export interface ContextMenuItem {
  label: string
  action: string
  dangerous?: boolean
}

export const CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { label: 'Open in editor', action: 'open' },
  { label: 'Reveal in sidebar', action: 'reveal' },
  { label: 'Copy file path', action: 'copy-path' },
  { label: 'Delete', action: 'delete', dangerous: true },
]
```

**File path resolution** (corrected -- VaultFile has no `id` field):
```typescript
// Use fileToId map (inverted) to find file path from nodeId
const fileToId = useVaultStore((s) => s.fileToId)
const filePath = Object.entries(fileToId).find(([, id]) => id === nodeId)?.[0] ?? null
```

**Behavior:**
- Click outside listener (deferred via `setTimeout(0)` to avoid triggering on the opening right-click)
- Escape key listener
- `handleAction(action)`:
  - `'open'`: calls `onOpenInEditor(nodeId)`
  - `'reveal'`: dispatches `CustomEvent('reveal-in-sidebar', { detail: { nodeId } })`, then `onClose()`
  - `'copy-path'`: `navigator.clipboard.writeText(filePath)`, then `onClose()`
  - `'delete'`: sets `showConfirm = true` (does not close yet)
- `handleConfirmDelete` (corrected -- await the deleteFile call):
  ```typescript
  const handleConfirmDelete = useCallback(async () => {
    if (filePath) {
      await window.api.vault.deleteFile(filePath)
    }
    onClose()
  }, [filePath, onClose])
  ```

**Rendering:**
- Fixed positioned at `(x, y)`, z-50, `min-w-[180px]`, `colors.bg.elevated` bg, `colors.border.default` border
- Normal mode: maps CONTEXT_MENU_ITEMS to buttons with hover highlight. Delete items styled red (`#EF4444`).
- Confirm mode (showConfirm): "Delete this note? This cannot be undone." with Cancel and Delete buttons

**V&C:**
Run typecheck, tests. Commit: `feat: add GraphContextMenu with open, reveal, copy path, and delete actions`

---

### Task 41: Integrate highlights, animation, minimap, and loading into GraphPanel

> **Correction**: `d3-transition` is NOT installed. The minimap pan handler must NOT use `.transition().duration(300)`. Use immediate transform: `select(canvas).call(zoomBehavior.transform, newTransform)`.

**Files:**
- Modify: `src/renderer/src/panels/graph/GraphPanel.tsx`

- [ ] **Step 1: Rewrite GraphPanel with full Phase 3 integration**

Replace the entire file. Integrates: `useGraphHighlight`, `useGraphAnimation`, `GraphMinimap`, enhanced `renderGraph` with options, double-click to open editor, right-click context menu, loading skeleton, `prefers-reduced-motion`.

**Imports:**
```typescript
import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { select } from 'd3-selection'
import { useVaultStore } from '../../store/vault-store'
import { useGraphStore } from '../../store/graph-store'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import { createSimulation, renderGraph, findNodeAt, type SimNode, type SimEdge, type NodeSizeConfig } from './GraphRenderer'
import { useGraphHighlight, type HighlightState } from './useGraphHighlight'
import { useGraphAnimation } from './useGraphAnimation'
import { GraphMinimap } from './GraphMinimap'
import { GraphContextMenu } from './GraphContextMenu'
import { colors } from '../../design/tokens'
```

**`useReducedMotion(): boolean`:** Listens to `window.matchMedia('(prefers-reduced-motion: reduce)')` changes.

**`LoadingSkeleton` component:** Three pulsing dots with staggered animation delays (0ms, 200ms, 400ms), `colors.accent.default`, centered absolutely.

**`GraphPanel({ onNodeClick }: { onNodeClick: (id: string) => void })`:**

**Refs:**
- `canvasRef`, `simRef`, `nodesRef`, `edgesRef`, `transformRef`, `zoomBehaviorRef`, `prevNodesRef`
- `skipSpritesRef` for adaptive quality

**Store selectors:**
- `graph` from vault-store
- `selectedNodeId`, `hoveredNodeId`, `setSelectedNode`, `setHoveredNode`, `setContentView` from graph-store
- `baseNodeSize`, `nodeSizeMode`, `showMinimap` from graph-settings-store

**Hooks:**
- `sizeConfig = useMemo<NodeSizeConfig>(() => ({ mode: nodeSizeMode, baseSize: baseNodeSize }), [...])`
- `highlightHook = useGraphHighlight(edgesRef.current)`
- `animation = useGraphAnimation(handleSimRestart, reducedMotion)`

**`render` callback:**
1. Save context, clear, apply transform (translate + scale)
2. Call `renderGraph(ctx, nodes, edges, ...)` with full options including `highlight`, `sizeConfig`, `transform`, `skipAmbientSprites`
3. Restore context
4. Adaptive quality: set `skipSpritesRef.current = frameDuration > 16`
5. If active animations, schedule next rAF

**Graph data pipeline effect** (on `graph` change):
1. Map graph.nodes to SimNode[] with random initial positions
2. Diff against `prevNodesRef.current` via `animation.diffNodes`
3. Detect renames, preserve positions for renamed nodes
4. Queue enter (truly new, not renames) and exit (truly removed, not renames) animations
5. Create simulation, listen to `tick` for render. Set `isSimulating = false` when `alpha < 0.1` (not at `'end'`)
6. Setup zoom behavior: `zoom().scaleExtent([0.1, 4])`, store transform on zoom event
7. Cleanup: stop sim, remove zoom listener

**Mouse handler pattern** (all 4 follow same structure):
1. Get canvas, compute bounding rect
2. Convert client coords to graph-space: `x = (clientX - rect.left - t.x) / t.k`
3. Hit-test via `findNodeAt(nodesRef.current, x, y)`
4. Dispatch to appropriate handler

Handlers:
- **mousemove**: `highlightHook.handleHover(node?.id ?? null)`, set cursor
- **click**: clear context menu, `highlightHook.handleClick(node?.id ?? null)`, `onNodeClick` if node
- **dblclick**: `highlightHook.handleDoubleClick(node.id)`, `setContentView('editor')`, `onNodeClick`
- **contextmenu**: `e.preventDefault()`, set context menu state `{ x: e.clientX, y: e.clientY, nodeId }` or clear

**Minimap pan handler** (corrected -- no d3-transition):
```typescript
const handleMinimapPan = useCallback((graphX: number, graphY: number) => {
  const canvas = canvasRef.current
  const zb = zoomBehaviorRef.current
  if (!canvas || !zb) return

  const t = transformRef.current
  const canvasW = canvas.width / window.devicePixelRatio
  const canvasH = canvas.height / window.devicePixelRatio

  const newX = canvasW / 2 - graphX * t.k
  const newY = canvasH / 2 - graphY * t.k

  const newTransform = zoomIdentity.translate(newX, newY).scale(t.k)
  select(canvas).call(zb.transform, newTransform)
}, [])
```

**Resize observer effect:** Observes canvas, updates `width`/`height` with DPR, re-renders.

**JSX structure:**
```
<div className="h-full relative" style={{ backgroundColor: colors.bg.base }}>
  <canvas ... onMouseMove onDoubleClick onClick onContextMenu />
  {isSimulating && !isEmpty && <LoadingSkeleton />}
  {isEmpty && <EmptyState message />}
  {showMinimap && !isEmpty && <GraphMinimap ... onPan={handleMinimapPan} />}
  {contextMenu && <GraphContextMenu ... onClose onOpenInEditor />}
</div>
```

**V&C:**
Run typecheck, tests. Commit: `feat: integrate highlights, animation, minimap, context menu, and loading into GraphPanel`

---
