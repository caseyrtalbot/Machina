# Machina — UX Roadmap (Pass 5 synthesis)

This is the output of Passes 1 and 2, rolled into themes and sequenced into releases. Passes 3 (flows) and 4 (a11y deep-dive) are not yet run; findings likely to emerge there are listed in §6 so the roadmap can absorb them without reshuffle.

## 0. TL;DR

Machina today is a tier-1 craft object with a tier-2 product surface. The typography, color system, and spatial instincts are already on par with Linear, Notion, Cursor, Anthropic. The gaps are in **accessibility primitives, state coverage, cross-surface consistency, and a handful of weak screens (Health, sparse Canvas) that a reviewer would land on**.

A focused ~8-week polish arc fixes the weak surfaces without touching architecture. A follow-up 6-week refactor arc unlocks the next ceiling. Neither requires a rewrite.

**The three things that would change a tier-1 reviewer's verdict tomorrow:**
1. Accessibility sweep (aria-labels + global focus-visible + reduced-motion) — 3–5 days of focused typing.
2. Health panel redesigned as a product, not a log — ~1 week.
3. Tension system anchored to the canvas visually — ~3 days given tokens already exist.

---

## 1. Themes

The 61 findings cluster into ten themes. Every finding in the appendix carries a theme tag so progress per theme is measurable.

| # | Theme | Findings | What it buys you |
|---|-------|----------|------------------|
| T1 | **Accessibility foundation** | F-static-06, -07, -08, -09; F-graph-05 | Passes WCAG 2.1 AA; unlocks enterprise/ship-to-anyone readiness |
| T2 | **Token adherence sweep** | F-static-01, -02, -03, -04, -05; F-cross-05 | Theme parity across all 6 themes; kills "feels buggy on theme X" reports |
| T3 | **Shared state primitives** | F-static-10, -11; F-cross-06 | Every empty/loading/error screen stops being a lottery |
| T4 | **Health as product** | F-health-01 through -07 | Fixes the single worst screen in the app |
| T5 | **Sidebar contextualization** | F-cross-01, -07, -08 | Removes the single biggest sidebar friction point |
| T6 | **Canvas surface polish** | F-canvas-01, -02, -03, -04, -05, -06, -07, -08, -09 | Turns canvas from tech demo to headline product |
| T7 | **Graph completeness** | F-graph-01, -02, -03, -04, -06 | Turns the graph from decoration into a diagnostic tool |
| T8 | **Ghosts to action** | F-ghosts-01, -02, -03, -04, -05, -06 | Closes the loop — surfaces become fixes |
| T9 | **Tension anchoring** | F-canvas-11, F-cross-09 | Makes the signature feature visible where it matters |
| T10 | **Architecture unblocks** | F-static-12, -13, -14, -15; F-cross-02, -03, -04 | Decomposes the three files that cap polish ceiling |

---

## 2. Prioritized backlog (all findings)

Sorted by **(Severity × Impact) / Effort**, with theme tag, effort (S / M / L), and type (Polish / Upgrade / Refactor).

### P0 — ship blockers for a tier-1 review

| ID | Theme | Summary | Effort | Type |
|----|-------|---------|-------:|------|
| F-static-06 | T1 | Sweep `aria-label` onto every icon-only button (140 buttons, 25 labels today) | M | Polish |
| F-static-07 | T1 | Global `:focus-visible` treatment using accent token; audit `outline: none` removals | S | Polish |
| F-canvas-01 | T6 | Sparse-state guidance layer on canvas; anchor agent badges | M | Upgrade |
| F-canvas-02 | T6 | Tooltips + shortcut hints on every canvas toolbar icon | S | Polish |
| F-health-01 | T4 | Rewrite Health panel as product — verbs, actions, friendly copy | L | Upgrade |
| F-health-02 | T4 | Severity encoding (critical/warning/info) with token colors | M | Polish |
| F-editor-02 | — | Fix orphan "P" content bug in Security Reviewer note (and sweep similar) | S | Content |

### P1 — changes that separate good from tier-1

