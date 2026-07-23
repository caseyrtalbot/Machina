# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `AGENTS.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 2 — design constitution (ADR 0005) — IN
PROGRESS. **Slices 1 and 2 of 7 COMPLETE** (slice 1: `87da027` 2026-07-22; slice 2:
2026-07-23, this checkpoint). Next: slices 3–6 (Tailwind + inline-style + hex
convergence, sub-sliced by area). Item 2 is a large, multi-slice item; execute one
slice per clean checkpoint.

## Item 2 scope: the six greppable gates + enforcement machinery

ADR 0005 §Enforcement defines six greppable gates that must all pass for item 2, plus
three enforcement mechanisms. **The deep substrate retune (OKLCH neutral ramp, modular
type scale, four elevation tuples, easing pair) is explicitly Layer 4 item 2, NOT this
item.** This item converges the *mechanism* (one styling path: tokens + `te-` classes);
Layer 4 later retunes the token *values* and it propagates because there is one
mechanism. Do not pull Layer 4 work forward.

Terrain map (recon 2026-07-22; updated for slices 1–2):

| Gate | Status |
|---|---|
| Appearance axes in `settings-store` | **CLOSED in slice 1.** |
| Zero Tailwind | OPEN. 428 className literals + 259 arbitrary-value tokens across 66 TSX files + `panels/agent-shell/harness-styles.ts` (Tailwind class-string module). Engine is Tailwind v4, config-less: `@tailwindcss/vite` in `electron.vite.config.ts` (lines 4, 53), single `@import 'tailwindcss'` in `assets/index.css:1`, deps `@tailwindcss/vite`+`tailwindcss` ^4.2.1. Flip the engine off LAST, only after all className literals are converted. |
| Zero static inline `style={{}}` | OPEN. ~565 static at baseline (279 dynamic exempt); slice 2 removed a few dozen hover-ternary styles but the bulk remains, concentrated in ~12 files (OnboardingOverlay, ApprovalsTray, FrontmatterHeader, GraphDetailDrawer, BacklinksPanel, GhostPanel, ThreadSidebar, ThreadPanel, VaultSelector, EditNoteCard, CommandPalette). Many are design-token refs → cheap class extractions. |
| Zero off-palette hex | OPEN. ~26 genuine production violations (mermaid-code-block fallbacks 6, index.css `var(--x,#hex)` fallbacks 5, cli-agents brandColor 4, TerminalApp 4, settings-store default-accent 2, apply-accent computed 2, graph-label-layer 1, CardShell `'#050607'` 1, main index.ts window bg 1). Plus 3 palette-source files that could fold into tokens (canvas-colors.ts, index.css :root, terminal-webview Catppuccin theme). Test-file hex is not a violation. |
| Zero `useState` hover | **CLOSED in slice 2.** `grep -rn useState src/renderer/src --include='*.tsx' | grep -i hover` → 0. FontPicker (`onMouseEnter` font load) and GraphPanel (zustand `setHoveredNode`) remain by design (legit dynamic, not useState hover). |
| Zero off-token `transition` | **CLOSED in slice 2.** All `index.css` transitions are `var(--t-*)`/`var(--transition-*)`. The recon's count of 12 was an undercount (its grep missed multi-line `transition:` declarations); the true set was ~32 declarations, all converted. New token `--t-reveal: 700ms cubic-bezier(0.22,1,0.36,1)` covers the new-thread shimmer. The reduced-motion `transition-duration: 0.01ms !important` override is an a11y kill switch, not a violation. `workbench-animations.css:13` off-token `animation` is outside this gate (noted for slice 7's scanner design). |

