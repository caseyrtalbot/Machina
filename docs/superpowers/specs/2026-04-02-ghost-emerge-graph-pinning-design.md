# Ghost Emergence + Graph Neighborhood Pinning

**Date:** 2026-04-02
**Status:** Approved

---

## Prerequisite: Fix `serializeArtifact` Frontmatter Round-Trip

`serializeArtifact` in `parser.ts` only writes known `Artifact` fields. Any custom frontmatter key (like `origin`) is silently dropped on the next save. This must be fixed before Feature 2 can work.

**Fix:** Spread `artifact.frontmatter` into the serialized output, excluding keys already handled explicitly (`id`, `title`, `type`, `created`, `modified`, `source`, `frame`, `signal`, `tags`, `connections`, `clusters_with`, `tensions_with`, `appears_in`, `related`, `concepts`).

**Test:** Add a round-trip test asserting that `origin: 'emerge'` survives `serializeArtifact → parseArtifact`.

### Files Modified

| File | Change |
|------|--------|
| `src/shared/engine/parser.ts` | `serializeArtifact`: spread remaining `artifact.frontmatter` keys into output object |
| `tests/engine/parser.test.ts` | Add round-trip test for custom frontmatter key preservation |

---

## Feature 1: Graph Neighborhood Pinning

### Problem

"Show on graph" calls `setSelectedNode(ghost.id)` which draws a persistent blue selection ring — but the neighborhood dimming (non-neighbors at 0.3 alpha, neighbor edges glowing green) is driven by `hoveredNodeId`, which clears the instant the mouse moves off the node.

### Design

Fallback chain in the renderer's highlighting logic:

```
Active focus node = highlightedNode (hover) ?? selectedNodeIndex (click) ?? null
```

**Behavior:**
- Selected node's neighborhood stays dimmed/glowing — identical visual to hover, but persistent
- Hover still works: moving over a different node temporarily shows that node's neighborhood
- When hover clears, renderer falls back to selected node's neighborhood
- Clicking a new node changes selection (and its pinned neighborhood)
- Clicking empty canvas clears selection

**No new state.** Existing `highlightedNode` and `selectedNodeIndex` on `GraphRenderer` are sufficient.

### Files Modified

| File | Change |
|------|--------|
| `src/renderer/src/panels/graph/graph-renderer.ts` | `updateHighlighting()`: compute `focusNode = highlightedNode ?? selectedNodeIndex`, use it for neighbor dimming and edge glow. `handlePointerUp`: when `isPanning && !pointerMoved` (click on empty space, not a drag release), clear `selectedNodeIndex` and fire `onDeselect` callback. Add `onDeselect` to `RendererCallbacks` interface. |
| `src/renderer/src/panels/graph/GraphPanel.tsx` | Add `onDeselect` callback — clears `selectedNodeId` in store. Update the 3 `LabelLayer.render()` call sites (onViewportChange, physics onmessage, display options effect) to compute `neighborSet` from `hoveredIdx ?? selectedIdx` instead of `hoveredIdx` alone. |

### Edge Cases

- **Click on empty space:** `isPanning && !pointerMoved` distinguishes a tap from a pan-release. Only tap clears selection.
- **Hover same node as selected:** No visual change — identical dimming.
- **Ghost node selected:** Valid. Neighborhoods are typically small (inbound edges from referencing notes).

---

## Feature 2: Ghost Emergence

### Problem

Creating a note from a ghost produces an empty file. The app has Claude CLI integration (`agent-action-runner.ts`). Ghost creation should synthesize a unified note from all referencing content.

### Design

New IPC channel `vault:emerge-ghost` (under existing `vault` namespace). When the user clicks "Create" on a ghost:

1. **Renderer** sends `vault:emerge-ghost` with ghost title, reference file paths, and vault path
2. **Main process** reads all reference files, truncating each body to 500 chars
3. **Main process** calls `claude` CLI (imported from `agent-action-runner.ts`: `callClaude` + `extractJsonFromResponse`) with a synthesis prompt
4. **Claude** returns JSON: `{ tags, origin, body }`
5. **Main process** uses existing `inferFolder()` for folder placement, creates folder if new, writes file atomically (`O_CREAT | O_EXCL`)
6. **Renderer** opens note in editor

### IPC Contract

```typescript
// In src/shared/ipc-channels.ts — add to IpcChannels
'vault:emerge-ghost': {
  params: {
    ghostId: string
    ghostTitle: string
    referencePaths: readonly string[]
    vaultPath: string
  }
  result: {
    filePath: string
    folderCreated: boolean
    folderPath: string
  }
}
```

### Claude Prompt Structure

```
You are a knowledge synthesizer for a personal knowledge vault.

## Task
Create a unified note for the concept "{ghostTitle}" by synthesizing insights from the {N} notes that reference it.

## Reference Notes
{for each reference: title, tags, body (truncated to 500 chars)}

## Instructions
1. Synthesize the key ideas about "{ghostTitle}" across all references into a cohesive note
2. Generate relevant tags based on the content
3. Write in the same voice and style as the reference notes

Respond ONLY with a JSON object. Do not add any prose before or after.

{
  "tags": ["string"],
  "origin": "emerge",
  "body": "string — markdown body content"
}
```

