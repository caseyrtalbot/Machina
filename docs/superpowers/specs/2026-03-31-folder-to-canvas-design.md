# Folder-to-Canvas Mapping & Agent Spatial Editing

## Summary

Map a selected folder's structure and file relationships onto the canvas as positioned cards with typed edges. Users (and later agents) can analyze a folder, preview the result as lightweight geometry, and apply it as one undoable batch. Canvas-only output in v1: no vault ontology writes, no frontmatter injection.

## Architecture

The project-map pipeline is separate from VaultIndex/KnowledgeGraph. It produces a `ProjectMapSnapshot` (nodes + edges + metadata) that converts to canvas geometry through a tree layout module.

```
Sidebar / CommandPalette
       |
       v
  Renderer orchestrator
       |
       +-- window.api.fs.listAllFiles(root) --> Main (PathGuard + seenDirs)
       |   <-- FilesystemFileEntry[]
       |
       +-- chunk paths into batches of 50
       |   for each chunk:
       |     window.api.fs.readFilesBatch(paths) --> Main (p-limit(8), 15s timeout)
       |     <-- Array<{path, content}>
       |     worker.postMessage({ type: 'append-files', operationId, files })
       |
       +-- worker.postMessage({ type: 'finalize', operationId, existingNodes })
       |   worker computes: analysis + tree layout + collision resolution
       |   <-- { type: 'result', operationId, snapshot, nodes, edges }
       |
       +-- orchestrator builds CanvasMutationPlan from worker output
       |   --> preview layer renders lightweight rects
       |   --> user clicks Apply or Cancel
       |   --> on Apply: CommandStack.execute() + flushCanvasSave()
```

### Process Boundaries

- **Main process**: File I/O only (guarded listing, chunked reads). No analysis.
- **Renderer main thread**: Orchestration, preview rendering, store mutations. No heavy computation.
- **Renderer Web Worker**: All analysis (import extraction, relation building, tree layout, collision resolution).

This matches the existing vault-worker pattern where heavy parsing runs off the renderer main thread.

## Existing Patterns Reused

| Pattern | File | What It Proves |
|---|---|---|
| Graph-to-canvas conversion | `import-logic.ts:graphToCanvas()` | Grid layout, edge mapping, origin offset, viewport fitting |
| Connection expansion | `show-connections.ts:computeShowConnections()` | Pure function returns `{newNodes, newEdges}`, caller commits |
| Force-directed placement | `canvas-layout.ts:computeForceLayout()` | D3 force sim, collision avoidance |
| Vault worker streaming | `vault-worker.ts` | `load`/`append`/`update`/`remove` message protocol |
| Undo/redo | `canvas-commands.ts:CommandStack` | execute/undo wrapping, Cmd+Z/Shift+Z |
| File type classification | `file-drop-utils.ts:inferCardType()` | Extension-based card type inference |
| MCP optimistic locking | `mcp-server.ts:vault.write_file` | `expectedMtime` pattern for conflict detection |
| Pending-write suppression | `document-manager.ts:_pendingWrites` | Set + 2s timeout, echo suppression |
| Canvas autosave | `canvas-autosave.ts` | 2s debounce, `flushCanvasSave()`, `performSave()` |
| Viewport culling + LOD | `use-canvas-culling.ts`, `use-canvas-lod.ts` | Only visible nodes render, zoom-based LOD tiers |
| Edge hidden/visible toggle | `EdgeLayer.tsx` | `edge.hidden` + endpoint hover/select reveal |
| Bounded I/O with symlink safety | `file-service.ts:listAllFilesRecursive` | `realpath()` + `seenDirs` Set, gitignore filter |

## Slice Organization

Four slices, with Slice 1 sub-phased for reviewability:

```
Slice 1: Worker-Backed Folder Analysis (sub-phased)
  1A: Shared types + pure analyzers + unit tests
  1B: Tree layout module + unit tests
  1C: Worker + batch IPC + integration tests
  1D: Canvas model extensions + folder card + edge styling + entry points
  Quality gate: npm run typecheck + targeted vitest

Slice 2: Canvas Preview/Apply
  Mutation types, lightweight SVG preview, confirmation bar,
  pending-apply safety, budget-aware apply, undo integration
  Quality gate: npm run typecheck + npm test

Slice 3: Agent Canvas Planning
  IPC snapshot/apply surface, validation, MCP mirrors with HITL gate
  Quality gate: npm run typecheck + npm test

Slice 4: Semantic Enrichment (deferred, not specified)
```