| ID | Theme | Summary | Effort | Type |
|----|-------|---------|-------:|------|
| F-cross-01 | T5 | Contextual (or at minimum collapsible) sidebar per panel; kill Daily Notes default on Graph/Canvas/Health | M | Upgrade |
| F-cross-09 / F-canvas-11 | T9 | Tension click → canvas focus + amber edge/card overlay using existing tokens | M | Upgrade |
| F-static-05 | T2 | Extend `floatingPanel.glass` → full `glass.*` token family; migrate `rgba(255,255,255,..)` call sites | M | Refactor |
| F-static-10 | T3 | Build shared `<PanelState kind="empty\|loading\|error">` primitive; port Canvas → Graph → Workbench → Ghosts | M | Upgrade |
| F-static-11 | T3 | Redesign `PanelErrorBoundary` as a product surface ("Machina hit a snag. Here's what and how to report.") | M | Upgrade |
| F-static-08 | T1 | Wire `aria-labelledby` on every `role="dialog"`; verify focus trap | S | Polish |
| F-static-09 | T1 | Add `prefers-reduced-motion` strategy + `useReducedMotion()` hook gating Pixi/graph animations | M | Upgrade |
| F-static-01 | T2 | Replace `#eab308` conflict banner with `colors.claude.warning` (or new `status.warning`); extract `<Banner>` primitive | S | Polish |
| F-static-02 | T2 | Replace hardcoded `#f87171`/`#ef4444` with `colors.claude.error` | S | Polish |
| F-canvas-08 | T6, T9 | Connection edges get kind-based color (from `EDGE_KIND_COLORS`) + arrowheads + hover emphasis | M | Upgrade |
| F-canvas-04 | T6 | Resolve agent-badge role (launcher vs status vs window); pick one affordance | M | Upgrade |
| F-canvas-07 | T6 | Fix type-chip duplication of title across card types; standardize to category | S | Polish |
| F-graph-01 | T7 | Persistent legend bottom-left; click rows to filter by type | M | Upgrade |
| F-graph-02 | T7 | Unified graph status bar (count · zoom · selection · hint) at bottom | S | Upgrade |
| F-graph-03 | T7 | Replace raw node/edge counts with health summary (clusters · isolated) | M | Upgrade |
| F-graph-04 | T7 | Default to cluster-collapsed view; force-layout as an explicit toggle | L | Upgrade |
| F-graph-05 | T1 | Keyboard-accessible alternative graph entry (list clusters / isolated) | M | Upgrade |
| F-ghosts-01 | T8 | Hero `201` becomes interactive — opens summary modal or filters | M | Upgrade |
| F-ghosts-02 | T8 | Popover anchor to row (tail + row highlight) | S | Polish |
| F-ghosts-04 | T8 | "Create note" affordance per row + in popover; promotion animation | M | Upgrade |
| F-editor-01 | — | Remove `TXT`/`NUM`/`LIST` type chips from frontmatter display | S | Polish |
| F-editor-04 | — | Unified dirty-indicator + close control on tabs; remove/relabel top-right `×` | S | Polish |
| F-editor-06 | — | Elevate backlinks above the footer strip (right rail or above fold) | M | Upgrade |
| F-health-03 | T4 | Hero-number header on Health panel matching Ghosts pattern | S | Polish |
| F-health-04 | T4 | Group issues by file by default; expand to see per-issue | M | Upgrade |
| F-health-06 | T4 | Filter + search bar on Health panel | M | Upgrade |
| F-static-12 | T10 | Decompose `CanvasView.tsx` (1049 lines, 13 useEffects) into hooks | L | Refactor |
| F-static-13 | T10 | Extract `CanvasToolbarButton` primitive with variants | M | Refactor |
| F-cross-02 | T10 | Decide and document tab model (Obsidian vs VSCode); align panels | L | Refactor |
| F-cross-03 | T10 | Three-zone chrome system (top strip · bottom strip · edge rails) + retrofit | L | Refactor |
| F-cross-06 | T3 | Add one-line panel-purpose copy to every empty/sparse state | M | Polish |
| F-cross-07 | — | Surface command palette affordance in shell chrome (not just `⌘K`) | S | Polish |
| F-editor-05 | — | Single type-indicator pattern across canvas/editor/sidebar | M | Upgrade |

### P2 — consistency hygiene and delight