Enforcement machinery (all greenfield — none exists yet; lands in slice 7):
- **Contrast unit test** → `tests/design/contrast.test.ts`, import raw hexes from
  `design/themes.ts` (`STRUCTURAL_COLORS`, `SIGNAL_COLORS`, `ACCENT_HEX`, the fixed
  `BACKGROUND`), local WCAG `contrastRatio()` (sRGB linearize → luminance; do NOT reuse
  `apply-accent.ts`'s gamma-less Rec.709 math). Auto-rides `npm run check`.
- **Dev-only gallery** → `src/renderer/src/design/Gallery.tsx`, mounted in `App.tsx` as
  an `import.meta.env.DEV && new URLSearchParams(location.search).get('gallery')==='1'`
  early-return before `renderContent()` (no router exists; do not add one). Enumerate
  the `components/` primitives (TabBar, ContextMenu, PanelHeader, Overlay/Modal,
  EmptyState/Spinner/LoadingState, Toast, Statusbar) AND bare `te-btn`/`te-pill`/`te-tab`
  markup in every `data-variant`/`data-*`/state.
- **Visual regression** → `e2e/visual.spec.ts` under existing `playwright.config.ts`
  (workers:1). Launch via the `_electron.launch({ args: [MAIN_ENTRY] })` pattern from
  `e2e/app.spec.ts`; navigate to `?gallery=1` and to the shell with the test-vault;
  `expect(page).toHaveScreenshot()`. Baselines land in `e2e/visual.spec.ts-snapshots/`.
  Runs only via `npm run test:e2e` (not in `check`).
- **Greppable-gates test** (recommended 4th) → `tests/design/greppable-gates.test.ts`
  that scans source and asserts all six gates as counts. Land it LAST; precedent:
  `harness-lint.test.ts`. Its transition scanner must handle multi-line `transition:`
  declarations (the recon grep missed them — see gate table).

## Slice plan (dependency-ordered)

1. **Settings axes deletion — DONE** (commit `87da027`).
2. **Hover + transitions — DONE** (this checkpoint).
3–6. **Tailwind + inline-style + hex convergence** (NEXT) — the bulk. Sub-slice by area
   (components/, agent-shell/ incl. harness-styles.ts, graph+canvas/, editor+sidebar+
   ghosts+health/), converting Tailwind classNames + static inline styles → `te-`/token
   classes and removing hex. **Flip the Tailwind engine off LAST** (remove the vite
   plugin, the `@import`, the two deps) once all className literals are gone — that is
   the gate for the Tailwind check. Delegate per-area to parallel agents; spotcheck
   after each batch.
7. **Enforcement machinery** — contrast test, gallery route, visual regression, and the
   strict `greppable-gates.test.ts`. Lands last; the gates test passes only once every
   conversion is done. This is also where PLAN.md item 2 gets marked complete and the
   three-mechanism enforcement + standing invariants get added to CLAUDE.md/AGENTS.md.

## What shipped last (slice 2)

Hover: all 17 `useState` hover declarations across 13 files deleted; hover styling is
CSS-driven via component classes in `index.css` (new section "Hover states" at file
end, plus `.canvas-card__resize`/`.canvas-card__anchor` in the Canvas Card section and
`.terminal-pill` states in its existing rule). Recipes: self-hover tints
(`.health-issue-row`, `.ghost-action-icon`, `.vault-switcher`, `.titlebar-toggle`,
`.side-dock-ribbon-action`, `.terminal-pill`, `.edge-dot`, `.te-empty-action`),
parent-hover child reveals (`.ghost-row__*`, `.thread-row__kebab`,
`.vault-switcher__chevron`, `.resize-handle__line`, `.fm-property-row__delete`,
`.fm-type-badge`, `.fm-connection-pill__remove`, canvas resize grip + anchor dots), and
state attributes that out-cascade hover (`data-open`, `data-active`, `data-tone`,
`data-error`, `:disabled`). CardShell's resize grip and anchor dots are now always
mounted with `pointer-events` gating instead of `{hovered && …}` conditional mounts;
its mouseenter/leave handlers survive only to feed zustand `setHoveredNode`. Shared
`.titlebar-toggle` unified ApprovalsTray + TitlebarPanelToggle (identical styling,
including `-webkit-app-region: no-drag`, so both `@ts-expect-error` inline hacks are
gone). TypeBadge's `visible` prop was removed; the badge is always focusable and
reveals on `:focus-visible` / row hover / open menu (small a11y improvement, only call
site was PropertyRow). ConnectionPill's four DOM-mutation hover handlers became CSS
(`:has()` for the label→border effect; Electron Chromium supports it).

Transitions: every off-token `transition` in `index.css` mapped to the nearest existing
token — 150ms ease-out → `--transition-hover` (exact), 120ms → `--t-fast`, 100ms →
`--transition-focus-ring`, 180/200/220ms → `--t-med`, plus new `--t-reveal` (700ms) for
the new-thread shimmer. Values-identical where an exact token existed; small sanctioned
timing drift elsewhere.

Verify: `npm run check` green (333 files / 4069 tests), build exit 0, `grep -i hover`
over `useState` declarations → 0, off-token transition sweep (single- and multi-line) →
0. Live CDP probe against `npm run dev:debug`: titlebar toggle, approvals tray, vault
switcher, ribbon action, and resize-handle hairline all respond to real hover with the
expected computed styles; active thread-row correctly suppresses tint and pins its
kebab visible. One structural test updated (`ghost-density-view.test.ts` now asserts
the CSS mechanism instead of `opacity.*hovered`).

## Landmines

- **`e2e/live.spec.ts` is stale**: its "activity bar exposes a selected view" check
  targets `.activity-btn`, which no longer exists anywhere in source. Pre-existing
  failure, unrelated to slice 2. Fix or delete the spec when convenient.
- **Hover-reveal CSS uses deliberate specificity ordering** (state attributes declared
  after `:hover` at equal specificity; reveal-boost selectors like
  `.fm-property-row:hover .fm-type-badge:hover` at higher). Don't "simplify" selector
  chains in the Hover states section without re-checking the cascade notes there.
- **Legacy `--transition-*` aliases gained new uses** where they were value-exact
  (`--transition-hover`, `--transition-focus-ring`). Intentional: value-identical beats
  forward purity mid-convergence. Layer 4's retune decides the canonical motion set.
- **Values are unchanged by construction** except sanctioned nearest-token timing drift
  (e.g. 220ms→180ms). Any appearance retune belongs to Layer 4, not here.
- **CardShell anchor dots under pointer capture**: edge-creation drag onto another
  card's dots relies on the same hover semantics as before (CSS `:hover` vs the old
  mouseenter — both suppressed identically during pointer capture), but eyeball an
  edge-creation drag on the next dev run to be sure.
- **CanvasToolbar React gotcha** (regression-tested in CanvasToolbar.test.tsx): never
  read `e.currentTarget` inside a setState updater — nulled when the handler returns.
  Capture rects before setState.
- **Cursor's background git worker** (`gitWorker.js`) + GitLens/GitKraken `gk mcp` hold
  `.git/index.lock` intermittently — a commit can fail with "index.lock exists" then
  succeed on retry. Don't `rm` the lock without confirming no git process is
  mid-operation.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json`** (dock/panel state +
  Casey's real home path in `lastOpenNote`). `git restore` it before every commit; never
  commit it. (`npm run test:live` does not touch it; `npm run test:e2e` does.)
- eslint uses `--cache`; run `npx eslint --no-cache` when a stale-file lint result looks
  suspicious. npm installs need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored; `AGENTS.md` is its tracked twin — keep shared wording
  identical. The item-2 completion invariants (one styling mechanism; no appearance
  axes) get added to BOTH in slice 7, not before.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
