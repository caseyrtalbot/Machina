# v2 — Architecture Arc (Handoff)

**Goal:** raise the polish ceiling. v1.1 and v1.2 shipped every fix that could be done without touching the three oversized files or the chrome model. v2 pays down the debt so the next round of polish is faster, lower-risk, and the app can scale to new panels without regressing existing ones.

**Scope:** five batches — Canvas decomposition, Graph architecture, Chrome system, Tab model, Icon + remaining refactors. Bundled sparse-canvas upgrade now unblocked.

**Budget:** ~200 eng-hours / 4–6 weeks.

**Branch model:** feature branch per batch. Canvas decomposition (Week 1–2) is the biggest risk — land it isolated and verify before starting anything else.

---

## 0. Prerequisites

Must be true before starting v2:

- v1.1 and v1.2 shipped and merged
- Pass 3 (flows) and Pass 4 (a11y deep-dive) findings folded into the roadmap
- Dense-canvas capture (885+ nodes) taken — informs canvas LOD / perf decisions
- Theme × accent matrix captured — catches any token drift introduced during v1.x
- A decision on the tab model (see D4 below) — **do not start v2 without this**

Must be read before starting:

- `docs/ux-assessment/findings/05-roadmap.md` §3 (v2 section)
- `docs/ux-assessment/findings/01-static-audit.md` §"Architecture drifts that block polish"
- `docs/ux-assessment/findings/02-surfaces/canvas.md` (full, including dense-state addendum)
- `docs/ux-assessment/findings/02-surfaces/_cross-cutting.md` — F-cross-02, -03, -04
- `AGENTS.md` §"Data Flow" and §"State Management" for current ownership boundaries
- The canvas-mutation protocol (`AGENTS.md` §"Canvas Mutations (Snapshot-and-Plan)") — critical before touching `CanvasView.tsx`

## 1. Decisions that must be made before code lands

### Decision D4 — Tab model (before Week 4, ideally before v2 starts)

**Context:** Today the Editor has tabs (Home, Security Reviewer) while Canvas/Graph/Ghosts/Health do not. A user can't generalize.

**Options:**
- **D4a. Obsidian model** — universal tabs. Any panel (Editor, Canvas, Graph) can live in a tab; multiple canvases, multiple editors, mixed. Highest power, highest engineering cost.
- **D4b. VSCode model** — tabs are file-scoped only (notes, images, PDFs). System panels (Graph, Ghosts, Health, Canvas-as-surface) are activity-bar-driven and swap the whole workspace. Simpler mental model; closer to current behavior.
- **D4c. Status quo +** — keep current, but document the intent and align edge cases. Lowest engineering cost, but the inconsistency stays.

**Recommendation:** **D4b**. Closer to existing behavior, less architectural churn. D4a is a v3 decision if power users demand it.

### Decision D5 — Default graph view (before Week 3)

**Context:** Hair-ball layout at 467 nodes is unreadable. F-graph-04 suggests cluster-collapsed by default.

**Options:**
- **D5a. Cluster-collapsed default** — super-nodes for dense clusters; click to expand.
- **D5b. Force-layout default + "focus" mode** — keep current default, but add a toggle for 2-hop focus mode on any node click.
- **D5c. User-configurable default** — first-launch asks, setting persists.

**Recommendation:** **D5b** for v2 (safer, keeps familiar default for existing users). Ship **D5a** as v3 experiment.

### Decision D6 — Icon library (before Week 5)

**Context:** The activity bar inlines SVGs; Phosphor Icons is already a dependency.

