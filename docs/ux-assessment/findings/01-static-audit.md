# Pass 1 — Static Audit

**Method:** grep + targeted reads of the renderer. No screenshots. Focus: token adherence, a11y primitives, state-shape hygiene, file size, effect density.

**Top-line:** the token system is well-designed and well-documented, but adherence is partial. Accessibility primitives are thin enough that a keyboard-only user would struggle today. A handful of panels carry too much responsibility and will be hard to polish without first reducing their surface area.

---

## Headline metrics

| Signal | Count | Read |
|---|---|---|
| Renderer files with hardcoded hex (`#RRGGBB`) | 37 | Some legit (design/), but ~30 real violations |
| Renderer files using `rgba()` / `rgb()` | 53 | Overlap with above; many one-off glass effects |
| Inline `style={{...}}` occurrences | 628 across 83 files | Mix of legit (dynamic positions) and drift |
| `<button>` occurrences | 140 across 55 files | Many icon-only; see a11y below |
| `aria-label` occurrences | 25 across 14 files | **~5.6× gap vs buttons** |
| `focus-visible` / `focus:ring` / `outline:` | 4 across 4 files | **Effectively no custom focus rings** |
| `role=` / `tabIndex=` | 19 across 11 files | Sparse; mostly dialogs |
| `prefers-reduced-motion` handling | 2 total | **No systemic motion opt-out** |
| Files > 800 lines (design rule) | 3 | See refactor section |
| `useEffect` occurrences | 121 across 45 files | Dense in `CanvasView` (13), `CanvasToolbar`, `WorkbenchPanel` (8) |

---

## Token adherence (color)

The token system (`design/tokens.ts`, `design/themes.ts`) is principled — OKLCH palette at fixed L/C, CSS variables for structural colors, semantic slots for cluster/tension/claude status. Drift happens when a contributor reaches for a literal hex instead of the right semantic slot.

### Violations with file:line

#### F-static-01 — Editor conflict banner uses hardcoded amber
- **Severity:** P1
- **Files:** [src/renderer/src/panels/editor/EditorPanel.tsx:333-346](src/renderer/src/panels/editor/EditorPanel.tsx:333)
- **Evidence:** `backgroundColor: 'rgba(234, 179, 8, 0.12)'`, `color: '#eab308'` (Tailwind amber-500) — not from any token.
- **Impact:** conflict banner drifts visually from the rest of the app's warning treatment (Claude status, pattern artifacts). Four themes will render this as the same amber while the rest of the app shifts — inconsistency reads as buggy.
- **Recommendation:** use `colors.claude.warning` (`#dfa11a`) or add a proper `colors.status.warning` slot. Extract a `<Banner variant="warning">` primitive — this pattern will repeat (offline, read-only, stale vault, unresolved wikilink).

#### F-static-02 — Canvas toolbar hardcodes destructive red
- **Severity:** P1
- **Files:** [src/renderer/src/panels/canvas/CanvasToolbar.tsx:604](src/renderer/src/panels/canvas/CanvasToolbar.tsx:604), [:755](src/renderer/src/panels/canvas/CanvasToolbar.tsx:755)
- **Evidence:** `'#f87171'` (Tailwind red-400), `'#ef4444'` (Tailwind red-500) applied to "compile running" and "clear" states.
- **Impact:** the app has `colors.claude.error` (`#ff847d`) and `ARTIFACT_COLORS.constraint` for the same semantic. Three different reds will land side-by-side depending on which button you look at.
- **Recommendation:** `colors.claude.error` for running/destructive states; kill the Tailwind reds.

#### F-static-03 — Claude context dot invents its own amber
- **Severity:** P2
- **Files:** [src/renderer/src/hooks/useClaudeContext.tsx:108](src/renderer/src/hooks/useClaudeContext.tsx:108)
- **Evidence:** `backgroundColor: contextError ? '#f59e0b' : colors.text.secondary`
- **Recommendation:** `colors.claude.warning`.

#### F-static-04 — `CardLodPreview` hardcodes slate for text
- **Severity:** P2
- **Files:** [src/renderer/src/panels/canvas/CardLodPreview.tsx:14](src/renderer/src/panels/canvas/CardLodPreview.tsx:14)
- **Evidence:** `text: '#94a3b8'` (Tailwind slate-400) — breaks theme parity. Low-fidelity preview should still theme.
- **Recommendation:** `colors.text.secondary`.

#### F-static-05 — Scattered `rgba(255,255,255,...)` and `rgba(0,0,0,...)` literals
- **Severity:** P1 (systemic)
- **Files:** 53 files; notable density in `panels/canvas/*`, `panels/editor/*`, and dialog components.
- **Pattern:** `rgba(255,255,255,0.06)` for low-contrast fills, `rgba(0,0,0,0.4)` for shadows, handwritten per site.
- **Impact:** these are the actual "glass" layer that defines Machina's look. Every site that draws a different alpha creates a different visual weight. A critique screenshot at 27" will show this as banding or tone inconsistency between, say, the command palette and the canvas minimap.
- **Recommendation:** add a `surface` or `glass` token set to `design/tokens.ts` — e.g. `glass.fill.low` (6% white), `glass.fill.med` (9%), `glass.fill.high` (14%), `glass.shadow.small/medium/large`. Audit call sites and migrate. A single PR can do this without risk — you already have `floatingPanel.glass` partially defined at [tokens.ts:171-185](src/renderer/src/design/tokens.ts:171), so extend and reuse.

