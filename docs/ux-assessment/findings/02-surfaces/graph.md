# Graph

**Files:** `src/renderer/src/panels/graph/GraphPanel.tsx`, `graph-label-layer.ts`, `GraphSettingsPanel.tsx`, `GraphDetailDrawer.tsx`
**Screens captured:** default force-layout resting state, dark theme, 467 nodes / 2160 edges at 51% zoom. Missing: hover neighborhood, pinned subgraph, empty vault, detail drawer open.
**Canonical tasks:** (1) understand the shape of the vault; (2) find dense clusters or outliers; (3) navigate from the graph to a specific note.

## Rubric scores

| Dimension | Score | Note |
|-----------|-------|------|
| IA                     | 3/5 | Clear primary object, but no legend, no filter controls surfaced |
| Visual hierarchy       | 4/5 | Graph earns the viewport; chrome is restrained |
| Typography             | 4/5 | Meta chip and hint copy are well-weighted |
| Density & whitespace   | 3/5 | Hair-ball at this scale; no tools to cut through density |
| Color & theming        | 5/5 | **Best surface in the app.** OKLCH palette lands beautifully |
| Motion & feedback      | n/a | Static |
| Interaction design     | 3/5 | Hint copy teaches hover; no discovery path for drag/zoom/filter |
| Consistency            | 4/5 | Meta chip + hint chip + settings gear form a coherent top chrome |
| Empty/error/loading    | n/a | Not captured |
| Performance perception | n/a | Not observable |
| Accessibility          | 2/5 | Canvas-only rendering; no keyboard graph traversal implied |
| UX copy                | 4/5 | "Hover to isolate neighborhoods. Drag to compare clusters." is excellent — teaches without talking down |
| Platform fit           | 4/5 | — |

## Findings

### F-graph-01 — No legend, so the color palette does half its job
- **Severity:** P1
- **Dimension:** IA, UX copy
- **Evidence:** screenshot 2 — orange, blue, pink, cyan, yellow, green, gray nodes with no mapping
- **Observation:** the palette is genuinely beautiful. But a user can't *use* it without knowing what each color encodes (artifact type). Color is pulling weight but not communicating.
- **Impact:** the graph is currently a decorative object. With a legend it becomes a diagnostic one.
- **Recommendation:** add a persistent legend bottom-left (mirroring the `ENRICHMENT` hint position). Compact rows: swatch + type name + count — e.g. `● note 87 · ● session 42 · ● pattern 15 …`. Clickable rows toggle visibility. Use your existing `ARTIFACT_COLORS` and `getArtifactColor()`. Collapse to a single "Legend" button that expands on click if the panel feels too busy.
- **Effort:** M

### F-graph-02 — `ENRICHMENT` hint is a brilliant pattern placed awkwardly
- **Severity:** P2
- **Dimension:** IA, Visual hierarchy
- **Evidence:** `ENRICHMENT | 3 files still need metadata. Run /connect-vault` bottom-center
- **Observation:** this is the kind of contextual, action-oriented hint top teams ship. It's wasted floating in mid-space with no anchor. A reviewer will wonder: is this a toast? A hint? A status bar?
- **Recommendation:** make it a consistent "graph status bar" that spans the bottom — 32px tall, glass material, left-aligned "count / zoom / selected", right-aligned status hint. When no hint, it's just stats. This turns a one-off chip into a pattern that scales for future status ("24 nodes pinned", "Filter: untagged", etc.).
- **Effort:** S

### F-graph-03 — Top chrome chips (`467 nodes | 2160 edges`) don't tell me what matters
- **Severity:** P2
- **Dimension:** IA, UX copy
- **Evidence:** meta chip top-left
- **Observation:** node/edge count is a graph-nerd metric. A product user wants: "How much of my vault is connected? What's isolated? How big is the largest cluster?"
- **Recommendation:** replace raw counts with a **graph health summary**: "467 notes · 12 clusters · 38 isolated." Clicking each term filters. The raw counts go into the settings panel for people who want them.
- **Effort:** M — requires a cluster count service, but the data is already computed

### F-graph-04 — Hair-ball layout at this scale is the default experience
- **Severity:** P1
- **Dimension:** Density & whitespace, IA
- **Evidence:** screenshot 2 — nodes overlap aggressively
- **Observation:** force-directed on 467 nodes without any pre-clustering always looks like this. The product surface is the algorithm, not a decision.
- **Recommendation:**
  - **Default to cluster-collapsed view** — represent dense clusters as single "super-nodes" by default; expand on click. User sees ~20 meaningful groups on first render, not 467 overlapping dots.
  - **Add a "Focus" mode** — on click of any node, fade everything beyond 2 hops to 15% opacity and recenter. This is tldraw's pattern for complex canvases.
  - **Keep current force layout as a toggle**, not the default.
- **Effort:** L — requires clustering pass upstream, but you already have cluster edge types

### F-graph-05 — No keyboard path to the graph
- **Severity:** P1
- **Dimension:** Accessibility
- **Observation:** force-directed graphs are canvas-only; a keyboard-only or screen-reader user is locked out. This is a known hard problem, but not an excuse for doing nothing.
- **Recommendation:** provide a keyboard-accessible alternative entry — "List clusters" / "List isolated notes" text views reachable from the graph. These aren't the same experience, but they make the data addressable without a mouse.
- **Effort:** M

### F-graph-06 — Fit All / zoom chip bottom-left is small and orphaned
- **Severity:** P2
- **Dimension:** IA, Visual hierarchy
- **Evidence:** `Fit All` / `51%` bottom-left
- **Recommendation:** fold into the graph status bar (F-graph-02). Currently it's a third bottom-area UI, competing with the enrichment chip and floating unanchored.
- **Effort:** S — bundled with F-graph-02

## Delight opportunities

- **Hover echo** — on hover, a subtle concentric ripple emanates from the node. 200ms, once. Confirms the hit without noise.
- **Cluster breathing** — dense clusters pulse very slowly (2% scale, 4s cycle) so the graph feels alive without being distracting. Skip if `prefers-reduced-motion`.
- **"Jump to recent"** — keyboard shortcut to pan the graph to the node you were editing 10 seconds ago. Solves the "I lost my place" problem without a search.
- **Tension edges get a shimmer** — `tension` edges (the dissonance-detection feature) could visually shimmer subtly; this is a signature feature and deserves a signature visual.

## What was not captured

- Empty vault state
- Hover neighborhood highlight (critical — the hint copy promises this)
- Pinned subgraph / focused mode
- Detail drawer open (`GraphDetailDrawer.tsx` exists)
- Settings panel opened (gear top-right)

Re-run after capturing hover + pinned + drawer states.
