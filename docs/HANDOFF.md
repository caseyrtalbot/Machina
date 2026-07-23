# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `AGENTS.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 2 — design constitution (ADR 0005) — IN
PROGRESS. **Slice 1 of 7 COMPLETE 2026-07-22** (commit `87da027`). Next: slice 2
(hover + transitions). Item 2 is a large, multi-slice item; execute one slice per
clean checkpoint, same method as item 1.

## Item 2 scope: the six greppable gates + enforcement machinery

ADR 0005 §Enforcement defines six greppable gates that must all pass for item 2, plus
three enforcement mechanisms. **The deep substrate retune (OKLCH neutral ramp, modular
type scale, four elevation tuples, easing pair) is explicitly Layer 4 item 2, NOT this
item.** This item converges the *mechanism* (one styling path: tokens + `te-` classes);
Layer 4 later retunes the token *values* and it propagates because there is one
mechanism. Do not pull Layer 4 work forward.

Terrain map (from a 5-agent recon 2026-07-22; counts are pre-slice-1 baselines):

| Gate | Surface at baseline |
|---|---|
| Appearance axes in `settings-store` | **CLOSED in slice 1.** |
| Zero Tailwind | 428 className literals + 259 arbitrary-value tokens across 66 TSX files + `panels/agent-shell/harness-styles.ts` (a Tailwind class-string module). Engine is Tailwind v4, config-less: `@tailwindcss/vite` in `electron.vite.config.ts` (lines 4, 53), single `@import 'tailwindcss'` in `assets/index.css:1`, deps `@tailwindcss/vite`+`tailwindcss` ^4.2.1. No `@apply`/`theme()` anywhere. Engine flip-off is trivial but can only happen AFTER all 428 className literals are converted. |
| Zero static inline `style={{}}` | 565 static (of 844; 279 dynamic are exempt — transforms/computed positions/runtime colors). Concentrated in ~12 files (SettingsModal now gutted; OnboardingOverlay 22, ApprovalsTray 18, FrontmatterHeader 18, GraphDetailDrawer 16, BacklinksPanel 16, GhostPanel 14, ThreadSidebar 14, ThreadPanel 14, VaultSelector 12, EditNoteCard 12, CommandPalette 11). Many are already design-token refs (`colors.*`, `transitions.*`) → cheap class extractions. |
| Zero off-palette hex | ~26 genuine production violations (mermaid-code-block fallbacks 6, index.css `var(--x,#hex)` fallbacks 5, cli-agents brandColor 4, TerminalApp 4, settings-store default-accent 2, apply-accent computed 2, graph-label-layer 1, CardShell `'#050607'` 1, main index.ts window bg 1). Plus 4 palette-source files that could fold into tokens (accent-presets [DELETED in slice 1], canvas-colors.ts, index.css :root, terminal-webview Catppuccin theme). Test-file hex is not a violation. |
| Zero `useState` hover | 17 declarations in 13 files: ThreadSidebar (3), GhostPanel (2), FrontmatterHeader (2), HealthPanel, HeaderFilesSidePanel, ApprovalsTray, TitlebarPanelToggle, SideDockRibbon, ResizeHandle, CardShell (~line 129), EdgeDots (`hoveredId`), TerminalDock, EmptyState. NOT violations (legit dynamic): FontPicker (`onMouseEnter` loads a font), GraphPanel (`setHoveredNode` zustand canvas hover). |
| Zero off-token `transition` | TSX inline transitions are already 100% on-token (0 violations). 12 off-token declarations, all in `assets/index.css` (lines 260, 802, 1146 [×3], 1163, 1259, 1491, 1526, 1742, 1935, 2265, 2408, 2441). Existing motion tokens: `--t-micro/fast/med/slow/surface` (90/120/180/280/180ms) and legacy `--transition-*` aliases. Also `workbench-animations.css:13` uses an off-token `animation` (outside this gate but note it). |

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
  that scans source and asserts all six gates as counts, converting ADR prose into an
  automated permanent gate that rides `npm run check`. There is NO CI and NO custom
  eslint rule today; a vitest scanner is the lowest-ceremony enforcement. Land it LAST
  (it can only pass once conversions are done); precedent: `harness-lint.test.ts`.

