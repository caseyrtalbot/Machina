# Canvas

**Files:** `src/renderer/src/panels/canvas/CanvasView.tsx`, `CanvasToolbar.tsx`, `CanvasMinimap.tsx`
**Screens captured:** sparse state (2 terminals, 2 agent pills); medium-density state (8 `note` cards with connections, minimap populated, TENSIONS sidebar surfaced). Dark theme, default accent. Missing: dense (885+ nodes), all 12 card types, split editor, connection draw, selection, hover, all themes.
**Canonical tasks:** (1) spatially arrange notes and artifacts; (2) spawn & monitor agent sessions; (3) run terminals / embedded tools against the vault.

## Rubric scores (partial — one screenshot, one theme)

| Dimension | Score | Note |
|-----------|-------|------|
| IA                     | 3/5 | Sidebar chrome dominates; canvas primary object recedes |
| Visual hierarchy       | 2/5 | Two terminals, two agent badges float in a void with no anchoring structure |
| Typography             | 3/5 | Terminal font legible but small at 50% zoom; no distinction between card types visible |
| Density & whitespace   | 2/5 | Too sparse in this state — no structure tells you "this is where things go" |
| Color & theming        | 4/5 | Restrained, on-brand; agent status pills (`Librarian`/`Curator`) read as intended |
| Motion & feedback      | n/a | Static capture |
| Interaction design     | 2/5 | Toolbar icon-only, no tooltips visible, no labels in sparse state |
| Consistency            | 3/5 | Agent badges top-right vs toolbar left — two different control models |
| Empty/error/loading    | 2/5 | Sparse state is not an empty state; user gets a void instead of guidance |
| Performance perception | n/a | Not observable in still |
| Accessibility          | 2/5 | See Pass 1 F-static-06/07 — applies in force here |
| UX copy                | 3/5 | Agent badge copy is OK; no other copy visible |
| Platform fit           | 4/5 | Traffic lights, window chrome correct |

## Findings

### F-canvas-01 — Sparse-but-not-empty state is the weakest surface in the app
- **Severity:** P0
- **Dimension:** Empty/error/loading, Visual hierarchy
- **Evidence:** screenshot 1 — 2 terminals + 2 agent badges in ~90% empty canvas
- **Observation:** this is not an empty state (content exists) but the content density doesn't earn the viewport it occupies. A first-time viewer sees a mostly-blank grid and has no idea what the canvas is *for*.
- **Impact:** this is the screen a reviewer at Linear/Notion/Figma will land on first. The canvas is your headline object. Right now it's a tech demo, not a product surface.
- **Recommendation:** three layered fixes, in order —
  1. **Add a low-density guidance layer** when fewer than N nodes exist — a dim, centered "Drag a note here. Right-click to add a terminal, PDF, or agent" with three inline affordances. Fade out at ~4+ nodes.
  2. **Anchor active agents.** "Librarian" / "Curator" badges floating top-right read as system chrome, not canvas content. Either place them *on the canvas* (as cards showing live status, the real agent output) or dock them into a dedicated "Agents" region alongside the toolbar. Floating in negative space is the worst of both.
  3. **Add a subtle cluster label** above sparse groups — even "2 terminals" as a faint annotation above the pair would read as *intentional composition*, not orphaned widgets.
- **Effort:** M
- **Refactor?** yes, lightly — sparse-state overlay is a new component; requires `useCanvasNodeCount` or similar.

### F-canvas-02 — Toolbar has no tooltips / no text affordances at rest
- **Severity:** P0
- **Dimension:** Interaction design, Accessibility
- **Evidence:** left-edge toolbar shows ~11 icon-only buttons with no labels visible. Per Pass 1 F-static-06, most canvas buttons lack `aria-label`.
- **Observation:** user has to hover each icon, one at a time, to learn the toolbar. Power users memorize; first-timers bounce.
- **Recommendation:**
  - Ensure every button has a `Tooltip` wrapper with consistent 200ms delay and keyboard shortcut hint ("Add card · N").
  - Consider a "labels on first run" mode — labels show for the first 3 sessions, then condense to icons. Figma and Linear both do this.
- **Effort:** S
- **Refactor?** no

### F-canvas-03 — Zoom indicator (`50%`) has no context
- **Severity:** P2
- **Dimension:** IA, UX copy
- **Evidence:** `50%` chip mid-toolbar
- **Observation:** a bare percentage is a number, not an affordance. Click to reset to 100%? Scroll to zoom? Command palette to zoom to fit?
- **Recommendation:** make it a button with a dropdown: `50% ▾ → [100%, Fit all, Zoom to selection]`. Figma's pattern is the reference.
- **Effort:** S

