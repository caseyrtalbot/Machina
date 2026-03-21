# Workbench Handoff

Date: 2026-03-20 (updated 2026-03-21)

## Context

This implementation continued the direction started in:

- `27a74f7` `feat: add system artifact substrate`
- `d03dd78` `feat: add workbench artifact workflows`
- `5bd4151` `feat: rename workbench surface and polish palette`

Follow-up commits from this session:

- `382d6d9` `feat: add workbench file migration and expand test coverage`
- `03873c6` `refactor: rename project:* IPC namespace to workbench:*`
- `9e5b284` `feat: add system artifact cards to workbench canvas`

## What Landed (This Session)

### 1. Workbench file migration (382d6d9)

- `workbench-migration.ts`: renames `.thought-engine-project-canvas.json` to `.thought-engine-workbench.json` on first load
- Dependency-injected `WorkbenchFs` interface for testability
- 4 migration tests, 6 new tab-store tests, 3 new actions-store tests

### 2. IPC namespace rename (03873c6)

- Renamed all `project:*` IPC channels to `workbench:*`
- Renamed `window.api.project` to `window.api.workbench` in the preload layer
- Renamed `src/main/ipc/project.ts` to `workbench.ts`
- All renderer callers updated

### 4. Palette actions cleanup (landed in 9e5b284 via App.tsx)

- Toggle Sidebar: implemented with `showSidebar` state, wired to Cmd+B
- Re-index Vault: wired to `onLoadVault(vaultPath)`
- Activate Claude: removed from palette (needs bigger refactor to lift from TerminalPanel)

### 5. System artifact visualization (9e5b284)

- Added `system-artifact` canvas node type with typed `SystemArtifactNodeMeta`
- `SystemArtifactCard.tsx`: renders session/pattern/tension artifacts with kind badge, status pill, summary/question, stat chips (file count, commands, snapshot indicator)
- `workbench-artifact-placement.ts`: places artifact cards on workbench canvas when sidebar items are clicked (with dedup check)
- Wired in App.tsx `onSystemArtifactSelect` handler
- `canvas-types.test.ts`: 21 registration completeness tests
- `workbench-artifact-placement.test.ts`: 4 placement tests
- Full suite: 46 files, 467 tests

## Important Local State To Preserve

Do not overwrite or revert these existing local changes:

- `e2e/fixtures/test-vault/category-creation.md`
- `.claude/`
- `.thought-engine/`

## Current File Map

Primary implementation files:

- `src/renderer/src/panels/workbench/WorkbenchPanel.tsx`
- `src/renderer/src/panels/workbench/workbench-layout.ts`
- `src/renderer/src/panels/workbench/workbench-artifacts.ts`
- `src/renderer/src/panels/workbench/workbench-migration.ts`
- `src/renderer/src/panels/workbench/workbench-artifact-placement.ts`
- `src/renderer/src/panels/workbench/SystemArtifactCard.tsx`
- `src/renderer/src/store/workbench-store.ts`
- `src/renderer/src/store/workbench-actions-store.ts`
- `src/renderer/src/design/components/CommandPalette.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/store/tab-store.ts`
- `src/shared/workbench-types.ts`
- `src/shared/canvas-types.ts`
- `src/main/ipc/workbench.ts`

## Known Gaps / Best Next Steps

### 1. Wire artifact edges from relationship fields

System artifacts have `connections`, `tensions_with`, `tension_refs`, and `pattern_refs` fields. When multiple artifacts are on the canvas, edges should be drawn between them using the existing `CanvasEdgeKind` system (connection, cluster, tension).

Next step:

- When placing an artifact, check if any existing canvas nodes match its relationship IDs
- Create edges with appropriate kinds
- Update edges when new artifacts are placed

Likely files:

- `src/renderer/src/panels/workbench/workbench-artifact-placement.ts`
- `src/renderer/src/store/canvas-store.ts`

### 2. Enrich artifact cards with full frontmatter

Currently `placeArtifactOnWorkbench` only uses `SystemArtifactListItem` fields (id, title, type, status, path). The full frontmatter (summary, file_refs, question, command_count, etc.) is available via `vault:read-system-artifact` IPC.

Next step:

- Read and parse full frontmatter when placing an artifact
- Populate all `SystemArtifactNodeMeta` fields

Likely files:

- `src/renderer/src/panels/workbench/workbench-artifact-placement.ts`

### 3. Pattern snapshot restore

Pattern artifacts store a `canvas_snapshot` path pointing to a `.canvas.json` file. The workbench could offer a "Restore Snapshot" action to load a pattern's saved card layout.

Likely files:

- `src/renderer/src/panels/workbench/SystemArtifactCard.tsx` (add action button)
- `src/renderer/src/panels/canvas/canvas-io.ts` (loadCanvas already works)

### 4. Implement Activate Claude palette command

Currently removed because the activation logic lives inside lazily-mounted TerminalPanel. Needs either:

- An action store pattern (like `useWorkbenchActionStore`) to expose terminal actions
- Or lifting `handleActivateClaude` into a shared module

Likely files:

- `src/renderer/src/panels/terminal/TerminalPanel.tsx`
- `src/renderer/src/store/` (new action store)
- `src/renderer/src/App.tsx`

### 5. Remaining test coverage

- Opening workbench from palette
- Toolbar actions registering into the palette only when workbench tab is active
- Creating tension/pattern/session artifacts from the workbench (integration level)

## Verification Commands

These pass after all commits:

```bash
npm run typecheck
npm run lint
npm test   # 46 files, 467 tests
```

Targeted run:

```bash
npx vitest run \
  src/renderer/src/panels/workbench/workbench-migration.test.ts \
  src/renderer/src/panels/workbench/workbench-artifacts.test.ts \
  src/renderer/src/panels/workbench/workbench-artifact-placement.test.ts \
  src/renderer/src/store/__tests__/tab-store.test.ts \
  src/renderer/src/store/__tests__/workbench-actions-store.test.ts \
  src/shared/__tests__/canvas-types.test.ts \
  src/renderer/src/design/components/__tests__/CommandPalette.test.ts \
  tests/services/session-milestone-grouper.test.ts
```

## Suggested Next Prompt

Use this to resume quickly in the next context window:

```text
Continue in /Users/caseytalbot/Projects/thought-engine. Read WORKBENCH_HANDOFF.md and continue the workbench implementation. Preserve the existing uncommitted e2e/fixtures/test-vault/category-creation.md, .claude/, and .thought-engine/. Next priorities: wire artifact relationship edges (#1), enrich cards with full frontmatter (#2), or add pattern snapshot restore (#3).
```
