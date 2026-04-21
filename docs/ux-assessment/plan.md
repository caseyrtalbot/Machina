# Machina — UI/UX Assessment Plan

A structured pass to bring Machina's interface, interaction, and product surface to the bar of Notion, Anthropic, Linear, Cursor. Output is a per-surface report plus a prioritized backlog of polish, upgrades, and refactor candidates.

---

## 0. Operating principles

- **Evidence, not taste.** Every finding cites a screenshot, token, file:line, or heuristic — no "feels off."
- **Systemic before cosmetic.** A token drift or inconsistent state model is more valuable to fix than one misaligned icon.
- **Ship-shape.** Every finding maps to a backlog item with impact × effort. No orphaned critique.
- **Design-debt = engineering-debt.** When a UX issue is rooted in architecture (state ownership, panel lifecycle, IPC timing), flag it for refactor, not just restyle.

## 1. Passes (run in order)

Five passes. Each pass has a clear input, method, and artifact. Don't interleave — finish a pass before starting the next or you'll lose signal.

| # | Pass | Input | Method | Artifact |
|---|------|-------|--------|----------|
| 1 | **Static audit** | Code only | Grep for token violations; read `design/tokens.ts`, `themes.ts`, `components/`; list hardcoded hex/px, inline styles, duplicate patterns | `findings/01-static-audit.md` |
| 2 | **Surface critique** | Screenshots (≥1 per surface, all themes) | Per-surface rubric scoring; flag IxD, visual, motion, a11y, copy | `findings/02-surfaces/<surface>.md` |
| 3 | **Flow critique** | Screen recordings of end-to-end journeys | Journey map; note friction, latency, dead-ends, wayfinding breaks | `findings/03-flows.md` |
| 4 | **Accessibility** | Running app + DevTools | WCAG 2.1 AA checklist, keyboard-only run, focus order, screen reader smoke test, contrast | `findings/04-a11y.md` |
| 5 | **Synthesis** | All prior artifacts | Cluster findings into themes; score impact × effort; produce roadmap | `findings/05-roadmap.md` |

## 2. Surface inventory

Every surface gets its own file under `findings/02-surfaces/`. For each, capture: default state, empty state, loading state, error state, hover/focus states, every theme (6), both accents the user uses most.

### Core surfaces
- **Shell chrome** — title bar, traffic lights, macOS window behavior, fullscreen, tab bar
- **Activity bar** (`components/ActivityBar.tsx`) — navigation affordances, active indicator, tooltip copy
- **Sidebar** (`panels/sidebar/`) — file tree, search entry, origin colors, resize handle
- **Onboarding** (`components/OnboardingOverlay.tsx`) — first-run vault picker, zero-state pedagogy
- **Settings modal** (`components/SettingsModal.tsx`) — theme/accent/font pickers, density

### Primary workspaces
- **Canvas** (`panels/canvas/`) — empty canvas, sparse, dense (885+ nodes), all 12 card types, selection, marquee, cluster, pan/zoom extremes, split editor, connection draw, drag-into-canvas
- **Graph** (`panels/graph/`) — force-layout resting, settling, hover neighborhood, pinned subgraph, empty vault
- **Editor** (`panels/editor/`) — rich mode, source mode, split, dirty indicator, backlinks, slash menu, bubble menu, wikilink hover, callouts, mermaid, tabs (Obsidian-style), nav history
- **Workbench** (`panels/workbench/`) — live agent sessions, milestones, idle state, error state
- **Ghosts** (`panels/ghosts/`) — ranked list, empty (zero ghosts = good), synthesis action
- **Health** (`panels/health/`) — system status, vault stats

### Cross-cutting
- **Command palette / slash menu** — discoverability, keyboard latency, result ranking, empty query
- **Tabs** — open/close/reorder, overflow, drag, unsaved indicator, middle-click
- **Tooltips** — delay, content density, consistency
- **Toasts / notifications** — placement, duration, action affordance, stacking
- **Modals & dialogs** — focus trap, dismiss patterns, affirmative/destructive hierarchy
- **Context menus** — ordering, separators, keyboard, icon parity
- **Loading & skeleton states** — perceptual latency on first paint, panel lazy boundaries
- **Error states** — `PanelErrorBoundary.tsx`, IPC timeout UX, vault-not-found, read-only fallback

## 3. Evaluation rubric

Twelve dimensions. Each scored 1–5 with a one-line justification and at least one finding.

| Dimension | What we're asking |
|-----------|-------------------|
| **Information architecture** | Is the mental model obvious in 3 seconds? Do names match concepts? |
| **Visual hierarchy** | Can the eye find the one thing that matters on this screen? |
| **Typography** | Scale, line-height, weight, measure, vertical rhythm. Is copy easy to scan? |
| **Density & whitespace** | Comfortable at 13", 27", 4K. No claustrophobia, no sprawl. |
| **Color & theming** | Token adherence across all six themes. Semantic color use. Dark-mode parity. |
| **Motion & feedback** | Every state change has a 150–250ms ease. No jank. Affordance on hover/focus. |
| **Interaction design** | Affordances read correctly. Discoverability of power features. Undo everywhere. |
| **Consistency** | Same action looks the same everywhere. Same control, same spacing, same hit target. |
| **Empty / error / loading** | Every path has all three. Copy is teaching, not apologetic. |
| **Performance perception** | 60fps on canvas. First meaningful paint < 1s. No synchronous IPC on paint. |
| **Accessibility (WCAG 2.1 AA)** | Contrast, focus ring, keyboard-only, target size, reduced motion, screen reader labels. |
| **UX copy** | Voice is confident and specific. No "Oops", no "Something went wrong", no marketing fluff. |
| **Platform fit** | macOS HIG: traffic lights, shortcuts (⌘, not Ctrl), title bar, native menu, fullscreen. |