## Slice plan (dependency-ordered)

1. **Settings axes deletion — DONE** (commit `87da027`).
2. **Hover + transitions** (NEXT): 17 `useState` hover → CSS `:hover`/`data-*` +
   `te-` class states; 12 off-token `index.css` transitions → existing `--t-*` motion
   vars (map each ms to the nearest existing token; the 700ms line 260 reveal may need a
   documented exemption or a token — decide in-slice). Small, localized. **Shares
   `CardShell.tsx` and `EmptyState.tsx` with earlier/later work — sequence, don't
   parallelize against slices touching those files.**
3–6. **Tailwind + inline-style + hex convergence** — the bulk. Sub-slice by area
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

## What shipped last (slice 1)

`87da027` — deleted the eight appearance axes; appearance is now fixed constants.
`settings-store` dropped `env`/`accentId`/`customAccentHex` + actions (persist v14 with
dead-key cleanup migration); `themes.ts` deleted `EnvironmentSettings`/`ENV_DEFAULTS`
and the density/radii/background variant tables, added fixed constants (`BACKGROUND`,
`DENSITY_DEFAULT_VARS`, `RADII_SQUARE_VARS`, `CARD_*`/`SIDEBAR_*` px) equal to the former
defaults; `Theme.tsx` `applyEnvCssVars(env)` → `applyDesignConstants()` (one mount
effect), `useEnv`/`EnvContext` removed; `accent-presets.ts` deleted (single accent =
ember); SettingsModal + CanvasToolbar appearance UIs gutted; CardShell/CanvasSurface/
FileTree read the themes constants. Verify: `npm run check` green (333 files / 4069
tests, independently re-run), build exit 0, symbol sweep clean, spotcheck no scope creep
/ no value drift.

## Landmines

- **Values are unchanged by construction in slice 1** (fixed constants == former
  defaults). Any appearance retune belongs to Layer 4, not here. Don't "improve" values
  while converging mechanism.
- **Slice-1 visual probe NOT run live.** Appearance is unchanged-by-construction, and
  the visual-regression harness is slice 7, so no live CDP probe was done. Eyeball on
  next dev run if paranoid; nothing should have moved.
- **CardShell.tsx / EmptyState.tsx are multi-slice-hot.** Slice 1 touched CardShell's
  `useEnv` line; slice 2 touches its hover line (~129) and EmptyState's hover (~47).
  Sequence slices that share these files.
- **CanvasToolbar React gotcha** (regression-tested in CanvasToolbar.test.tsx): never
  read `e.currentTarget` inside a setState updater — nulled when the handler returns;
  crashed the AgentShell error boundary. Capture rects before setState.
- **Cursor's background git worker** (`gitWorker.js`) + GitLens/GitKraken `gk mcp` hold
  `.git/index.lock` intermittently — a commit can fail with "index.lock exists" then
  succeed on retry once the worker releases it. Don't `rm` the lock without confirming
  no git process is mid-operation.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json`** (dock/panel state +
  Casey's real home path in `lastOpenNote`). `git restore` it before every commit; never
  commit it (reintroduces the scrubbed personal-path leak).
- Migrate note: slice 1's rewrite dropped the old v<4 dead-key cleanup (theme/
  accentColor/terminalShell/terminalFontSize/scrollbackLines). Unreachable for any store
  ≥v13; intentionally not re-added (no handling for states that can't occur).
- eslint uses `--cache`; run `npx eslint --no-cache` when a stale-file lint result looks
  suspicious. npm installs need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored; `AGENTS.md` is its tracked twin — keep shared wording
  identical. The item-2 completion invariants (one styling mechanism; no appearance
  axes) get added to BOTH in slice 7, not before.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
