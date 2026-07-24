# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `CLAUDE.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 2 — design constitution (ADR 0005) — IN
PROGRESS. **Slices 1–5 of 7 COMPLETE** (slice 1: `87da027` 2026-07-22; slice 2:
`c7b2b89` 2026-07-23; slices 3–5: 2026-07-23; slice 5 is this checkpoint). Next:
**slice 6 — editor + sidebar + ghosts + health**, then flip the Tailwind engine off
(vite plugin, `@import`, two deps) as the final act of slice 6. One slice per clean
checkpoint.

## Item 2 scope: the six greppable gates + enforcement machinery

ADR 0005 §Enforcement defines six greppable gates that must all pass for item 2, plus
three enforcement mechanisms. **The deep substrate retune (OKLCH neutral ramp, modular
type scale, four elevation tuples, easing pair) is explicitly Layer 4 item 2, NOT this
item.** This item converges the *mechanism* (one styling path: tokens + `te-` classes);
Layer 4 later retunes the token *values* and it propagates because there is one
mechanism. Do not pull Layer 4 work forward.

Terrain map (recon 2026-07-22; updated for slices 1–5):

| Gate | Status |
|---|---|
| Appearance axes in `settings-store` | **CLOSED (slices 1 + 3).** Fonts are frozen constants (bundled Manrope/Space Mono; static `--font-display/--font-body/--font-mono`). The system-stack/one-mono *retune* stays Layer 4. |
| Zero Tailwind | OPEN, canvas + graph now clear (slice 5; agent-shell slice 4). Remaining ~114 utility class-strings (recon counts): sidebar 60, editor 51, health 2, ghosts 1. Engine still on: `@tailwindcss/vite` in `electron.vite.config.ts`, `@import 'tailwindcss'` at `assets/index.css:1`, two deps. Flip the engine off LAST, after all class-strings are gone (end of slice 6). |
| Zero static inline `style={{}}` | OPEN, canvas + graph now clear (slice 5). 30 surviving `style={` across both are ALL dynamic exemptions: canvas 28 (pan/zoom transforms, zoom-derived dot-grid/spotlight tiles, measured marquee/minimap/section geometry, cursor-follow badges, drag-resized split width, `isInteracting`-gated card blur, runtime colors from getCardTypeColor/LANGUAGE_COLORS/getArtifactColor/STATUS_COLOR, PdfCard measured selection rect + page aspect, CardBadge prop color), graph 2 (getArtifactColor dots in GraphDetailDrawer). Remaining static conversions (recon counts): editor 99, sidebar 79, ghosts 23, health 12; components 10 are documented dynamic exemptions (slice 3). |
| Zero off-palette hex | OPEN. Unchanged from recon (~26 production violations). Slice 5 carried off-palette literals verbatim from TSX into CSS per value-fidelity rule (`#dfa11a`, `#3dca8d`, `#050607`, assorted white/black rgba) — same violations, new home in the slice-5 CSS section; the hex pass will find them there. |
| Zero `useState` hover | **CLOSED in slice 2.** Slice 5 removed 8 more JS onMouseEnter/Leave hover handlers (graph buttons, CodeCard lang menu, FileViewCard, CanvasToolbar, CanvasSplitEditor, ImportPalette rows) — all now CSS `:hover`. |
| Zero off-token `transition` | **CLOSED in slice 2, held.** Slice 5 minted `--t-spring: 220ms cubic-bezier(0.16, 1, 0.3, 1)` (graph drawer slide) rather than carry a bespoke literal. |

Enforcement machinery (all greenfield — lands in slice 7): unchanged plan — contrast
unit test (`tests/design/contrast.test.ts`), dev-only gallery (`design/Gallery.tsx`
behind `?gallery=1` DEV check), Playwright visual regression (`e2e/visual.spec.ts`),
and the strict `tests/design/greppable-gates.test.ts` landing last (its transition
scanner must handle multi-line declarations — slice 5 added several).

## Slice plan (dependency-ordered)