Benchmarks for the bar: Linear (hierarchy, density, motion), Notion (empty states, microcopy), Cursor (command palette, latency), Anthropic product surfaces (restraint, typography), Figma (canvas interactions, cursor feedback). Cite specific patterns when borrowing — don't clone.

## 4. Per-surface report template

```markdown
# <Surface name>

**Files:** `path/to/entry.tsx`, related stores, related IPC
**Screens captured:** default, empty, loading, error, <N> themes
**Canonical tasks:** what the user comes here to do (top 3)

## Rubric scores

| Dimension | Score | Note |
|-----------|-------|------|
| IA                     | x/5 | ... |
| Visual hierarchy       | x/5 | ... |
| Typography             | x/5 | ... |
| Density & whitespace   | x/5 | ... |
| Color & theming        | x/5 | ... |
| Motion & feedback      | x/5 | ... |
| Interaction design     | x/5 | ... |
| Consistency            | x/5 | ... |
| Empty/error/loading    | x/5 | ... |
| Performance perception | x/5 | ... |
| Accessibility          | x/5 | ... |
| UX copy                | x/5 | ... |
| Platform fit           | x/5 | ... |

## Findings

### F-<surface>-01 — <short title>
- **Severity:** P0 / P1 / P2
- **Dimension:** <which rubric row>
- **Evidence:** screenshot, `file.tsx:line`, token reference
- **Observation:** one sentence, neutral, describes what is.
- **Impact:** what the user loses today.
- **Recommendation:** specific change, not vague direction.
- **Effort:** S / M / L (hours, days, weeks)
- **Refactor?** yes/no — does this require architectural work?

(repeat)

## Delight opportunities
Things that are *fine* today but could be *memorable*. One line each, no obligation to ship.
```

## 5. Backlog & prioritization

Roll every finding into one backlog at `findings/05-roadmap.md`:

```markdown
| ID | Surface | Finding | Severity | Impact | Effort | Type | Target |
|----|---------|---------|----------|--------|--------|------|--------|
| F-canvas-01 | Canvas | ... | P0 | High | M | Polish | v1.1 |
```

**Severity:**
- **P0** — broken, inaccessible, or off-brand at a level that would fail a design review at a top shop
- **P1** — noticeable friction; the app feels good without it, great with it
- **P2** — delight, consistency hygiene, future-facing

**Type:**
- **Polish** — visual, copy, motion, spacing — no architecture change
- **Upgrade** — new capability or significantly better interaction
- **Refactor** — requires state/IPC/panel architecture work before UX can improve

Group the roadmap by release target (v1.1 polish, v1.2 upgrades, v2 refactors) so each release has a coherent story instead of a scattershot of fixes.

## 6. Running the passes — tooling

### Screenshot capture
- **Manual first pass**: `⌘⇧4` per surface per theme. Name `surface__theme__state.png` in `findings/screenshots/`. Fast, sufficient for the first 80% of findings.
- **Reproducible capture (later)**: Playwright Electron via `_electron.launch()` — infra already exists in `e2e/`. Add a `e2e/capture.spec.ts` that cycles themes × panels × states. Only build this once manual capture reveals which flows warrant automation.
- **CDP live inspection**: `npm run dev:debug` opens port 9222 for DOM/style introspection during a critique.

### Skills to invoke per pass
- Pass 1 (static): `design:design-system`, `simplify`
- Pass 2 (surface): `design:design-critique` per screenshot, `design:ux-copy` for any text surfaces
- Pass 3 (flow): `design:user-research` framing, narrative walkthrough
- Pass 4 (a11y): `design:accessibility-review`
- Pass 5 (synthesis): `thought-engine-council` for architecture-level tradeoffs; `red-team` on the roadmap

### Cadence
- Pass 1: one session
- Pass 2: one session per 2–3 surfaces (expect ~6 sessions)
- Pass 3: one session
- Pass 4: one session
- Pass 5: one session

Budget ~10 focused sessions for a complete first assessment. Re-run Pass 2 on any surface after major refactor.

## 7. What "passes a top-shop review" looks like

A reviewer at Notion/Anthropic/Cursor will ask four questions. Pre-answer them:

1. **Is the core loop obvious to a first-time user in under 60 seconds?** (Onboarding, empty canvas, first wikilink)
2. **Does every state exist, and does it teach?** (Loading, empty, error, offline, conflict)
3. **Does it feel native on macOS?** (Shortcuts, traffic lights, fullscreen, menu bar, system preferences integration)
4. **Would you be embarrassed to demo any screen cold?** (Health panel, error boundaries, rarely-visited settings)

If the answer to any is "not yet," that's where Pass 5 prioritization starts.

## 8. Next step

Run Pass 1 (static audit). It's the cheapest, highest-leverage, and every later pass is sharper once you know where the token system actually holds and where it drifts.