**Options:**
- **D6a. Phosphor regular** throughout. Thin stroke, consistent metrics.
- **D6b. Phosphor duotone** throughout. More visual weight; better for the dark aesthetic.
- **D6c. Keep mixed** (don't do this — just flagging for completeness).

**Recommendation:** start a prototype with both Phosphor weights on the activity bar; pick whichever reads better on the dark glass. Commit to one.

## 2. Batches

### Week 1–2 — Canvas decomposition (theme T10, high risk)

**Findings addressed:** F-static-12, F-static-13, F-canvas-04, F-canvas-01 (partial)

**Strategy:** decompose `CanvasView.tsx` (1049 lines, 13 useEffects) into a thin composition root with extracted hooks and primitives. No behavior change. Zero regression tolerance.

#### Target shape

- `CanvasView.tsx` — composition root, < 400 lines, orchestration only
- `hooks/useCanvasKeyboard.ts` — keyboard shortcuts, pan-with-space, escape handling
- `hooks/useCanvasSelection.ts` — marquee, click-to-select, select-all
- `hooks/useCanvasDragDrop.ts` — sidebar-drag-into-canvas, file drop
- `hooks/useCanvasConnectionDraw.ts` — draw-edge gesture, hover target resolution
- `hooks/useCanvasSplitEditor.ts` — split editor lifecycle
- `hooks/useCanvasAgentOverlay.ts` — active-agent visual layer
- `components/CanvasToolbarButton.tsx` — variant-driven primitive replacing hand-styled buttons (F-static-13)

#### Deliverables

1. Extract hooks, one at a time. Land each as its own commit. Tests pass after every extraction.
2. Build `CanvasToolbarButton` with variants: `default | running | destructive | disabled`. Migrate all buttons in `CanvasToolbar.tsx`. Line count drops from ~782 to ~400.
3. Resolve agent-badge role (F-canvas-04) once decomposition allows it:
   - Recommended decision: agent badges become **dockable canvas panels** (not floating chrome). They anchor to canvas edges, live in a `agentPanels` region, resize, pin, minimize.
4. Sparse-state guidance layer (F-canvas-01): now implementable as a `<CanvasSparseGuide>` component mounted conditionally when node count < 4. Uses `<PanelState>` primitive from v1.2.

#### Risk mitigation

- **Zero behavior change during decomposition.** Every hook extraction must ship with no visible delta. Use a frozen golden-state e2e test across the full week to verify.
- **Feature-flag the CanvasToolbarButton migration** — swap incrementally, button by button.
- **Canvas integration tests must be green before each merge.** Expand `canvas/__tests__/` coverage before decomposing if coverage is thin.

#### Definition of done

- `CanvasView.tsx` under 400 lines
- `CanvasToolbar.tsx` under 400 lines
- All extracted hooks tested in isolation
- No visual regression observed across the full card-type gallery
- Agent-badge role resolved and documented
- Sparse canvas shows contextual guidance
- Three e2e test runs pass clean in a row

### Week 3 — Graph architecture (theme T7 continued)

**Findings addressed:** F-graph-04 (or -b, per D5), F-graph-05

**Prereq:** Decision D5 made.

#### Deliverables (assuming D5b — focus mode)

1. **`useGraphFocus` hook:** on node click, fade everything beyond 2 hops to 15% opacity, recenter viewport on the selection's bounding box. Escape / click-empty exits focus mode.
2. **Focus mode status** indicated in the graph status bar (shipped in v1.2).
3. **Keyboard-accessible alternative** (F-graph-05): add `List clusters` and `List isolated notes` text views accessible from the graph settings panel. Not the full force-layout experience, but the underlying data is reachable without a mouse.

#### Deliverables (if D5a — cluster default)

Larger scope. Cluster detection worker, super-node rendering, expand-on-click, persist expand/collapse state. Budget +1 week.

#### Definition of done

- Clicking a node yields meaningful focus
- Escape returns to full graph
- Keyboard-only user can enumerate clusters and isolated notes
- Pass 4 a11y rescoring for graph improves

### Week 4 — Chrome system + tab model (theme T10)

**Findings addressed:** F-cross-02, F-cross-03

**Prereq:** Decision D4 made.

#### Deliverables

1. **Three-zone chrome system** documented in `docs/design-system/chrome.md`:
   - **Top strip:** context chips / title / tabs (left) · primary action / settings (right) · consistent 44px height
   - **Bottom strip (optional):** status bar with slots — count · zoom · selection · contextual hint. Introduced by Graph in v1.2 — becomes canonical here.
   - **Edge rails (optional):** panel-local toolbars (canvas toolbar, editor outline)
2. **Retrofit every panel** to the three-zone pattern. Top strip aligned, bottom strip where applicable, edge rails consolidated.
3. **Tab model alignment** per Decision D4b:
   - Tabs only appear for openable files (notes, images, PDFs, code files)
   - Activity bar drives panel selection for system surfaces
   - Remove ambiguous top-right `×` on the editor tab bar (v1.1 resolved; verify still consistent)
   - Document the rule in `AGENTS.md` §"Panel Architecture"

#### Definition of done

- A user can generalize "where do I find X?" across the app
- Design-system doc published under `docs/design-system/`
- Every panel demonstrably follows the three-zone model

### Week 5 — Icon system + remaining refactors (theme T10 finish)

**Findings addressed:** F-static-15, F-cross-04, F-static-14

**Prereq:** Decision D6 made.

#### Deliverables

1. **Phosphor everywhere:**
   - Retire inline SVGs in `ActivityBar.tsx` (replace `EditorIcon`, `CanvasIcon`, `GraphIcon`, etc. with Phosphor equivalents)
   - Audit `panels/canvas/CanvasToolbar.tsx` inline SVGs
   - Pick one weight (D6 decision) and enforce via ESLint or code review
2. **`FrontmatterHeader.tsx` split:**
   - Extract `FrontmatterProperty` (per-row renderer, type-specific)
   - Extract `FrontmatterRelationships` (connections + appears-in blocks)
   - Extract `FrontmatterAddMenu` (add property / add connection menus)
   - Target: `FrontmatterHeader.tsx` under 300 lines, composition only
3. **Zoom-aware canvas grid** (F-canvas-05):
   - Major grid at 500px world, minor grid at 100px world
   - At low zoom (< 30%), show only major grid
   - At high zoom (> 100%), show both, major grid slightly stronger
   - Origin crosshair indicator at 0,0 world

#### Definition of done

- No inline SVG icons outside `resources/` (where product-brand marks live)
- `FrontmatterHeader.tsx` under 300 lines
- Canvas grid provides wayfinding at all zoom levels

## 3. Cross-batch items

- **Performance perception:** after Week 1–2 canvas decomposition, profile canvas pan/zoom at 885+ nodes. Add LOD thresholds if needed. Separate workstream; not part of v2 scope unless regressions are observed.
- **Theme × accent matrix verification:** run after each weekly PR — 6 themes × 8 accents = 48 combinations. Spot-check 10 per batch.
- **ESLint rule enforcement** (optional but recommended):
  - No hex color literals outside `design/tokens.ts` and `design/themes.ts`
  - No inline SVG icons outside designated directories
  - No files over 800 lines

## 4. Out of scope for v2

- Windows / Linux port (not a macOS-only concern until there's product-market fit)
- Telemetry / analytics
- Collaborative editing
- Mobile layout
- Advanced graph algorithms (force-directed 3D, etc.)
- Auto-generated icon library refresh — Phosphor is adequate for the foreseeable future

## 5. Risk register

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Canvas decomposition introduces subtle regression (keyboard shortcut, drag lifecycle) | High | Comprehensive e2e coverage *before* starting; extract one hook per commit with tests after each |
| `CanvasToolbarButton` variant migration misses a state edge case | Medium | Migrate incrementally; feature-flag each button; visual regression tests on the canvas toolbar |
| Focus mode fades too aggressively; users can't find their way back | Low | Escape always exits; status bar shows "Focused on: X · Esc to exit" |
| Tab model change invalidates user muscle memory | Medium | Document the rule; show a one-time tooltip on first encounter after upgrade |
| Phosphor icons don't match existing visual weight on dense screens | Low | Prototype both weights in D6 before commit |
| FrontmatterHeader split breaks property editing edge cases | Medium | Keep the same public API surface for the panel; tests before split |
| Zoom grid calculation stutters on low-end hardware | Low | Cache grid calculation; redraw only on zoom-level threshold crossing |

## 6. Definition of done — entire arc

- `CanvasView.tsx` under 400 lines; `CanvasToolbar.tsx` under 400 lines; `FrontmatterHeader.tsx` under 300 lines
- No file in `src/renderer/` over 800 lines (except `package-lock.json` obviously)
- Icon system uses exactly one library (Phosphor, one weight)
- Chrome system documented and every panel conforms
- Tab model documented and every panel conforms
- Keyboard-only user can reach every data point in the graph
- Zoom-aware canvas grid provides wayfinding at every zoom level
- Pass 2 final rescoring — every surface ≥ 4/5 on every rubric dimension
- Theme × accent matrix verification passes — no visible drift across 48 combinations
- Post-v2 demo video: 5 minutes showing the app on a fresh vault, dense vault, keyboard-only navigation, theme switching. This is what a tier-1 reviewer would watch before offering feedback.

## 7. Handoff to v3 (if needed)

After v2 ships, the next arc is about differentiators, not polish. Candidates:
- D5a cluster-collapsed graph default
- D4a universal tabs
- Agent system UX (now that canvas is decomposed — agent sessions could become first-class canvas objects)
- Collaborative features
- Export / publishing (a Machina vault → static site workflow)
- Inline semantic search ("find notes that argue the opposite of this one")

None of these are required to pass a tier-1 review — v1.2 cleared that bar. v2 raises the floor. v3+ is product expansion.
