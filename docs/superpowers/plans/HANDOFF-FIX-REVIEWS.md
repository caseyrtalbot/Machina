# Handoff: Fix Remaining Review Issues in V4 UI Redesign Plan

**Date**: 2026-03-13
**Status**: COMPLETE - All review issues fixed, plan ready for execution
**From**: Chunk 3-4 fix session
**Completed by**: Chunk 5-6 fix session (2026-03-13)

## Current State

The implementation plan has grown from 7371 to 9744 lines after fixing Chunks 3-4.

**Plan**: `docs/superpowers/plans/2026-03-12-ui-redesign-plan.md` (9744 lines)
**Spec**: `docs/superpowers/specs/2026-03-12-ui-redesign-design.md` (1016 lines)

### What's Done
- Chunks 1-2: Written + reviewed (6 issues fixed)
- Chunk 3 (8 issues): All fixed. Worker stale errors, getArtifact migration, vault:init, session hydration, loading skeleton, version migration, CommandPalette 5 features, TDD added to Tasks 17/21.
- Chunk 4 (11 issues): All fixed. 3 new tasks added (FileTree/Sidebar wiring, Terminal restyling, GraphPanel settings wiring). buildFileTree redesigned to flat structure. Persistence added to both stores. Groups section added. Full implementation code for GraphSettingsPanel and SettingsModal.

### What's Left (3 steps)

**Step 1: Renumber Chunks 5-6 tasks**
Chunk 4 added Tasks 27-29, creating duplicates with Chunk 5 (which also starts at Task 27). Apply +3 offset to all task numbers in Chunks 5-6. Update all cross-references.

Current layout:
- Chunk 1: Tasks 1-6
- Chunk 2: Tasks 7-15
- Chunk 3: Tasks 16-21
- Chunk 4: Tasks 22-29 (was 22-26, added 27-29)
- Chunk 5: Tasks 27-37 **DUPLICATE, needs renumber to 30-40**
- Chunk 6: Tasks 38-51 **needs renumber to 41-54**

After renumbering: 54 tasks total.

**Step 2: Fix Chunk 5 issues (8 issues, 1 critical)**
These reference OLD task numbers. After renumbering, adjust accordingly (+3 offset).

20. **Missing GraphContextMenu task** (old Task 37, new Task 40 area)
    Task 37 imports `GraphContextMenu` but no task creates it. Add task before the integration task. 4 menu items: Open in editor, Reveal in sidebar, Copy path, Delete. This adds +1 more task, making Chunk 6 offset +4.

21. **No hover/click glow transitions** (Spec 3A)
    State changes are instantaneous, spec requires 200ms ease-out in / 300ms ease-out out. Add interpolation logic to useGraphHighlight or GraphRenderer.

22. **No frame budget monitoring** (Spec 3E)
    No `performance.now()` instrumentation. Add frame timing with adaptive quality reduction.

23. **No extreme zoom-out edge LOD** (Spec 3E)
    Edges always drawn individually. Spec wants single low-alpha overlay at extreme zoom. Add edge LOD branch to renderGraph.

24. **Loading skeleton uses wrong trigger** (old Task 37)
    Uses `sim.on('end')` (alpha < 0.001), spec says alpha < 0.1. Use tick listener with threshold.

25. **SkillsPanel uses non-existent `window.api.fs` API** (old Task 31)
    No such API exists. Use existing IPC pattern (`window.api.vault.*` or add `fs:list-files` IPC).

26. **`Canvas2DGraphRenderer.hitTest` uses `require()` in ES module** (old Task 35)
    Use static import. Also, `render()` is a no-op. Fix both.

27. **`NodeSizeMode` type defined in two places** (old Tasks 29 + 34)
    Define in one canonical location (graph-settings-store), re-export from GraphRenderer.

**Step 3: Fix Chunk 6 issues (12 issues, 4 critical)**
These also reference OLD task numbers. After renumbering (+4 total offset from Chunk 4 additions + GraphContextMenu), adjust accordingly.

28. **`transitions.modalFade` uses invalid CSS `'200ms fade-in'`** (old Task 38)
    `fade-in` is not a valid CSS timing function. Change to `'200ms ease-in'`. Update test and CSS custom property.