## Ground Rules

- Canvas-only output in v1. No auto-writing vault ontology files or frontmatter.
- Agent changes are preview/apply only. No raw `.canvas` writes.
- Map one selected folder at a time. Vault root is the default target.
- Reuse existing repo patterns for workers, culling, LOD, file scanning, timeouts, and pending-write safety.
- Build test-first for all pure logic and protocol surfaces.
- Keep each sub-phase reviewable and independently verifiable.
- Do not add MCP until worker build is stable, preview/apply is stable, and rollback is tested.

---

## Slice 1: Worker-Backed Folder Analysis

### 1A. Project-Map Model (`src/shared/engine/project-map-types.ts`, ~90 lines)

Pure types, zero dependencies. Shared across main, renderer, and worker.

```typescript
// Edge kinds for the project-map domain (uses canvas-types string escape hatch at runtime)
type ProjectMapEdgeKind = 'contains' | 'imports' | 'references'

interface ProjectMapNode {
  readonly id: string                    // stable: deterministic hash of rootPath + relativePath
  readonly relativePath: string
  readonly name: string
  readonly isDirectory: boolean
  readonly nodeType: CanvasNodeType      // inferred from extension
  readonly depth: number
  readonly lineCount: number
  readonly children: readonly string[]   // IDs of direct children (dirs only)
  readonly childCount: number            // total descendant count (for collapsed badge)
  readonly error?: string                // set if read/parse failed for this file
}

interface ProjectMapEdge {
  readonly source: string                // node ID
  readonly target: string                // node ID
  readonly kind: ProjectMapEdgeKind
}

interface ProjectMapSnapshot {
  readonly rootPath: string
  readonly nodes: readonly ProjectMapNode[]
  readonly edges: readonly ProjectMapEdge[]
  readonly truncated: boolean            // true if maxNodes was hit
  readonly totalFileCount: number        // before truncation
  readonly skippedCount: number          // binary + error files
  readonly unresolvedRefs: readonly string[]
}

interface ProjectMapOptions {
  readonly expandDepth: number           // default: 2
  readonly maxNodes: number              // default: 200
}
```

Edge kind strategy: define `ProjectMapEdgeKind` as a typed alias in project-map-types for documentation and autocomplete. At the canvas level, these flow through the existing `(string & {})` escape hatch on `CanvasEdge.kind` (line 80, canvas-types.ts). This avoids modifying the `CanvasEdgeKind` union or `CANVAS_EDGE_KINDS` Set, keeping project-map concepts out of the core canvas type system.

### 1A (continued). Project-Map Analyzers (`src/shared/engine/project-map-analyzers.ts`, ~250 lines)

Pure functions, zero dependencies. Import extraction uses regex to collect raw specifier strings; path resolution is deterministic and centralized.

V1 analyzers (deterministic only):

| Analyzer | File Types | Extracts |
|---|---|---|
| Folder containment | all | parent-child `contains` edges |
| ES/CJS imports | .ts, .tsx, .js, .jsx | `import from`, `require()`, `import()`, `export {} from` -> `imports` edges |
| Wikilinks | .md | `[[target]]` -> `references` edges |
| Relative links | .md | `[text](./path)` -> `references` edges |
| JSON/YAML/TOML refs | .json, .yaml, .yml, .toml | Local path string values -> `references` edges (only when resolved) |
| Generic text | all other text | Node only, no inferred semantic edges |

Binary assets are skipped and surfaced as counts on their parent folder node, not canvas cards.

Deterministic resolution rules:

```typescript
function resolveImportPath(
  specifier: string,
  importingFile: string,
  allFilePaths: ReadonlySet<string>,
  rootPath: string
): string | null
```

1. Skip non-relative: only resolve specifiers beginning with `./` or `../`. Skip bare package specifiers, URLs, aliases, unresolved dynamic imports.
2. Normalize: `path.resolve(path.dirname(importingFile), specifier)` -> canonical path.
3. Boundary check: result must be inside `rootPath`. Reject otherwise.
4. Explicit extension: if specifier has an extension, resolve the exact normalized path. Keep only if it exists in `allFilePaths`.
5. Extensionless resolution (in order): exact file, then `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.md`. First match wins.
6. Directory resolution: if target resolves to a directory, try (in order): `index.ts`, `index.tsx`, `index.js`, `index.jsx`, `index.mjs`, `index.cjs`, `index.json`, `index.md`. First match wins.
7. JSON/YAML/TOML: string values only become `references` edges when they resolve to an existing in-root relative path.
8. Markdown: `[[wikilinks]]` and `[text](./path)` produce `references` edges only when they resolve to in-root files. Non-resolving links reported in `unresolvedRefs`.