### F-canvas-04 — Agent badges (`Librarian`, `Curator`) conflate two concerns
- **Severity:** P1
- **Dimension:** IA, Consistency
- **Evidence:** screenshot 1 top-right — two pills with green dots
- **Observation:** these badges look like status indicators but they're persistent across panels, meaning they act as global agent launchers/monitors. The green dot reads "online" but what the user actually wants is "click to see what they're doing right now."
- **Recommendation:** decide whether these are **launchers**, **status**, or **live session windows**. Pick one affordance and commit. Today they read as all three simultaneously. If they're launchers, collapse to a single "Agents" button that opens a popover. If they're status, move them to the activity bar. If they're windows, anchor them as dockable panels with resize affordance.
- **Effort:** M
- **Refactor?** yes — touches agent-system integration with the canvas

### F-canvas-05 — Grid dots are underpowered as a wayfinding device
- **Severity:** P2
- **Dimension:** Visual hierarchy, IA
- **Observation:** the grid at this opacity (configurable via `gridDotVisibility` in `theme.environment`) is nearly invisible at 50% zoom. It's doing none of the "this is infinite canvas" pedagogy that Figma/tldraw/Miro rely on.
- **Recommendation:** at low zoom levels, render a major/minor grid (every 100px subtle, every 500px slightly stronger). At least consider a center crosshair or "origin" indicator so users understand where 0,0 is. Figma's dot pattern shifts based on zoom — mirror that.
- **Effort:** M — touches Pixi render layer

### F-canvas-06 — Minimap (bottom-right) is unlabeled and decontextualized
- **Severity:** P2
- **Dimension:** IA, Consistency
- **Evidence:** minimap shows one green square in an otherwise empty gray box
- **Observation:** minimap has no frame title, no "100%" viewport indicator, no click-to-navigate affordance hint.
- **Recommendation:** frame it with a 10px label "MINIMAP" matching your `floatingPanel.glass.sectionLabel` token. Add a click-to-jump affordance. Consider hiding it when the node count doesn't justify it (< 20 nodes is a waste of pixels).
- **Effort:** S

## Delight opportunities

- **Card entrance motion** — when a new card is added, scale-from-80% with 200ms ease. Already have `transitions.default` ready.
- **Agent session as spatial thread** — as the agent works, its thoughts could leave a trail (connections or annotations) that visualizes the session *as a canvas artifact*.
- **Intelligent auto-arrange** when user requests — "organize by type" or "cluster related" with a 400ms settle animation.
- **Holding Space** to pan — standard in Figma/tldraw. If not present, add.

## What was not captured

- Dense state (885+ nodes) — critical for judging performance perception and LOD
- All 12 card types rendered together — critical for visual hierarchy consistency
- Selection state, marquee, connection draw, drag-from-sidebar, split editor
- Hover, focus, and active states on toolbar
- Themes other than dark default

Re-run this critique once screenshots of the dense state, card-type gallery, and an active selection are captured.

---

## Addendum — medium-density capture (8 notes, connections, minimap active)

A second capture with real content substantially changes the picture. The canvas with *anything on it* is a different product than the canvas empty. Most sparse-state critiques still stand (F-canvas-01, -02, -04 unchanged), but the craft of the card itself is revealed to be strong.

### Revised rubric scores (dense state)

| Dimension | Sparse | Dense | Note |
|-----------|-------:|------:|------|
| Visual hierarchy       | 2/5 | 4/5 | Card title treatment is excellent; body italic intro echoes editor pattern |
| Typography             | 3/5 | 5/5 | Title weight, body measure, italic descriptions all on tier-1 par |
| Density & whitespace   | 2/5 | 4/5 | Card internal padding is comfortable; inter-card gaps generally correct |
| Interaction design     | 2/5 | 3/5 | Cards read as objects now; connections still uninteractive-looking |
| Consistency            | 3/5 | 4/5 | Card template repeats cleanly across 8 instances |

### New findings from the dense capture

#### F-canvas-07 — Type chip in card header duplicates the title
- **Severity:** P1
- **Dimension:** Density & whitespace, UX copy
- **Evidence:** `Build Error Resolver` card has a header chip reading `BUILD ERROR RESOLVER` and a title `Build Error Resolver`. Same for Development Skills, Codex Reviewer, Database Reviewer, Agents Overview, Security Reviewer, Performance Engineer.
- **Observation:** the chip is presumably the note's type or source file name, but when it matches the title it reads as a stutter. The one card where this works is `Claude Code Ecosystem: Command Center` — its chip reads `COMMAND CENTER` (a shorter parent-frame label), not the full title. That's the better model.
- **Recommendation:**
  - If the chip is the type/category — show only when it differs from the title, or always show the type name (e.g., `NOTE`, `AGENT`, `SKILL`) rather than the title. The accent-green chip should carry *category*, not a duplicate string.
  - Today on screen: `NOTE` chip on Command Center, `DEVELOPMENT SKILLS` chip on Development Skills card, `BUILD ERROR RESOLVER` chip on Build Error Resolver card — three different semantics in one view. Pick one.