29. **EditorPanel `editorRef` is never set, toolbar is dead** (old Task 45)
    `editorRef.current` is always null. RichEditor creates its own editor internally. Lift `useEditor` into EditorPanel and pass down, or expose via forwardRef.

30. **No task for hardcoded color audit/replacement** (Spec 4A)
    Multiple files have hardcoded hex colors. Spec requires replacing with tokens. Add audit task.

31. **No task applying gradient panel separators** (Spec 4A)
    CSS classes defined but never applied to `SplitPane.tsx`. Add modification step.

32. **Backlinks access via `(store as any).index` is fragile** (old Task 45)
    Uses `any` cast, won't work post-migration. Expose `getBacklinks` as proper store action using the graph edges from plain state.

33. **5 new components have no tests** (old Tasks 41-44, 46)
    EditorToolbar, EditorBreadcrumb, FrontmatterHeader, BacklinksPanel, StatusBar. Add tests for pure logic (parseBreadcrumb, buildMetadataEntries, extractContext, word count, fuzzy matching).

34. **TypeScript type narrowing won't work in filter().map()** (old Task 49)
    `n.x` still `number | undefined` after filter. Use type guard function.

35. **`positionedNodes` useMemo has wrong dependency** (old Task 49)
    Depends on `[getGraph]` which is stable. Won't update. Derive from `graph` state (reactive) instead.

36. **StatusBar cursor position hardcoded to Ln 1, Col 1** (old Task 46)
    No cursor tracking implemented. Add `cursorLine`/`cursorCol` to editor-store, updated by editor onChange.

37. **StatusBar git dirty status never checked** (old Task 46)
    Always green. Add `vault:git-status` IPC or mark as explicit stub with TODO comment.

38. **Unused import in useGraphKeyboard** (old Task 48)
    `GraphNode` and `GraphEdge` imported but unused. Remove.

39. **Focus ring CSS defined twice with conflicting properties** (old Task 39)
    Both outline and box-shadow. Merge into single rule using box-shadow per spec.

## How To Do It

1. Invoke `superpowers:writing-plans` skill for plan conventions
2. **Renumber first**: Apply +3 offset to Chunk 5 (Tasks 27-37 become 30-40), then Chunk 6 (Tasks 38-51 become 41-54). Search-and-replace task references throughout.
3. **Fix Chunks 5+6 in parallel** (independent after renumbering). Use subagents.
4. For the new GraphContextMenu task: insert before the integration task in Chunk 5, renumber Chunk 6 by +1 more.
5. After all fixes, dispatch plan-document-reviewer subagent per chunk.
6. Repeat review loop until all chunks approved.
7. Prepare execution handoff.

### Plan conventions
- Each task: `### Task N: [Name]`
- Steps: `- [ ] **Step N: [Description]**`
- Full code in code blocks (never "add validation")
- Run commands: `cd /Users/caseytalbot/Projects/thought-engine` prefix
- Commits: `git add` specific files + `git commit -m "type: description"`
- TDD: write test, verify fail, implement, verify pass, commit

### Source files to read (for context when writing new tasks)
- `src/renderer/src/panels/graph/GraphPanel.tsx`
- `src/renderer/src/panels/graph/GraphRenderer.ts`
- `src/renderer/src/panels/graph/GraphRendererInterface.ts`
- `src/renderer/src/panels/graph/useGraphHighlight.ts`
- `src/renderer/src/panels/skills/SkillsPanel.tsx`
- `src/renderer/src/panels/editor/EditorPanel.tsx`
- `src/renderer/src/panels/editor/RichEditor.tsx`
- `src/renderer/src/components/StatusBar.tsx`
- `src/renderer/src/design/tokens.ts`
- `src/renderer/src/design/components/SplitPane.tsx`
- `src/renderer/src/panels/graph/useGraphKeyboard.ts`
- `src/renderer/src/store/graph-settings-store.ts`

## Project Location

- **Repo**: `/Users/caseytalbot/Projects/thought-engine/`
- **Branch**: `main`
- **npm workaround**: `--cache /tmp/npm-cache-te`