Tests for 1A:
- Relative imports resolve correctly
- Extensionless resolution tries extensions in order
- Index-file resolution for directory imports
- Bare specifiers (`lodash`, `react`) skipped
- Markdown wikilinks and relative links
- JSON path references (resolved vs unresolved)
- Binary-file skipping
- Boundary check: import resolving outside root rejected
- Unresolved refs reported, not silently connected

Exit criteria: pure logic is fully covered by tests. No canvas UI or IPC changes yet.

### 1B. Tree Layout Module (`src/renderer/src/panels/canvas/folder-map-layout.ts`, ~280 lines)

Pure functions. Imported by both the worker (for computation) and tests (for verification).

```typescript
interface TreeLayoutOptions {
  readonly levelGap: number      // vertical space between depth levels (default: 200)
  readonly siblingGap: number    // horizontal space between siblings (default: 40)
  readonly clusterGap: number    // space between directory clusters (default: 120)
}

interface FolderMapLayoutResult {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

function computeFolderMapLayout(
  snapshot: ProjectMapSnapshot,
  origin: { x: number; y: number },
  existingNodes: readonly CanvasNode[],
  options?: Partial<TreeLayoutOptions>
): FolderMapLayoutResult
```

Algorithm: variable-size Reingold-Tilford tree.

1. Build tree from `snapshot.nodes` containment edges. Root = selected folder.
2. Assign sizes: `project-folder` = 260x80, files = type-appropriate via `getDefaultSize()`.
3. Bottom-up pass: compute subtree widths (`max(own width, sum(children widths) + gaps)`).
4. Top-down pass: assign x positions centering parents over children.
5. Y positions by depth level with `levelGap` separation.
6. Create `CanvasNode` per file:
   - `.md` -> `'note'`, content = absolute path
   - Code files -> `'project-file'`, metadata = `{ relativePath, language, folderMapRoot }`
   - Dirs -> `'project-folder'`, metadata = `{ relativePath, rootPath, childCount, collapsed: depth > expandDepth }`
   - Images -> `'image'`, metadata = `{ src: absolutePath }`
7. Collision resolution: scan existing canvas nodes, shift tree origin to avoid overlap. Use `computeOriginOffset()` pattern from `import-logic.ts`.
8. Create edges: `contains` (parent->child), `imports`, `references`. Use `computeOptimalEdgeSides()` from `canvas-layout.ts`.
9. Cross-link routing: `imports`/`references` edges computed after tree positions are finalized.

Tests for 1B:
- Tree positions are deterministic for same input
- Collision resolution shifts tree away from existing nodes
- Edge sides computed correctly
- Depth truncation respects `expandDepth`
- Large tree (200 nodes) completes without timeout

Exit criteria: layout module produces correct `CanvasNode[]` + `CanvasEdge[]` from any `ProjectMapSnapshot`.

### 1C. Worker + Batch IPC

**Project-Map Worker** (`src/renderer/src/workers/project-map-worker.ts`, ~200 lines)

Renderer Web Worker following the vault-worker pattern of union-typed messages.

Inbound messages:

```typescript
type ProjectMapWorkerIn =
  | { type: 'start'; operationId: string; rootPath: string; options: ProjectMapOptions }
  | { type: 'append-files'; operationId: string; files: Array<{ path: string; content: string }> }
  | { type: 'finalize'; operationId: string; existingNodes: readonly CanvasNode[] }
  | { type: 'cancel'; operationId: string }
```

Outbound messages:

```typescript
type ProjectMapWorkerOut =
  | { type: 'progress'; operationId: string; phase: 'analyzing' | 'laying-out'; filesProcessed: number; totalFiles: number }
  | { type: 'result'; operationId: string; snapshot: ProjectMapSnapshot; nodes: CanvasNode[]; edges: CanvasEdge[] }
  | { type: 'error'; operationId: string; message: string }
```