1. **Settings axes deletion — DONE** (`87da027`).
2. **Hover + transitions — DONE** (`c7b2b89`).
3. **components/ + stragglers + font-axis deletion — DONE** (2026-07-23).
4. **agent-shell/ — DONE** (2026-07-23).
5. **canvas/ + graph/ — DONE** (this checkpoint).
6. **editor + sidebar + ghosts + health** (NEXT) — then flip the Tailwind engine off
   (vite plugin, `@import`, two deps) as the final act of slice 6.
7. **Enforcement machinery** — the four tests/routes above; PLAN.md item 2 marked
   complete; invariants added to CLAUDE.md.

## What shipped last (slice 5)

Scope: all of `panels/canvas/` + `panels/graph/`. Six parallel agents by cluster
(card-core / content cards / media+terminal cards / canvas chrome+overlays /
dialogs+previews / graph), each writing TSX edits directly and CSS to a scratchpad
fragment; orchestrator assembled the six attributed sections onto the end of
`assets/index.css` (6908 → 9450 lines, section banner `Slice 5: canvas + graph`),
cross-checked all 294 new class definitions against TSX references (zero missing,
both directions), then ran gates.

- **New class vocabularies**: `.canvas-card*` extended in place (state ring moved from
  a 4-branch inline ternary to `data-selected/-terminal/-active` + `--focused/--locked`
  modifiers; priority selected < focused < locked < active by source order at equal
  specificity), `.canvas-card-skeleton*`, `.canvas-lod-preview*`, `.te-metadata-grid*`,
  `.te-card-badge`, `.te-saved-badge`, `.te-cluster-*`; per-card `.te-notecard-*`,
  `.te-mdcard-*`, `.te-textcard-*`, `.te-codecard-*`, `.te-fileview-*`, `.te-wbfile-*`,
  `.te-folder-*`, `.te-sysart-*`, `.te-blockcard-*`; media `.te-imgcard-*`,
  `.te-pdfcard-*`, `.te-termcard-*`, `.te-termdock-*`; chrome `.te-cv-*` (toolrail,
  surface, minimap, zoom, section/drag overlays, edge layer, split editor, shortcut
  sheet); dialogs `.te-savecard-*`, `.te-import-*`, `.te-ontology-*`, `.te-foldermap-*`;
  graph `.te-graph-*`.
- **`.te-float-chip` invariant honored**: canvas toolrail and all graph floating chips
  (statusrail, settings gear, Fit All, zoom readout) compose it; ZoomIndicator and
  CanvasMinimap deliberately do NOT (their `.canvas-zoom-indicator`/`.canvas-minimap`
  glass recipe — `--canvas-hud-bg` + blur — is richer than the flat chip rail and
  composing would regress it).
- **Spotcheck findings fixed before checkpoint**: CardShell title font-size (static
  `CARD_TITLE_FONT_SIZE_PX - 0.25` inline → `calc(var(--env-card-title-font-size) -
  0.25px)` in CSS) and anchor-dot per-side offsets (static lookup → `data-side`
  attribute rules).

Verify: `npm run check` green (331 files / 4051 tests — identical to the slice-4
baseline, zero tests lost), build exit 0, spotcheck-verifier PASS on all six checks
(scripted fragment-vs-assembled value diff: zero mismatches; full-file duplicate-
selector scan: 9 cross-section duplicates, all additive/disjoint; orphan sweep clean
both directions). Live CDP probe against `npm run dev:debug`: canvas toolrail
positioned via `.te-cv-toolrail` on float-chip recipe, card renders with shadow-card +
the slice-2 transition triple (transform/box-shadow/border-color) intact + Manrope
titlebar; graph statusrail chips on float-chip flat rail (`rgb(3,3,5)`, mono 0.75rem),
drawer parked at `translateX(340px + 24px)` with 0.22s spring; `--t-spring` resolves
live. Screenshots of both surfaces eyeballed clean.

## Landmines

- **`--t-spring` is CSS-only** (like `--t-reveal`): `Theme.tsx` re-emits only
  micro/fast/med/slow/surface from `transitions.*` — do not add spring to tokens.ts
  without also updating Theme.tsx, and don't "fix" the asymmetry mid-slice.