| ID | Theme | Summary | Effort | Type |
|----|-------|---------|-------:|------|
| F-static-03 | T2 | `useClaudeContext` amber dot → `colors.claude.warning` | S | Polish |
| F-static-04 | T2 | `CardLodPreview` slate → `colors.text.secondary` | S | Polish |
| F-static-14 | T10 | Split `FrontmatterHeader.tsx` (740 lines) | M | Refactor |
| F-static-15 / F-cross-04 | T10 | Standardize icon system on Phosphor; retire inline SVGs | M | Polish |
| F-cross-05 | T2 | `<SectionLabel>` component consolidating small-caps usage | S | Polish |
| F-cross-08 | — | Vault picker: hover tooltip for truncated paths; label the yellow dot | S | Polish |
| F-canvas-03 | T6 | Zoom indicator becomes dropdown (100% / Fit / Zoom to selection) | S | Polish |
| F-canvas-05 | T6 | Zoom-aware major/minor grid; origin indicator | M | Upgrade |
| F-canvas-06 | T6 | Minimap: label, click-to-jump, auto-hide under 5 nodes | S | Polish |
| F-canvas-09 | T6 | Clamp default card width ≥360px for prose; add "reflow" command | S | Polish |
| F-graph-06 | T7 | Fold Fit/zoom chip into the new status bar | S | Polish (bundled) |
| F-ghosts-03 | T8 | Section label counts (`FREQUENTLY REFERENCED · 12`) | S | Polish |
| F-ghosts-05 | T8 | Popover shows "+ N more" when reference list truncates | S | Polish |
| F-ghosts-06 | T8 | Per-tier row cue (weight/color) to distinguish ranks | S | Polish |
| F-editor-03 | — | Stronger `+ add connection` / `+ add property` affordances | S | Polish |
| F-health-05 | T4 | Labeled `Recheck` button + last-run time | S | Polish |
| F-health-07 | T4 | Consolidate section axis (severity OR category, not both) | S | Polish |

---

## 3. Release sequence

Three arcs. Each ends with a screenshot-level review against the rubric and a demo-able story.

### v1.1 — Polish arc (2 weeks, ~60 eng-hours)

**Goal:** pass a cold design review on every screen a reviewer might land on.

**Scope:** every S-effort finding, plus the two M-effort must-dos that break the tier-1 barrier.

1. **Day 1–2 — Accessibility strike** (T1)
   - `aria-label` sweep (F-static-06)
   - Global `:focus-visible` (F-static-07)
   - Dialog `aria-labelledby` (F-static-08)
2. **Day 3 — Token hygiene** (T2)
   - F-static-01, -02, -03, -04 (hex → token)
   - F-cross-05 (SectionLabel consolidation)
3. **Day 4–5 — Canvas & Editor polish**
   - F-canvas-02 (tooltips)
   - F-canvas-03, -06 (zoom dropdown, minimap label)
   - F-canvas-07 (type chip stutter)
   - F-canvas-09 (card width default)
   - F-editor-01 (TXT/NUM chips removed)
   - F-editor-02 (orphan P + sweep)
   - F-editor-03, -04 (affordances)
4. **Day 6–7 — Ghosts + Health polish**
   - F-ghosts-02, -03, -05, -06 (popover anchor, counts, truncation, tier cues)
   - F-health-05, -07 (recheck affordance, section axis)
5. **Day 8 — Cross-cutting S-wins**
   - F-cross-07 (command palette affordance)
   - F-cross-08 (vault picker tooltip)
6. **Day 9–10 — Review, rescreenshot, document**
   - Rerun Pass 2 captures against the rubric; publish `findings/02-surfaces/*-v1.1.md` before/after pairs.

**Demo story after v1.1:** "Every icon has a name. Every button is keyboard-reachable. Every color is a token. Every dialog labels itself. The seams are sanded."

### v1.2 — Upgrade arc (4–6 weeks, ~200 eng-hours)

**Goal:** the three product-level fixes that move the verdict from "impressive" to "ship."

1. **Week 1 — Shared state primitives** (T3)
   - `<PanelState>` primitive (F-static-10)
   - `PanelErrorBoundary` redesign (F-static-11)
   - Panel-purpose copy everywhere (F-cross-06)
2. **Week 2 — Health panel redesign** (T4)
   - F-health-01 (full rewrite around verbs)
   - F-health-02 (severity system)
   - F-health-03 (hero header)
   - F-health-04 (file grouping)
   - F-health-06 (filter bar)
3. **Week 3 — Sidebar contextualization** (T5)
   - F-cross-01 — at minimum collapsible; ideally contextual
4. **Week 4 — Tension anchoring + connections** (T9)
   - F-canvas-08 (edge kind colors + arrows)
   - F-canvas-11 / F-cross-09 (tension click → canvas focus)
5. **Week 5 — Graph completeness** (T7)
   - F-graph-01 (legend)
   - F-graph-02, -06 (status bar)
   - F-graph-03 (health summary)
6. **Week 6 — Ghosts to action** (T8)
   - F-ghosts-01 (hero action)
   - F-ghosts-04 (promote-to-note)
   - F-editor-05 (unified type-indicator pattern)
   - F-editor-06 (backlinks elevation)

**Demo story after v1.2:** "Every signal routes to an action. Every screen teaches. Tensions show up where they live — on the canvas. Ghosts don't just exist — they can be promoted. Health isn't a log, it's a checklist."

### v2 — Architecture arc (4–6 weeks, ~200 eng-hours)

**Goal:** raise the polish ceiling by decomposing the files that cap it today.