- **Effort:** S

#### F-canvas-08 — Connection lines lack direction and strength
- **Severity:** P1
- **Dimension:** Visual hierarchy, IA
- **Evidence:** thin dotted lines run between several cards (Build Error Resolver→Database Reviewer, Claude Code Ecosystem→Agents Overview, Database Reviewer→Performance Engineer, etc.)
- **Observation:** the connections are technically rendered but carry no information beyond "these two are connected." No arrowhead, no edge kind color (from `EDGE_KIND_COLORS`), no hover state visible. The user can't answer "what relationship?" without clicking.
- **Impact:** half of the canvas's value is the relationship layer. Right now connections are visual noise — subtle enough to ignore, unclear enough to be useless when noticed.
- **Recommendation:**
  - Apply `EDGE_KIND_COLORS` (already in the token system) to edges by kind — `connection` slate, `causal` pink, `imports` blue, etc. Even at 20% opacity the color differences land.
  - Add subtle arrowheads for directional edges (`derived_from`, `references`, `imports`, `causal`).
  - On card hover, fade unrelated edges to 10% and emphasize connected edges to 100%. Figma's pattern.
  - On connection hover, a small tooltip with the edge kind.
- **Effort:** M

#### F-canvas-09 — Card width is unbounded; narrow-tall cards hurt readability
- **Severity:** P2
- **Dimension:** Density & whitespace, Typography
- **Evidence:** `Claude Code Ecosystem: Command Center` and `Agents Overview` render as narrow columns (≈230px wide, 300+px tall). Line measure drops to ~25 characters — awkward for reading prose.
- **Observation:** users presumably set card width themselves. Good default behavior would clamp width to a reading-comfortable range (≈320–560px for body prose) and let users override explicitly.
- **Recommendation:**
  - Default new card widths to ≥360px for any card containing body prose (note/text/markdown).
  - Add a "reflow to readable width" command on card right-click.
  - Optionally warn in the card LOD renderer when measure drops below 30 characters.
- **Effort:** S

#### F-canvas-10 — Minimap now earns its pixels (keep this)
- **Severity:** n/a (positive finding)
- **Dimension:** IA
- **Evidence:** minimap shows 6 blue squares corresponding to the card cluster — confirms orientation at a glance.
- **Observation:** F-canvas-06 flagged the empty minimap as wasteful; with content, the minimap does its job. The "hide when node count doesn't justify it" recommendation still holds — show it from ≥5 nodes.

#### F-canvas-11 — `TENSIONS` appears in the sidebar but floats detached from the canvas
- **Severity:** P1
- **Dimension:** IA, Consistency, Visual hierarchy
- **Evidence:** sidebar top now shows a `TENSIONS` section with two rows ("Dual-Use Entry vs Defense-First", "Scaffolding vs Friction — When Co…"), each with a red dot indicator.
- **Observation:** **tensions are a signature feature** (`system-artifacts/tensions/`, `EDGE_KIND_COLORS.tension`, `ARTIFACT_COLORS.tension`). Surfacing them in the sidebar is the right instinct. But:
  - They're placed in a file-tree-adjacent sidebar, disconnected from the canvas they describe.
  - The red-dot indicator is semantic (tension/warning) but isn't echoed on the canvas — a user can't tell *which cards* the tension spans.
  - Clicking a tension row presumably opens the tension note, not a canvas navigation/highlight.
- **Impact:** the tension system is narrating a finding *about* the canvas without *using* the canvas to show it. That's a missed anchoring opportunity in the app's most important spatial surface.
- **Recommendation:**
  - Clicking a tension row should **focus the canvas** on the cards involved — pan, zoom, and highlight with the `tension` amber edge kind between them (`EDGE_KIND_COLORS.tension` already exists). A "tension mode" overlay.
  - On the canvas proper, render a subtle amber glow around any card currently participating in a tension. Hover shows the tension description.
  - Consider the tension not as a *file in the sidebar* but as a *first-class canvas annotation* — like a PR comment that lives on the code it references.
- **Effort:** M — the data and colors exist; this is a visualization and interaction binding

---

## New surface flagged — `TENSIONS` sidebar section

Not yet screenshotted in isolation. Deserves its own per-surface report once captured — click-state, hover-state, what happens when you have 20 tensions, empty state. Add to Pass 2 queue.
