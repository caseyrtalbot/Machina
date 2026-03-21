# Workbench Handoff

Date: 2026-03-20

## Context

This implementation continued the direction started in:

- `27a74f7` `feat: add system artifact substrate`
- `d03dd78` `feat: add workbench artifact workflows`

The latest follow-up commit is:

- `5bd4151` `feat: rename workbench surface and polish palette`

## What Landed

- Renamed the renderer surface from `project-canvas` to `workbench`.
- Moved renderer files from `src/renderer/src/panels/project-canvas/` to `src/renderer/src/panels/workbench/`.
- Renamed shared types from `project-canvas-types` to `workbench-types`.
- Added persisted tab migration so old saved `project-canvas` tabs normalize to `workbench`.
- Added `useWorkbenchActionStore` so workbench toolbar actions can be invoked from the command palette.
- Polished the command palette:
  - richer note metadata
  - workbench actions exposed in the palette
  - disabled/unavailable actions called out instead of silently failing
  - `New Note` now actually creates a note
- Polished the workbench toolbar with status pills and clearer actions.

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
- `src/renderer/src/store/workbench-store.ts`
- `src/renderer/src/store/workbench-actions-store.ts`
- `src/renderer/src/panels/workbench/workbench-migration.ts`
- `src/renderer/src/design/components/CommandPalette.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/store/tab-store.ts`
- `src/shared/workbench-types.ts`

## Completed Since Last Handoff

### 1. Workbench file migration (done)

Added `workbench-migration.ts` with `migrateWorkbenchFile()`. On workbench load, if
`.thought-engine-workbench.json` doesn't exist but `.thought-engine-project-canvas.json` does,
renames the legacy file. Uses dependency-injected `WorkbenchFs` interface for testability.

Files:

- `src/renderer/src/panels/workbench/workbench-migration.ts` (new)
- `src/renderer/src/panels/workbench/workbench-migration.test.ts` (new, 4 cases)
- `src/renderer/src/panels/workbench/WorkbenchPanel.tsx` (wired migration into loadWorkbench)

### 3. Expanded test coverage (done)

- `src/renderer/src/store/__tests__/tab-store.test.ts`: 6 new cases (unknown types, dedup, editor enforcement, null snapshot, missing active tab)
- `src/renderer/src/store/__tests__/workbench-actions-store.test.ts` (new, 3 cases: initial state, registration, reset)

Full suite: 44 files, 398 tests passing.

## Known Gaps / Best Next Steps

### 2. Decide whether to keep or rename `project:*` IPC/service naming

The user-facing surface is now `workbench`, but IPC/service namespaces still use `project:*`.

This is not broken, but it is inconsistent.

Next step:

- Either keep `project:*` as an implementation detail and document that choice, or
- rename the IPC/service layer to `workbench:*` end-to-end

Likely files:

- `src/shared/ipc-channels.ts`
- `src/preload/index.ts`
- `src/main/**/*`
- renderer callers using `window.api.project.*`

### 3. Add real workbench interaction coverage

Current coverage is good at the unit level, but not at the app-flow level.

Next step:

- Add tests for:
  - persisted tab migration
  - opening workbench from palette
  - toolbar actions registering into the palette only when workbench is active
  - legacy workbench file migration
  - creating tension/pattern/session artifacts from the workbench

Likely files:

- `src/renderer/src/store/__tests__/tab-store.test.ts`
- `src/renderer/src/panels/workbench/workbench-artifacts.test.ts`
- `e2e/**/*`

### 4. Clean up disabled palette actions

The palette now correctly marks these as unavailable:

- `Toggle Sidebar`
- `Re-index Vault`
- `Activate Claude`

Next step:

- either implement them
- or remove them from the built-in command list if they are intentionally out of scope

Likely file:

- `src/renderer/src/App.tsx`

### 5. Evaluate whether the workbench should load system artifacts directly

Right now the sidebar exposes system artifacts cleanly, and the workbench can create them.
There may be a useful next step where the workbench also visualizes linked session/pattern/tension artifacts directly.

Possible directions:

- overlay artifact references on related workbench cards
- open saved pattern snapshots back into the workbench
- show “created from workbench selection/session” backlinks in the panel

## Verification Commands

These pass after the migration + test expansion:

```bash
npm run typecheck
npm run lint
npm test   # 44 files, 398 tests
```

Targeted run:

```bash
npx vitest run \
  src/renderer/src/panels/workbench/workbench-migration.test.ts \
  src/renderer/src/panels/workbench/workbench-artifacts.test.ts \
  src/renderer/src/store/__tests__/tab-store.test.ts \
  src/renderer/src/store/__tests__/workbench-actions-store.test.ts \
  src/renderer/src/design/components/__tests__/CommandPalette.test.ts \
  tests/services/session-milestone-grouper.test.ts
```

## Suggested Next Prompt

Use this to resume quickly in the next context window:

```text
Continue in /Users/caseytalbot/Projects/thought-engine. Read WORKBENCH_HANDOFF.md and continue the workbench implementation. Preserve the existing uncommitted e2e/fixtures/test-vault/category-creation.md, .claude/, and .thought-engine/. Next up: decide on project:* IPC rename (#2), clean up disabled palette actions (#4), or start artifact visualization in the workbench (#5).
```