**Folder placement:** Handled by existing `inferFolder()` from `ghost-index.ts` — deterministic majority-folder heuristic, already tested. Claude is not asked for folder decisions.

**Title:** Uses `ghostTitle` directly. Claude is not asked to rename.

### Origin Field

Custom frontmatter key `origin` on serialized artifacts. Survives round-trip via the prerequisite `serializeArtifact` fix. Values: `emerge`, `challenge`, or any future agent action name.

```yaml
---
title: Jorge Luis Borges
type: note
origin: emerge
tags:
  - literature
  - fiction
connections:
  - Ficciones
  - The Library of Babel
---
```

### Sidebar Color Coding

| Element | Color | Condition |
|---------|-------|-----------|
| Folder icon | Blue (`#60a5fa`) | All `.md` files in folder have `origin` in frontmatter |
| File icon | Green (`#4ade80`) | File has `origin` field in frontmatter |

**No new store state.** Folder origin is derived from file contents — if every artifact in a folder has `origin` in its frontmatter, the folder icon renders blue. This is computed at render time from the existing vault-store artifacts, not tracked separately.

### Shared Hook: `useGhostEmerge`

Both `GhostPanel.tsx` and `GraphDetailDrawer.tsx` currently duplicate the ghost creation logic. Extract a single `useGhostEmerge(ghostId)` hook that both consume. Returns `{ emerge, isEmerging }`.

### Files Modified/Created

| File | Change |
|------|--------|
| `src/shared/ipc-channels.ts` | Add `vault:emerge-ghost` channel type |
| `src/main/ipc/filesystem.ts` | Add `vault:emerge-ghost` handler: read refs, call `callClaude` (imported from agent-action-runner), atomic write |
| `src/main/services/agent-action-runner.ts` | Export `callClaude` and `extractJsonFromResponse` (currently module-private) |
| `src/preload/index.ts` | Add `vault.emergeGhost()` to existing `vault` namespace |
| `src/renderer/src/hooks/useGhostEmerge.ts` | **New.** Shared hook: calls IPC, opens note in editor, handles loading/error state |
| `src/renderer/src/panels/ghosts/GhostPanel.tsx` | Replace `handleCreate` with `useGhostEmerge` hook |
| `src/renderer/src/panels/graph/GraphDetailDrawer.tsx` | Replace `handleCreate` with `useGhostEmerge` hook |
| `src/renderer/src/panels/sidebar/FileTree.tsx` | `FolderIcon`: derive blue from folder contents. `fileKindIcon`: check `origin` in frontmatter for green. |

### Error Handling

- **Claude CLI not found:** Fall back to creating an empty note (current behavior) with console warning
- **Claude timeout (60s):** Same fallback
- **Invalid JSON response:** No retry. Fall back to empty note. The prompt already says "Respond ONLY with JSON."
- **File already exists:** `O_CREAT | O_EXCL` fails atomically — return error, no overwrite
- **Folder creation fails (name conflict with existing file):** Check `stat` before `mkdir`, write to vault root if conflict

### Data Flow

```
GhostPanel/GraphDetailDrawer "Create" click
  → useGhostEmerge.emerge()
  → window.api.vault.emergeGhost({ ghostId, ghostTitle, referencePaths, vaultPath })
  → IPC: vault:emerge-ghost
  → main/ipc/filesystem.ts:
      1. Read reference files via file-service (truncate bodies to 500 chars)
      2. Build prompt with bodies
      3. callClaude (imported from agent-action-runner.ts)
      4. extractJsonFromResponse, validate { tags, origin, body }
      5. inferFolder() for placement, mkdir if new
      6. serializeArtifact with origin + tags + body + connections
      7. Atomic write via fs.open O_CREAT | O_EXCL
      8. Return { filePath, folderCreated, folderPath }
  → useGhostEmerge: setActiveNote(filePath)
  → Vault watcher fires → worker parses → sidebar re-renders with green file / blue folder
```

---

## Testing Strategy

### Prerequisite: Frontmatter Round-Trip
- Unit test: `origin: 'emerge'` survives `serializeArtifact → parseArtifact` cycle
- Unit test: explicit fields (`title`, `tags`) are not duplicated by frontmatter spread

### Feature 1: Graph Pinning
- Unit test: extract `focusNode` fallback to pure helper, test `hover ?? selected ?? null`
- Unit test: `isPanning && !pointerMoved` correctly identifies empty-space click vs pan-release
- Manual: "Show on graph" → neighborhood stays dimmed → hover another → temporary override → mouse away → snap back → click empty → clear

### Feature 2: Ghost Emergence
- Unit test: prompt builder (reference formatting, body truncation at 500 chars)
- Unit test: JSON response parsing + validation (valid, missing fields, malformed)
- Unit test: atomic file creation rejects when file exists
- Integration test: mock `callClaude` → verify file written with correct frontmatter/body/folder
- Unit test: sidebar folder-origin derivation (all files have origin → blue, mixed → default)
- Manual: create ghost → verify note opens with content → verify folder color → verify file color
