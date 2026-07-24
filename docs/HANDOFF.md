# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `CLAUDE.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 2 — design constitution (ADR 0005) — IN
PROGRESS. **Slices 1–4 of 7 COMPLETE** (slice 1: `87da027` 2026-07-22; slice 2:
`c7b2b89` 2026-07-23; slice 3: 2026-07-23; slice 4: 2026-07-23, this checkpoint).
Next: **slice 5 — `panels/canvas/` + `panels/graph/`** (148 + 59 Tailwind
class-strings; 189 + 46 inline styles), then slice 6 for editor+sidebar+ghosts+health
and the Tailwind engine flip-off. One slice per clean checkpoint.

## Item 2 scope: the six greppable gates + enforcement machinery

ADR 0005 §Enforcement defines six greppable gates that must all pass for item 2, plus
three enforcement mechanisms. **The deep substrate retune (OKLCH neutral ramp, modular
type scale, four elevation tuples, easing pair) is explicitly Layer 4 item 2, NOT this
item.** This item converges the *mechanism* (one styling path: tokens + `te-` classes);
Layer 4 later retunes the token *values* and it propagates because there is one
mechanism. Do not pull Layer 4 work forward.

Terrain map (recon 2026-07-22; updated for slices 1–4):

| Gate | Status |
|---|---|
| Appearance axes in `settings-store` | **CLOSED (slices 1 + 3).** Fonts are frozen constants (bundled Manrope/Space Mono; static `--font-display/--font-body/--font-mono`). The system-stack/one-mono *retune* stays Layer 4. |
| Zero Tailwind | OPEN, agent-shell now clear. `harness-styles.ts` (the Tailwind class-string module) deleted in slice 4; its ~90 `harnessUi.*` refs converted to resurrected `.harness-*` CSS. Remaining ~320 utility class-strings: canvas 148, sidebar 60, graph 59, editor 51, health 2, ghosts 1. Engine still on: `@tailwindcss/vite` in `electron.vite.config.ts`, `@import 'tailwindcss'` at `assets/index.css:1`, two deps. Flip the engine off LAST, after all class-strings are gone (end of slice 6). |
| Zero static inline `style={{}}` | OPEN, agent-shell now clear. Slice 4 converted 257 → 15 surviving `style={{` in agent-shell (plus `style={sizing}`/`style={common}` object forms), ALL dynamic exemptions: Electron `WebkitAppRegion` drag zones (AgentShell ×3), measured widths/heights (ThreadSidebar/ThreadPanel/HeaderFilesSidePanel/TerminalStrip), active-tab `display` (SurfaceDock/TerminalStrip), runtime identity colors (agent-badge, ApprovalsTray flag chips + `diffLineColor`), animation stagger (ThinkingIndicator), measured tooltip placement (ReadNoteCard), load-failure visibility (TerminalDockAdapter), pass-through props (TitlebarPanelToggle, Modal `panelStyle` glass on the two harness dialogs). Remaining static conversions: canvas 189, editor 99, sidebar 79, graph 46, ghosts 23, health 12; components 10 are documented dynamic exemptions (slice 3). |
| Zero off-palette hex | OPEN. Unchanged from recon (~26 production violations; none in slice-4 scope). |
| Zero `useState` hover | **CLOSED in slice 2.** |
| Zero off-token `transition` | **CLOSED in slice 2.** All slice-4 CSS draws from `--t-*`/`--transition-*` (spotchecked). |

Enforcement machinery (all greenfield — lands in slice 7): unchanged plan — contrast
unit test (`tests/design/contrast.test.ts`), dev-only gallery (`design/Gallery.tsx`
behind `?gallery=1` DEV check), Playwright visual regression (`e2e/visual.spec.ts`),
and the strict `tests/design/greppable-gates.test.ts` landing last (its transition
scanner must handle multi-line declarations).

## Slice plan (dependency-ordered)