Worker lifecycle:
1. `start`: initialize new operation, clear prior state, store `operationId`.
2. `append-files`: buffer incoming file chunks, run analyzers. Post `progress` messages. Late messages with wrong `operationId` are silently ignored.
3. `finalize`: receive existing canvas nodes for collision avoidance. Build full `ProjectMapSnapshot`, run tree layout, return positioned nodes + edges.
4. `cancel`: clear state. In-flight `append-files` for this `operationId` become no-ops.

**Batch File Read IPC** (`fs:read-files-batch`)

New IPC channel. No existing batch read channel exists.

```typescript
// src/shared/ipc-channels.ts
'fs:read-files-batch': {
  request: { paths: readonly string[] }
  response: Array<{ path: string; content: string | null; error?: string }>
}
```

Handler in `src/main/ipc/filesystem.ts`:
- PathGuard validates every path in the batch
- `p-limit(8)` concurrency per batch
- 15s timeout per batch via AbortController
- Returns `null` content + error string for failed reads (partial success)
- Batch size enforced: reject if `paths.length > 50`

Tests for 1C:
- Worker protocol: start, append-files, finalize, cancel
- Stale `operationId` messages silently ignored
- Partial-failure behavior (some files error, others succeed)
- Stable ID generation: same input produces same node IDs
- Large batch (200 files): layout completes
- Batch IPC: PathGuard rejects out-of-vault paths
- Batch IPC: oversized batch (>50) rejected

Exit criteria: a selected folder produces a `ProjectMapSnapshot` and positioned canvas geometry without touching the canvas store.

### 1D. Canvas Model Extensions + UI Wiring

**New node type: `project-folder`**

Add to `CanvasNodeType` union in `canvas-types.ts`:

```typescript
export type CanvasNodeType =
  | 'text' | 'note' | 'terminal' | 'code' | 'markdown'
  | 'image' | 'pdf' | 'project-file' | 'system-artifact'
  | 'file-view' | 'agent-session'
  | 'project-folder'
```

With entries in `MIN_SIZES` (200x60), `DEFAULT_SIZES` (260x80), `CARD_TYPE_INFO`, `getDefaultMetadata()`:

```typescript
'project-folder': {
  label: 'Folder', icon: '\u25A1', category: 'tools'
}
// metadata: { relativePath, rootPath, childCount, expandDepth, collapsed: boolean }
```

Extend `project-file` metadata with optional `folderMapRoot?: string` to distinguish provenance without breaking existing workbench cards.

**Edge rendering rules** (update `EdgeLayer.tsx`):

| Kind | Style | Default Visibility |
|---|---|---|
| `contains` | Solid, subtle gray, thin (1px) | Structural, always visible, low-emphasis |
| `imports` | Dashed, muted blue, 1.5px | Hidden by default. Shown when: toggled on, endpoint selected/hovered, or zoom > 0.8 |
| `references` | Dotted, muted purple, 1.5px | Hidden by default. Same reveal rules as imports |

Add viewport filtering to the edge layer: only render edges where at least one endpoint is within the visible viewport bounds.

**ProjectFolderCard** (`src/renderer/src/panels/canvas/ProjectFolderCard.tsx`, ~120 lines):
- Folder name (bold) + child count badge
- Collapsed state: shows count only, "Expand" button
- Expanded state: normal folder card
- "Expand Folder" action: triggers re-analysis of that subfolder

**Folder-Map Orchestrator** (`src/renderer/src/panels/canvas/folder-map-orchestrator.ts`, ~180 lines):

Chunked reads, worker coordination, operationId cancellation, progress state. In Slice 1, applies directly (no preview layer yet).

```typescript
const CHUNK_SIZE = 50
const allFiles = await window.api.fs.listAllFiles(rootPath)
const textFiles = allFiles.filter(f => isTextExtension(f.path))

worker.postMessage({ type: 'start', operationId, rootPath, options })

for (let i = 0; i < textFiles.length; i += CHUNK_SIZE) {
  if (cancelled) break
  const chunk = textFiles.slice(i, i + CHUNK_SIZE)
  const results = await window.api.fs.readFilesBatch(chunk.map(f => f.path))
  if (operationId !== currentOperationId) break
  worker.postMessage({ type: 'append-files', operationId, files: results })
}

worker.postMessage({ type: 'finalize', operationId, existingNodes })
```

Cancel on folder change, user cancel, or tab exit: set `cancelled = true`, post `cancel` to worker, discard late IPC responses via `operationId` check.