- **`--env-card-title-font-size` fallback mismatch**: index.css `:root` says 12px but
  `Theme.tsx:114` overrides to 13px (`CARD_TITLE_FONT_SIZE_PX`) on mount. The live
  card title is 12.75px via calc; anything reading the CSS file value pre-mount (or
  happy-dom) sees 11.75px. Slice-7 gates tests must read computed styles live.
- **`.canvas-card` state rules depend on source order**: the slice-5 section's
  selected/focused/locked/active box-shadow rules sit at equal specificity AFTER the
  slice-2 blocks and in that internal order — inserting rules between them changes
  card state rendering. Same for `.te-termdock-pill` overriding `.terminal-pill`
  border-radius by append order.
- **Compound selectors are deliberate**: `.canvas-zoom-indicator.te-cv-zoom-indicator`,
  `.canvas-toolbtn.te-cv-clear-btn:hover`,
  `.canvas-split-editor__header.te-cv-split-editor__headerbar` raise specificity so
  they win regardless of merge order — don't "simplify" them to single classes.
- **`.thread-input-textarea` min/max-height (22px/200px) duplicate
  MIN_INPUT_HEIGHT/MAX_INPUT_HEIGHT in `ThreadInputBar.tsx`** — the JS resize clamp is
  still the live consumer. Change together (a CSS comment marks it).
- **Happy-dom can't read the external stylesheet**: slice-4/5 test conversions assert
  class presence / data-attributes, not computed values (e.g. TerminalCard webview
  pointer-events, TerminalDock dot status). Pinned-px values are guaranteed only by
  CSS — candidates for the slice-7 visual-regression suite.
- **Glass literals** now at seven+ sites (`onboarding`, `.te-ctx-menu`,
  `.te-tray-popover`, `.te-palette-panel`, `.te-shell-welcome`, plus slice-5
  `.te-ontology-bar--preview`, `.te-foldermap-bar`, graph drawer/settings/enrich
  panels) all mirroring `floatingPanel.glass`/popover values — fold into CSS vars in
  slice 7 alongside the gates test.
- **NoteCard sets `wrapper.style.cssText` imperatively** (~line 188) on a
  mermaid-injection DOM node — not JSX `style=`, doesn't trip the grep gate; left
  as-is deliberately.
- **EdgeLayer/FolderMapPreview use SVG presentation attributes** (stroke/fill/x/y)
  with runtime values — attributes, not `style=`; out of gate scope by design.
- **npm audit has 9 pre-existing vulnerabilities** (3 high, sharp/libvips,
  GHSA-f88m-g3jw-g9cj). No dependency changed in slices 4–5; needs a separate deps
  pass.
- **rem conversions assume the 13px root** (`--ui-fs`). Layer 4 may retune the root;
  rem scaling with it is intended — don't "normalize" rem→px.
- **Hover-reveal CSS uses deliberate specificity ordering** (slice 2). Slice-4/5
  sections split properties (layout in new sections, color/state in the hover section)
  for `.side-dock-ribbon-action`, `.resize-handle*`, `.canvas-card__actions/__resize/
  __anchor` — keep the split disjoint.
- **Visual-verify tricks**: settings modal via
  `window.dispatchEvent(new Event('te:open-settings'))`; approvals tray via
  `.te-tray-trigger`; palette via synthetic ⌘K; canvas/graph via the side-dock ribbon
  "Open canvas"/"Open graph" aria-labels; add a card via `[data-testid=canvas-add-card]`
  then first `[role=menuitem]`. CDP driver from this slice:
  session scratchpad `cdp.js` (run with `NODE_PATH=<repo>/node_modules`); not tracked.
- **CanvasToolbar React gotcha** (regression-tested): never read `e.currentTarget`
  inside a setState updater — capture rects before setState.
- **Cursor's background git worker + GitLens `gk mcp` hold `.git/index.lock`**
  intermittently — a commit can fail then succeed on retry. Don't `rm` the lock without
  confirming no git process is mid-operation.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json`** — `git restore` it
  before every commit; never commit it. (Slice 5 ran `npm run check` + build only;
  fixture verified clean via `git status`.)
- eslint uses `--cache`; run `npx eslint --no-cache` when a stale result looks
  suspicious. npm installs need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored and is the sole operator doc. Item-2 completion invariants
  get added to it in slice 7, not before.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