1. **Week 1–2 — Canvas decomposition** (T10)
   - F-static-12 (`CanvasView.tsx` → hooks)
   - F-static-13 (`CanvasToolbarButton` primitive — unblocks toolbar polish)
   - F-canvas-04 (agent-badge role decision, now feasible)
2. **Week 3 — Graph architecture**
   - F-graph-04 (cluster-default layout; gated behind cluster service)
   - F-graph-05 (keyboard-accessible alternative)
3. **Week 4 — Chrome system**
   - F-cross-03 (three-zone chrome) documented + retrofitted
   - F-cross-02 (tab model aligned)
4. **Week 5 — Icon system + remaining refactors**
   - F-cross-04 / F-static-15 (Phosphor everywhere)
   - F-static-14 (FrontmatterHeader split)
5. **Week 6 — Sparse-canvas upgrade**
   - F-canvas-01 (now easier with CanvasView decomposed)
   - F-canvas-05 (zoom-aware grid)

**Demo story after v2:** "The pieces know their names. Polish is no longer bounded by a 1049-line component. Adding a canvas surface or a new panel chrome is a day of work, not a week."

---

## 4. The four tier-1 review questions (pre-answered)

From §7 of the plan — the questions a reviewer at Notion / Anthropic / Cursor will ask.

| Question | Today | After v1.1 | After v1.2 |
|----------|-------|------------|------------|
| **Core loop obvious in under 60 seconds?** | No — sparse canvas is a void | Partial — guidance layer in empty states | Yes — panel-purpose copy + PanelState primitive |
| **Does every state exist and teach?** | No — only 7 panels have named empty/loading/error | Partial — S-fixes tighten known states | Yes — PanelState primitive applied everywhere |
| **Does it feel native on macOS?** | Mostly — traffic lights, fonts, restraint | Yes | Yes |
| **Embarrassed to demo any screen cold?** | Yes — Health, sparse Canvas | No — Health rescored, Canvas guidance added | No — every surface has been reviewed |

**The bar gets cleared at the end of v1.2.** v2 is not required to pass a tier-1 review; it raises the floor for future polish velocity.

---

## 5. Risks & open questions

1. **Pass 3 (flows) and Pass 4 (a11y deep-dive) not yet run.** Expect ~15–25 additional findings — likely clustered in onboarding, first-vault-open, keyboard-only navigation, and screen-reader behavior on complex dialogs. Budget 10–20% buffer in each arc.
2. **Dense canvas (885+ nodes)** not captured. Performance-perception findings (60fps on pan/zoom, LOD thresholds, memory under pressure) absent from current roadmap.
3. **Theme parity.** All captures so far are dark default theme + default accent. A theme × accent matrix (6 × 8 = 48 combinations) will surface token drift that grepping alone misses.
4. **Canvas refactor blast radius.** `CanvasView.tsx` decomposition is intentionally in v2, not v1.2, because canvas is the riskiest surface to regress during an upgrade cycle. If polish findings accumulate that *require* refactoring first, reconsider.
5. **Sidebar contextualization is a big call.** Going from "same sidebar everywhere" to "contextual per-panel" is a UX decision with users who may have developed habits. Ship behind a setting first; make contextual the default in the next release.

---

## 6. Findings not yet known — passes still to run

Pass 3 and 4 will produce findings that can fit into this roadmap without reshuffle. Expected buckets:

**Pass 3 — Flows (to capture):**
- First-run vault selection → first note → first canvas card
- Search → open → edit → save → reopen
- Ghost → promote → see on canvas → see in graph
- Spawn agent → monitor → resolve
- File conflict (external edit) → reconcile
- Reopen app with 885+ node vault: cold start perceptual latency

**Pass 4 — Accessibility:**
- Full keyboard-only navigation of every panel
- Screen reader smoke test (VoiceOver — macOS native)
- Focus order across dialogs + panels
- Contrast measurements on every theme × accent combination (48)
- `prefers-reduced-transparency` behavior (glass materials)

**New surface flagged — TENSIONS sidebar section.** Pass 2 capture not yet taken; deserves its own report covering list view, hover, click, 20-tension state, empty state.

---

## 7. Next concrete step

If the goal is "ship v1.1 in two weeks": start Day 1 tomorrow with the **accessibility strike**. It's the lowest-risk, highest-leverage batch in the roadmap — zero architectural surface, zero visual regressions possible, and it moves the tier-1 review bar more than any other single batch.

If the goal is "run the remaining passes first": capture Pass 3 flows and Pass 4 a11y sessions this week so v1.1 can absorb their findings in the same polish arc rather than deferring them to v1.2.

Either is defensible. Don't do both in parallel — polish drift during capture is the failure mode.