**Progress UX**: expose `{ phase, filesProcessed, totalFiles }` state from the orchestrator for a loading indicator in the UI. Show a spinner/progress bar during analysis. Show error toast on partial failure. Show info toast on empty folder (no analyzable text files).

**Entry points**:

| Entry Point | Location | Action |
|---|---|---|
| Folder context menu | `FileContextMenu.tsx` FOLDER_ACTIONS | "Map to Canvas" |
| Command palette | `CommandPalette.tsx` | "Map Vault Root" |
| Folder card action | `ProjectFolderCard.tsx` | "Expand Folder" button on collapsed nodes |

Exit criteria: end-to-end user flow works from sidebar and command palette. Folder analysis produces positioned cards on canvas.

Quality gate after Slice 1: `npm run typecheck` + targeted vitest subset passes clean.

---

## Slice 2: Canvas Preview/Apply

### 2A. Canvas Mutation Types (`src/shared/canvas-mutation-types.ts`, ~70 lines)

```typescript
type CanvasMutationOp =
  | { readonly type: 'add-node'; readonly node: CanvasNode }
  | { readonly type: 'add-edge'; readonly edge: CanvasEdge }
  | { readonly type: 'move-node'; readonly nodeId: string; readonly position: { x: number; y: number } }
  | { readonly type: 'resize-node'; readonly nodeId: string; readonly size: { width: number; height: number } }
  | { readonly type: 'update-metadata'; readonly nodeId: string; readonly metadata: Partial<Record<string, unknown>> }
  | { readonly type: 'remove-node'; readonly nodeId: string }
  | { readonly type: 'remove-edge'; readonly edgeId: string }

interface CanvasMutationPlan {
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
```

### 2B. Lightweight Preview Layer (`src/renderer/src/panels/canvas/FolderMapPreview.tsx`, ~120 lines)

The preview does NOT render full CardShell components. It renders simple geometry:

- Each `add-node` op renders as a semi-transparent rect (30% opacity, dashed 1px border) with a text label (filename) centered inside.
- Each `add-edge` op renders as a thin line between rect centers (no Bezier, no arrowheads).
- Rects use the same viewport transform as canvas cards (pan/zoom for free).
- No React component per rect: render as a single SVG layer for performance.
- Mount inside `CanvasSurface`, between grid background and card layer.

**Confirmation bar** at bottom: "Map 47 files from `src/components/` -- 3 folders, 44 files, 12 import links. 2 skipped. [Apply] [Cancel]"

### 2C. Pending-Apply Safety (`src/renderer/src/panels/canvas/folder-map-apply.ts`, ~80 lines)

Separated from the orchestrator for single-responsibility. Modeled after `DocumentManager._pendingWrites`.

```typescript
interface PendingApply {
  readonly operationId: string
  readonly canvasPath: string
  readonly expectedMtime: string
  readonly preApplySnapshot: CanvasFile
}
```