---

## Accessibility (P0 cluster)

The app will not pass a WCAG 2.1 AA review in its current state. None of these are hard fixes, but they need a sweep.

#### F-static-06 — ~75% of buttons have no accessible name
- **Severity:** P0
- **Evidence:** 140 `<button>` across 55 files vs. 25 `aria-label` across 14 files. Icon-only buttons dominate the toolbar, canvas, activity bar, and card headers.
- **Impact:** screen reader users hear "button, button, button." Keyboard-only users see a focus ring (when present) with no context.
- **Recommendation:** pass through every panel once and add `aria-label` to every icon-only button. Treat it as a typing task, not a design task. The canvas toolbar ([CanvasToolbar.tsx](src/renderer/src/panels/canvas/CanvasToolbar.tsx)) alone has 19 `rgba()` sites and dozens of icon buttons — start there for the biggest surface-area win.

#### F-static-07 — No systemic focus-visible treatment
- **Severity:** P0
- **Evidence:** 4 files use `focus-visible`/`focus:ring`/`outline:` explicitly — most of the app relies on the browser default focus ring, which is invisible on dark glass surfaces.
- **Impact:** keyboard-only users lose their place after every Tab keystroke.
- **Recommendation:** add a global `:focus-visible` outline in `assets/index.css` using `--color-accent-default` at 2px + 2px offset, with `prefers-reduced-transparency` fallback. Remove any `outline: none` that isn't paired with a custom focus treatment. Verify the canvas pan/zoom doesn't suppress focus on every click.

#### F-static-08 — Dialogs are marked but not labeled
- **Severity:** P1
- **Evidence:** 8 `role="dialog"` sites, 0 `aria-labelledby` usages detected. `SettingsModal` does have `aria-label="Settings"` ([SettingsModal.tsx:164](src/renderer/src/components/SettingsModal.tsx:164)) but most dialogs don't wire their visible title to `aria-labelledby`.
- **Recommendation:** each dialog's visible `<h2>` should have `id="x-title"` and the dialog `aria-labelledby="x-title"`. Add focus-trap verification — none of the dialogs visibly trap focus.

#### F-static-09 — No `prefers-reduced-motion` strategy
- **Severity:** P1
- **Evidence:** 2 total references in the whole repo ([assets/index.css](src/renderer/src/assets/index.css), [AgentThoughtCard.tsx](src/renderer/src/panels/canvas/AgentThoughtCard.tsx)).
- **Impact:** the canvas uses Pixi animations, the graph uses force simulation, transitions are specified via `transitions` tokens in [tokens.ts:118-126](src/renderer/src/design/tokens.ts:118). Users with motion sensitivity get a flashing app.
- **Recommendation:** add a `@media (prefers-reduced-motion: reduce)` block that neutralizes transitions globally, a `useReducedMotion()` hook that gates Pixi tweens and graph physics settling animation, and a Settings toggle to override.

---

## State-shape hygiene (empty / loading / error)

Only 7 panel files reference any of `isLoading`/`isEmpty`/`isError`/`LoadingState`/`EmptyState`/`ErrorState` — and the references are inconsistent naming (not a shared primitive).