1. **Settings axes deletion — DONE** (`87da027`).
2. **Hover + transitions — DONE** (`c7b2b89`).
3. **components/ + stragglers + font-axis deletion — DONE** (2026-07-23).
4. **agent-shell/ — DONE** (this checkpoint).
5. **canvas/ + graph/** (NEXT) — 148+59 Tailwind class-strings, 189+46 inline styles.
   Canvas includes Pixi/`getComputedStyle` consumers and `workbench-animations.css` —
   expect a higher dynamic-exemption ratio than agent-shell.
6. **editor + sidebar + ghosts + health** — then flip the Tailwind engine off (vite
   plugin, `@import`, two deps) as the final act of slice 6.
7. **Enforcement machinery** — the four tests/routes above; PLAN.md item 2 marked
   complete; invariants added to CLAUDE.md.

## What shipped last (slice 4)

Scope: all of `panels/agent-shell/`. Five parallel agents (harness-module dismantle /
tool-renderers / tray+palette+breaker / thread cluster / shell+dock+terminal), each
writing TSX edits directly and CSS to a scratchpad fragment; orchestrator assembled the
five attributed sections onto the end of `assets/index.css` (4248 → 6908 lines),
cross-checked every TSX class reference against a CSS definition (zero missing, both
directions), then ran gates.

- **`harness-styles.ts` deleted** — the last Tailwind class-string module. Its 87 keys
  became `.harness-*` CSS (names match the old deleted `HarnessGallery.css`, verified
  against `git show 638e2ef^`); variant syntax (`hover:`, `aria-[current=page]:`,
  `max-[760px]:`, `[&_span]:`) translated to real pseudo-classes/media/descendant
  selectors. Rem values encode what Tailwind renders today at the 13px root (e.g.
  `p-6` → 1.5rem = 19.5px), not the old stylesheet's px.
- **New class vocabularies**: `.te-tool-*` (cards keyed by `data-variant`/`data-pending`
  on ToolCardShell; its `style` prop replaced by `className`, no external consumers),
  `.te-tray-*`/`.te-palette-*`/`.te-breaker-*`/`.te-watcher-*` (tray actions via
  `data-tone` + `--tone` var), `.te-thread-*`/`.te-thinking-*`, `.te-shell-*`/
  `.te-dock-*`/`.te-term-*`. Existing classes extended in place (`.side-dock-ribbon*`,
  `.resize-handle*`, `.vault-switcher*`, `.thread-input-*`, `.te-new-thread-button`)
  without touching the slice-2 hover-section cascade.
- **State → attributes**: active/renaming thread rows, auto-accept toggle (`data-on`),
  key hint (`data-visible`), palette/picker selection (existing `aria-selected`),
  disabled states on native `:disabled`.
- **Orphans removed**: layout constants relocated to CSS (WINDOW_HEADER_HEIGHT,
  RIBBON_WIDTH, TRIGGER_BUTTON_SIZE, actionButtonStyle, etc.) and dead token imports
  across all converted files.

Verify: `npm run check` green (331 files / 4051 tests — identical to the post-hygiene
baseline, zero tests lost), build exit 0, spotcheck-verifier PASS on all six checks
(~25-file value-fidelity sample, cascade audit of the extended selectors, orphan sweep
both directions, deletion greps clean). Live CDP probe against `npm run dev:debug`:
computed styles exact (titlebar 39px/8px gutters, controls 148px, ribbon 35px, sidebar
240px, textarea 22px), approvals-tray popover + command palette open with exact glass
values (`rgba(4,4,8,0.9)`, `blur(24px) saturate(1.4)`), harness gallery renders at
1080px with 10 template cards, mode tabs, filters; screenshots eyeballed clean.

## Landmines

- **`.thread-input-textarea` min/max-height (22px/200px) duplicate
  MIN_INPUT_HEIGHT/MAX_INPUT_HEIGHT in `ThreadInputBar.tsx`** — the JS resize clamp is
  still the live consumer. Change together (a CSS comment marks it).
- **Pinned-px titlebar tests became class-presence tests** (AgentShell,
  SideDockRibbon): happy-dom can't read the external stylesheet, so the 39px/148px/8px
  values are now guaranteed only by CSS. Candidate assertion for the slice-7
  greppable-gates/visual-regression suite.
- **Glass literals** now at five sites (`onboarding`, `.te-ctx-menu`,
  `.te-tray-popover`, `.te-palette-panel`, `.te-shell-welcome`) all mirroring
  `floatingPanel.glass` — fold into CSS vars in slice 7 alongside the gates test.
- **npm audit has 9 pre-existing vulnerabilities** (3 high, sharp/libvips,
  GHSA-f88m-g3jw-g9cj). No dependency changed in slice 4; needs a separate deps pass.
- **rem conversions assume the 13px root** (`--ui-fs`). Layer 4 may retune the root;
  rem scaling with it is intended — don't "normalize" rem→px.
- **Hover-reveal CSS uses deliberate specificity ordering** (slice 2). The slice-4
  sections split properties (layout in new sections, color/state in the hover section)
  for `.side-dock-ribbon-action` and `.resize-handle*` — keep the split disjoint.
- **Visual-verify tricks**: settings modal opens via
  `window.dispatchEvent(new Event('te:open-settings'))`; approvals tray via clicking
  `.te-tray-trigger`; palette via synthetic ⌘K `KeyboardEvent`; harness gallery via the
  sidebar "NEW AGENT" button. CDP scripts from this slice live in the session
  scratchpad (`cdp-probe*.js`) — rewrite as needed, they're not tracked.
- **CanvasToolbar React gotcha** (regression-tested): never read `e.currentTarget`
  inside a setState updater — capture rects before setState.
- **Cursor's background git worker + GitLens `gk mcp` hold `.git/index.lock`**
  intermittently — a commit can fail then succeed on retry. Don't `rm` the lock without
  confirming no git process is mid-operation.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json`** — `git restore` it
  before every commit; never commit it. (Slice 4 ran `npm run check` + build only;
  fixture untouched, verified via `git status`.)
- eslint uses `--cache`; run `npx eslint --no-cache` when a stale result looks
  suspicious. npm installs need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored and is the sole operator doc. Item-2 completion invariants
  get added to it in slice 7, not before.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