Flow:
1. Capture pre-apply snapshot for rollback.
2. Mutate store wrapped in CommandStack for undo.
3. Flush save immediately via `flushCanvasSave()` (don't wait for 2s debounce).
4. On save success: clear pending marker.
5. On save failure: rollback to pre-apply snapshot.
6. On app quit: if `pendingApply` is non-null and save hasn't confirmed, rollback before quit flushes.

### 2D. Budget-Aware Apply

When the user clicks Apply:

1. Auto-fit viewport: if >50 nodes, compute a viewport that frames the entire mapped region using `computeImportViewport()`. Initial paint lands in preview or dot LOD tier.
2. Batch commit: single `addNodesAndEdges()` call, one atomic store mutation.
3. LOD respects scale: cards mount as LOD 2 (skeleton) when viewport zoom is low. Full card components only mount when user zooms in, handled by existing `use-canvas-lod.ts`.
4. Edge visibility: `imports` and `references` edges created with `hidden: true`. Revealed when endpoint hovered/selected, toggled on, or zoom > 0.8.
5. Viewport edge filtering: skip rendering edges where both endpoints are outside visible viewport rect.

### 2E. Undo Integration

Wrap entire folder map commit in a single `CommandStack` command:

```typescript
commandStack.current.execute({
  execute: () => {
    useCanvasStore.getState().addNodesAndEdges(planNodes, planEdges)
  },
  undo: () => {
    const store = useCanvasStore.getState()
    for (const node of planNodes) store.removeNode(node.id)
  }
})
```

Single Cmd+Z undoes the entire folder mapping. Edges auto-removed with their nodes.

Quality gate after Slice 2: `npm run typecheck` + `npm test` passes clean.

---

## Slice 3: Agent Canvas Planning

### 3A. Canvas Snapshot & Plan IPC

Agents do NOT write raw `.canvas` JSON. They read current state, propose `CanvasMutationPlan` operations, and the app applies only after user preview/apply confirmation.

```typescript
// src/shared/ipc-channels.ts

'canvas:get-snapshot': {
  request: { canvasPath: string }
  response: { file: CanvasFile; mtime: string }
}

'canvas:apply-plan': {
  request: {
    canvasPath: string
    expectedMtime: string
    plan: CanvasMutationPlan
  }
  response: { applied: boolean; mtime: string } | { error: 'stale' | 'validation-failed'; message: string }
}
```

The `expectedMtime` pattern matches the existing `vault.write_file` MCP tool. Stale plans are rejected, not merged.

`canvas:apply-plan` routes through the same preview/apply flow as user-initiated mappings.

### 3B. Validation

`canvas:apply-plan` handler validates every op:
- `add-node`: valid `CanvasNodeType`, position within reasonable bounds
- `move-node`/`resize-node`: referenced `nodeId` must exist
- `add-edge`: both endpoints must exist (either existing or in prior `add-node` ops in same plan)
- `update-metadata`: referenced `nodeId` must exist
- `remove-node`/`remove-edge`: referenced ID must exist
- Reject entire plan if any op fails validation (atomic)

### 3C. MCP Mirrors (after IPC stabilizes)

Three MCP tools added to `mcp-server.ts`:

- `project.map_folder`: wraps file listing + batch reads + worker analysis
- `canvas.get_snapshot`: wraps `canvas:get-snapshot` IPC
- `canvas.apply_plan`: wraps `canvas:apply-plan` IPC, requires `ElectronHitlGate`

MCP stays structured and optimistic-locked. Stale plans rejected, not merged.

### 3D. Agent Workflow

```
Agent                        App
  |                           |
  |-- project.map_folder --> | (list files, read chunks, analyze in worker)
  |  <-- ProjectMapSnapshot   | (deterministic relations, no layout)
  |                           |
  |-- canvas.get_snapshot --> | (read current canvas state)
  |  <-- { file, mtime }     |
  |                           |
  |  (agent computes plan)    |
  |                           |
  |-- canvas.apply_plan ----> | (propose mutations with expectedMtime)
  |                           | (HITL gate: user sees lightweight preview)
  |                           | (user clicks Apply or Cancel)
  |  <-- { applied, mtime }   |
```

Quality gate after Slice 3: `npm run typecheck` + `npm test` passes clean.

---

## File Manifest

### New Files

| File | Est. Lines | Layer | Sub-phase | Purpose |
|------|-----------|-------|-----------|---------|
| `src/shared/engine/project-map-types.ts` | ~90 | Shared | 1A | Types: ProjectMapNode, ProjectMapEdge, ProjectMapSnapshot |
| `src/shared/engine/project-map-analyzers.ts` | ~250 | Shared | 1A | Import extraction, wikilink extraction, deterministic resolution |
| `src/renderer/src/panels/canvas/folder-map-layout.ts` | ~280 | Renderer | 1B | Reingold-Tilford tree layout, collision resolution, cross-link routing |
| `src/renderer/src/workers/project-map-worker.ts` | ~200 | Renderer | 1C | Worker: append-files/finalize protocol, analysis + layout |
| `src/renderer/src/panels/canvas/folder-map-orchestrator.ts` | ~180 | Renderer | 1D | Chunked reads, worker coordination, progress state |
| `src/renderer/src/panels/canvas/ProjectFolderCard.tsx` | ~120 | Renderer | 1D | Folder card: name, count badge, expand button |
| `src/shared/canvas-mutation-types.ts` | ~70 | Shared | 2A | CanvasMutationOp, CanvasMutationPlan types |
| `src/renderer/src/panels/canvas/FolderMapPreview.tsx` | ~120 | Renderer | 2B | Lightweight SVG preview layer (rects + labels + lines) |
| `src/renderer/src/panels/canvas/folder-map-apply.ts` | ~80 | Renderer | 2C | Pending-apply safety, rollback, undo wrapping |
| `tests/shared/engine/project-map-analyzers.test.ts` | ~300 | Test | 1A | Import extraction, resolution, wikilinks, JSON refs, edge cases |
| `tests/renderer/panels/canvas/folder-map-layout.test.ts` | ~200 | Test | 1B | Tree positions, collision, edge sides, depth truncation |
| `tests/renderer/workers/project-map-worker.test.ts` | ~200 | Test | 1C | Chunked append/finalize/cancel, operation ID, large batches |
| `tests/renderer/panels/canvas/folder-map-apply.test.ts` | ~150 | Test | 2C | Pending-apply rollback, undo/redo, stale rejection |

### Modified Files

| File | Change | Sub-phase |
|------|--------|-----------|
| `src/shared/canvas-types.ts` | Add `'project-folder'` to CanvasNodeType, sizes, metadata, CARD_TYPE_INFO | 1D |
| `src/shared/ipc-channels.ts` | Add `fs:read-files-batch`, `canvas:get-snapshot`, `canvas:apply-plan` | 1C+3A |
| `src/preload/index.ts` | Add `fs.readFilesBatch` method, `canvas` snapshot/plan namespace | 1C+3A |
| `src/main/index.ts` | Register new IPC handlers | 1C |
| `src/main/ipc/filesystem.ts` | Add `fs:read-files-batch` handler (PathGuard, p-limit(8), 15s timeout) | 1C |
| `src/renderer/src/panels/canvas/card-registry.ts` | Add lazy import for ProjectFolderCard | 1D |
| `src/renderer/src/panels/canvas/EdgeLayer.tsx` | Style contains/imports/references kinds, zoom threshold, viewport filtering | 1D |
| `src/renderer/src/panels/canvas/CanvasView.tsx` | Wire folder-map orchestrator | 1D+2 |
| `src/renderer/src/panels/canvas/CanvasSurface.tsx` | Mount FolderMapPreview layer between grid and cards | 2B |
| `src/renderer/src/panels/sidebar/FileContextMenu.tsx` | Add 'map-to-canvas' to FOLDER_ACTIONS | 1D |
| `src/renderer/src/panels/sidebar/Sidebar.tsx` | Handle 'map-to-canvas' action | 1D |
| `src/renderer/src/design/components/CommandPalette.tsx` | Add "Map Vault Root" command item | 1D |
| `src/main/services/mcp-server.ts` | Add project.map_folder, canvas.get_snapshot, canvas.apply_plan tools | 3C |

---

## Operational Limits

| Parameter | Default | Rationale |
|---|---|---|
| `expandDepth` | 2 | Keeps initial map manageable. User drills via Expand Folder |
| `maxNodes` | 200 | 200 nodes * ~300 bytes = ~60KB JSON. Within performance budget |
| Chunk size | 50 paths | Balances IPC overhead vs memory per batch |
| Read concurrency | `p-limit(8)` | Lower than vault-indexing's 12 to leave headroom |
| Read batch timeout | 15s | Generous for NFS/slow disks, AbortController cancels cleanly |
| `imports`/`references` edges | Hidden by default | Large maps stay readable. Toggled, hovered, or zoom > 0.8 reveals |
| `contains` edges | Visible, low-emphasis | Structural scaffold always present |
| Auto-fit on large apply | >50 nodes | Initial paint lands in LOD 2, cards mount on zoom-in |

## Scope Boundaries

- Canonical output is canvas-only in v1. No auto-writing ontology notes or markdown frontmatter.
- Agent canvas writes are preview/apply only. No silent direct mutation.
- V1 maps one selected folder at a time. Vault root is the default selection.
- The project-map graph is separate from VaultIndex/KnowledgeGraph.
- Binary assets are skipped, surfaced as counts on parent folder nodes.
- Semantic ontology inference is deferred to Slice 4.
- Real-time sync with file changes is not in scope. Re-map to update.

## Definition of Done

- Clean shared types with `ProjectMapEdgeKind` alias
- Deterministic analyzers fully unit-tested
- Worker-backed build pipeline with cancellation and partial-failure handling
- Tree layout with collision resolution against existing canvas nodes
- Lightweight SVG preview and single-batch apply with confirmation bar
- Pending-apply safety with rollback on failure
- Budget-aware apply: auto-fit viewport, LOD-at-scale, viewport edge filtering
- Sidebar and command-palette entry points with progress UX
- Single Cmd+Z undoes entire folder mapping
- Structured canvas snapshot/apply IPC with validation
- MCP mirrors with HITL gate (only after IPC stable)
- No regressions to existing note, workbench, terminal, or agent-session canvas flows