#### F-static-10 — No shared empty/loading/error primitives
- **Severity:** P1
- **Observation:** `CanvasEmptyStates.tsx` exists (good), but there's no equivalent for Graph, Workbench, Ghosts, or the Sidebar. Each panel invents its own empty/loading treatment.
- **Impact:** a reviewer opening the app to an empty vault will see three different "nothing here yet" treatments on three tabs. That's the single loudest tell of an uneven design team.
- **Recommendation:** add `design/components/PanelState.tsx` — `<PanelState kind="empty" | "loading" | "error" title description icon action />`. Port Canvas, then Graph, Workbench, Ghosts. Write the copy once, consistently, in a confident-but-teaching voice (see Notion's empty state library for the bar).

#### F-static-11 — `PanelErrorBoundary` exists but copy/style is not reviewed
- **Severity:** P1
- **Files:** [src/renderer/src/components/PanelErrorBoundary.tsx](src/renderer/src/components/PanelErrorBoundary.tsx)
- **Recommendation:** treat this as a product surface. A top-tier team would use this as an opportunity — "Machina hit a snag. Here's what was happening, here's the error, here's how to report it." Today this is default error fallback territory; Pass 2 should score it against the rubric.

---

## Architecture drifts that block polish

These are findings that are really engineering debt but **cause** UX polish limits. Flag them up-front so Pass 5 doesn't pretend they're pure visual fixes.

#### F-static-12 — `CanvasView.tsx` is 1049 lines with 13 useEffects
- **Severity:** P1 (refactor)
- **Files:** [src/renderer/src/panels/canvas/CanvasView.tsx](src/renderer/src/panels/canvas/CanvasView.tsx)
- **Observation:** breaks the 800-line guideline. 13 useEffects is a smell: canvas is juggling viewport state, selection, keyboard shortcuts, drag/drop, split editor, connection draw, and agent overlays in one component.
- **Impact:** every new canvas interaction polish change (e.g. "hold space to pan") risks regression across unrelated concerns. This is why canvas polish has a high blast radius.
- **Recommendation:** before Pass 2 finds things to fix here, extract: `useCanvasKeyboard`, `useCanvasSelection`, `useCanvasDragDrop`, `useCanvasConnectionDraw`. Goal is `CanvasView` as a composition root under 400 lines.

#### F-static-13 — `CanvasToolbar.tsx` at 782 lines
- **Severity:** P1 (refactor)
- **Files:** [src/renderer/src/panels/canvas/CanvasToolbar.tsx](src/renderer/src/panels/canvas/CanvasToolbar.tsx)
- **Observation:** within limit but every button is hand-styled with inline `style` computations (see F-static-02). A `CanvasToolbarButton` primitive with variants (`default | running | destructive | disabled`) would halve this file and fix the token violations in one pass.

#### F-static-14 — `FrontmatterHeader.tsx` at 740 lines
- **Severity:** P2 (refactor)
- **Files:** [src/renderer/src/panels/editor/FrontmatterHeader.tsx](src/renderer/src/panels/editor/FrontmatterHeader.tsx)
- **Recommendation:** split property row rendering per type; extract `FrontmatterProperty`.

#### F-static-15 — Activity bar inlines SVGs as JSX constants
- **Severity:** P2
- **Files:** [src/renderer/src/components/ActivityBar.tsx:13-60](src/renderer/src/components/ActivityBar.tsx:13)
- **Observation:** each icon is a 15-line JSX literal. The app already depends on `@phosphor-icons/react` ([ActivityBar.tsx:9](src/renderer/src/components/ActivityBar.tsx:9)) — why are these not Phosphor icons with consistent stroke/weight?
- **Recommendation:** standardize on one icon system (pick Phosphor or a single local SVG library). Mixing produces subtle weight/metric inconsistencies that show up at design-review zoom.

---

## What's working (worth protecting)

- **Token plan is sophisticated.** OKLCH-aware palette, CSS variables driving themes, per-artifact color functions, documented regeneration path. Most teams don't get this far.
- **Dev/prod data isolation** via `TE_DIR` is cleaner than most apps at this stage.
- **`colors.claude.*`** status slots are semantic and cached — when used, they hold the line.
- **Dialog role marking** is at least present, even if not fully wired.
- **Canvas has a dedicated empty-state component** — that's more than most panels.

---

## Roadmap inputs for this pass

Findings that should propagate to `findings/05-roadmap.md` once the other passes run:

| ID | Severity | Effort | Type |
|----|----------|--------|------|
| F-static-06 | P0 | M | Polish (button aria-label sweep) |
| F-static-07 | P0 | S | Polish (global focus-visible treatment) |
| F-static-10 | P1 | M | Upgrade (shared PanelState primitive) |
| F-static-05 | P1 | M | Refactor (glass token extension + call-site migration) |
| F-static-12 | P1 | L | Refactor (CanvasView decomposition) |
| F-static-13 | P1 | M | Refactor (CanvasToolbarButton primitive) |
| F-static-01 | P1 | S | Polish (conflict banner → token) |
| F-static-02 | P1 | S | Polish (toolbar destructive state → token) |
| F-static-08 | P1 | S | Polish (aria-labelledby on dialogs) |
| F-static-09 | P1 | M | Upgrade (reduced-motion strategy) |
| F-static-11 | P1 | M | Upgrade (error boundary as product surface) |
| F-static-15 | P2 | M | Polish (icon system unification) |
| F-static-14 | P2 | M | Refactor (FrontmatterHeader split) |
| F-static-03 | P2 | S | Polish (claude context dot → token) |
| F-static-04 | P2 | S | Polish (CardLodPreview text → token) |

---

## What Pass 1 did **not** cover

- Visual weight, hierarchy, density at render-time — needs screenshots (Pass 2)
- Motion timing and feel — needs recordings (Pass 3)
- Real focus-order walkthrough — needs keyboard-only session (Pass 4)
- UX copy tone audit beyond the conflict banner — needs a pass of every user-facing string (Pass 2/copy sub-pass)

## Next step

Pass 2 (surface critique) on the three highest-leverage surfaces: **Canvas**, **Editor**, **Activity bar / Shell chrome**. These define the app's identity in the first 30 seconds and any tier-1 review will score them first.
