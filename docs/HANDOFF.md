# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `AGENTS.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 2 — design constitution (ADR 0005) — IN
PROGRESS. **Slices 1–3 of 7 COMPLETE** (slice 1: `87da027` 2026-07-22; slice 2:
`c7b2b89` 2026-07-23; slice 3: 2026-07-23, this checkpoint). Next: **slice 4 —
`panels/agent-shell/`** (257 inline styles + `harness-styles.ts`, the Tailwind
class-string module), then slices 5–6 for the remaining areas. One slice per clean
checkpoint.

## Item 2 scope: the six greppable gates + enforcement machinery

ADR 0005 §Enforcement defines six greppable gates that must all pass for item 2, plus
three enforcement mechanisms. **The deep substrate retune (OKLCH neutral ramp, modular
type scale, four elevation tuples, easing pair) is explicitly Layer 4 item 2, NOT this
item.** This item converges the *mechanism* (one styling path: tokens + `te-` classes);
Layer 4 later retunes the token *values* and it propagates because there is one
mechanism. Do not pull Layer 4 work forward.

Terrain map (recon 2026-07-22; updated for slices 1–3):

| Gate | Status |
|---|---|
| Appearance axes in `settings-store` | **CLOSED (slice 1 + slice 3).** Slice 1's sweep missed three font axes (`displayFont`/`bodyFont`/`monoFont` + FontPicker + GoogleFontLoader + runtime Google Fonts downloads); slice 3 deleted them (store persist v15 drops the keys). Fonts are frozen constants: bundled Manrope/Space Mono via `@import './fonts/fonts.css'` + static `--font-display/--font-body/--font-mono` in `:root` — value-identical to the old defaults. The system-stack/one-mono *retune* stays Layer 4. |
| Zero Tailwind | OPEN. ~321 utility class-strings remain, all in `panels/`: canvas 148, sidebar 60, graph 59, editor 51, health 2, ghosts 1, plus `agent-shell/harness-styles.ts` (Tailwind class-string module, not counted above). `components/`, `App.tsx`, `hooks/`, `markdown/` are at zero. Engine still on: `@tailwindcss/vite` in `electron.vite.config.ts`, `@import 'tailwindcss'` at `index.css:1`, two deps. Flip the engine off LAST, after all class-strings are gone. |
| Zero static inline `style={{}}` | OPEN. ~716 `style={{` remain repo-wide (incl. dynamic exemptions): agent-shell 257, canvas 189, editor 99, sidebar 79, graph 46, ghosts 23, health 12, components 10 (those 10 are all documented dynamic exemptions — prop/state-driven; see slice-3 commit message). |
| Zero off-palette hex | OPEN. Unchanged from recon (~26 production violations; none were in slice-3 scope). |
| Zero `useState` hover | **CLOSED in slice 2.** (FontPicker's `onMouseEnter` font-load, listed as a by-design survivor in the old note, is now deleted entirely.) |
| Zero off-token `transition` | **CLOSED in slice 2.** All new slice-3 CSS draws from `--t-*`/`--transition-*` (spotchecked). |

Enforcement machinery (all greenfield — lands in slice 7): unchanged plan — contrast
unit test (`tests/design/contrast.test.ts`, local WCAG math, not `apply-accent.ts`'s),
dev-only gallery (`design/Gallery.tsx` behind `?gallery=1` DEV check in `App.tsx`),
Playwright visual regression (`e2e/visual.spec.ts`), and the strict
`tests/design/greppable-gates.test.ts` landing last (its transition scanner must handle
multi-line declarations).

## Slice plan (dependency-ordered)

1. **Settings axes deletion — DONE** (`87da027`).
2. **Hover + transitions — DONE** (`c7b2b89`).
3. **components/ + stragglers + font-axis deletion — DONE** (this checkpoint).
4. **agent-shell/** (NEXT) — 257 inline styles + `harness-styles.ts`. Zero Tailwind
   in its TSX; the work is the class-string module + static-style conversion.
5–6. **canvas+graph/, editor+sidebar+ghosts+health/** — remaining areas, then flip the
   Tailwind engine off (vite plugin, `@import`, two deps) as the final act of slice 6.
7. **Enforcement machinery** — the four tests/routes above; PLAN.md item 2 marked
   complete; invariants added to CLAUDE.md/AGENTS.md (identical wording).

## What shipped last (slice 3)

Scope: everything outside `panels/` — all of `components/`, plus `App.tsx`,
`hooks/useClaudeContext.tsx`, `markdown/LucideInline.tsx`. Three parallel agents
(settings+fonts / onboarding+first-run / misc chrome), spotchecked, orchestrator-fixed.

- **Font appearance axes deleted** (ADR 0005 §1/§3): `FontPicker.tsx`,
  `GoogleFontLoader.tsx`, `design/google-fonts.ts`, `tests/design/google-fonts.test.ts`
  removed; settings-store fields/setters removed, persist v14→v15 migration drops the
  persisted keys. Bundled fonts now load via `index.css:2` `@import './fonts/fonts.css'`;
  the three font vars are static `:root` constants. CSP `connect-src` tightened to
  `'self'` (fonts.googleapis.com/gstatic allowances were orphaned; posture moves toward
  parity only).
- **Conversions**: SettingsModal (Typography section removed; 39 classNames + 30 inline
  styles → `.settings-*` classes; toggle is CSS-driven off `aria-checked`),
  OnboardingOverlay + FirstRunScreen (→ `.onboarding__*`/`.first-run*`/`.te-onboarding-*`),
  ContextMenu (→ `.te-ctx-menu*`), PanelErrorBoundary (→ `.te-panel-error*`), Toast,
  CliAgentBadge, EmptyState/LoadingState (data-attribute variants; EmptyState.test.tsx
  assertions rewritten to data-attrs, not weakened), App.tsx shell/loading
  (→ `.te-workspace-shell__main`/`.te-vault-loading*`), useClaudeContext badge, LucideInline.
  New CSS lives in three attributed sections at the end of `index.css` ("Settings
  modal", "Onboarding + first run", "App chrome misc").
- **Conversion conventions established** (reuse in slices 4–6): Tailwind utilities are
  rem-based against the fixed 13px root (`--ui-fs`), so convert them to the same *rem*
  values (`text-xs` → `0.75rem`, `gap-2` → `0.5rem`), NOT the 16px-root px equivalents;
  explicit inline px numbers stay px. State styling via data-attributes
  (`data-variant`/`data-active`/`aria-checked`), not class ternaries. Dynamic
  (prop/state/measured) style values stay inline and get documented as exemptions.
- **Two deliberate value-preserving deviations**: (1) `.settings-button:hover`'s dead
  `color:` line deleted — every call site used to carry inline `color`, which beat the
  hover rule, so keeping it would have *changed* hover behavior (verified against
  pre-slice JSX). (2) ContextMenu shortcut `font-mono` (Tailwind generic stack) →
  `var(--font-mono)` token — the one intentional computed-value shift.

Verify: `npm run check` green (332 files / 4056 tests — exactly the 13 deleted
google-fonts tests fewer than baseline), build exit 0 (re-run after the last CSS fix),
spotcheck-verifier pass over the whole diff (its one real finding — a `gap-1` converted
to `4px` instead of `0.25rem` — fixed; its `.settings-button:hover` "regression" claim
refuted with pre-slice JSX evidence). Live CDP probe against `npm run dev:debug`:
Manrope/Space Mono load from the bundle (`document.fonts.check` true, zero remote font
code), shell + statusbar render, settings modal opens via the `te:open-settings` window
event with exact legacy computed values (button `rgb(161,161,170)`, toggle track
ember `accent.soft`), Typography section gone; screenshot eyeballed clean.

## Landmines

- **`e2e/live.spec.ts` is stale**: targets `.activity-btn`, which no longer exists.
  Pre-existing failure, unrelated to slices 2–3. Fix or delete when convenient.
- **npm audit has 9 pre-existing vulnerabilities** (3 high, all inherited via
  sharp/libvips, GHSA-f88m-g3jw-g9cj). No dependency changed in slice 3; needs a
  separate deps pass.
- **rem conversions assume the 13px root** (`--ui-fs`). If Layer 4 retunes the root
  size, every rem value scales with it — that's the intended behavior, but don't
  "normalize" rem→px in the meantime.
- **Glass literals**: onboarding panel and `.te-ctx-menu` carry
  `rgba(4,4,8,…)`/`blur(…) saturate(…)` literals that exactly mirror
  `floatingPanel.glass.bg/popoverBg` in tokens.ts. Two sources for one fact — fold into
  CSS vars in a later slice (candidate: slice 7 alongside the gates test).
- **Hover-reveal CSS uses deliberate specificity ordering** (slice 2). Don't "simplify"
  selector chains in the Hover states section without re-checking its cascade notes.
- **Visual-verify trick**: settings modal opens headlessly via
  `window.dispatchEvent(new Event('te:open-settings'))` on the CDP target — no UI
  spelunking needed.
- **CanvasToolbar React gotcha** (regression-tested): never read `e.currentTarget`
  inside a setState updater — capture rects before setState.
- **Cursor's background git worker + GitLens `gk mcp` hold `.git/index.lock`**
  intermittently — a commit can fail then succeed on retry. Don't `rm` the lock without
  confirming no git process is mid-operation.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json`** — `git restore` it
  before every commit; never commit it. (`npm run test:live` doesn't touch it;
  `npm run test:e2e` does. Slice 3 ran neither, fixture is clean.)
- eslint uses `--cache`; run `npx eslint --no-cache` when a stale result looks
  suspicious. npm installs need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored; `AGENTS.md` is its tracked twin — keep shared wording
  identical. Item-2 completion invariants get added to BOTH in slice 7, not before.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
