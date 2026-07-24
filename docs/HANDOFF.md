# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `CLAUDE.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 2 — design constitution (ADR 0005) — IN
PROGRESS. **Slices 1–6 of 7 COMPLETE** (slice 1: `87da027` 2026-07-22; slice 2:
`c7b2b89` 2026-07-23; slices 3–5: 2026-07-23; slice 6: this checkpoint, 2026-07-24).
Slice 6 converted the last four panels (editor, sidebar, ghosts, health) and **removed
the Tailwind engine entirely** (vite plugin, `@import`, both deps). Next: **slice 7 —
the off-palette hex pass + enforcement machinery**, which completes item 2.

## Item 2 scope: the six greppable gates + enforcement machinery

ADR 0005 §Enforcement defines six greppable gates that must all pass for item 2, plus
three enforcement mechanisms. **The deep substrate retune (OKLCH neutral ramp, modular
type scale, four elevation tuples, easing pair) is explicitly Layer 4 item 2, NOT this
item.** This item converges the *mechanism* (one styling path: tokens + `te-` classes);
Layer 4 later retunes the token *values*. Do not pull Layer 4 work forward.

Gate status after slice 6:

| Gate | Status |
|---|---|
| Appearance axes in `settings-store` | **CLOSED (slices 1 + 3).** |
| Zero Tailwind | **CLOSED (slice 6).** Zero utility class-strings repo-wide; engine off: `tailwindcss()` removed from `electron.vite.config.ts`, `@import 'tailwindcss'` replaced by a vendored compiled prelude at the top of `assets/index.css`, both deps out of package.json + lockfile. Held by `tests/main/vite-build-entries.test.ts` ("has no Tailwind engine"); slice 7's gates test adds the repo-wide grep. |
| Zero static inline `style={{}}` | **CLOSED modulo documented exemptions (slice 6).** Panel survivors are all runtime-computed except two forced-inline cases (see landmines: SectionLabel). Slice-6 exemptions: editor 9 (FrontmatterHeader 2, PropertyInputs 2, BacklinksPanel 4, OutlinePanel 1), sidebar 8 (FileTree 5, Sidebar 2, TagBrowser 1), ghosts 3. Canvas 28 + graph 2 + components 10 documented in slices 3–5. Slice 7's gates test must encode this exemption list. |
| Zero off-palette hex | **OPEN — this is slice 7's first half.** ~26 pre-recon production violations plus literals carried verbatim by slices 5–6 (`#dfa11a`, `#3dca8d`, `#050607`, glass rgba recipes, shadow rgba()s). Also fix the three latent `var(--x)NN` bugs (see landmines) in the same pass. |
| Zero `useState` hover | **CLOSED (slice 2, held).** Slice 6 removed 2 more (EditorBubbleMenu FormatButton). |
| Zero off-token `transition` | **CLOSED (slice 2, held).** Ratified vocabulary = `--t-micro/fast/med/slow/surface/reveal/spring` **plus the pre-existing exact-value tokens `--transition-hover` (150ms ease-out) and `--transition-focus-ring` (100ms ease-out)** — slice 6 standardized on: exact-value token when one exists, else `--t-fast` for 150ms-class fades (accepted ≤30ms deltas: RefreshButton, ConnectionAutocomplete). The slice-7 scanner must accept both vocabularies. |

Enforcement machinery (all greenfield — lands in slice 7): contrast unit test
(`tests/design/contrast.test.ts`), dev-only gallery (`design/Gallery.tsx` behind
`?gallery=1` DEV check), Playwright visual regression (`e2e/visual.spec.ts`), and the
strict `tests/design/greppable-gates.test.ts` landing last (transition scanner must
handle multi-line declarations and both transition vocabularies; style-exemption list
above; hex allowlist = palette definitions + vendored prelude).

## Slice plan (dependency-ordered)

1. **Settings axes deletion — DONE** (`87da027`).
2. **Hover + transitions — DONE** (`c7b2b89`).
3. **components/ + stragglers + font-axis deletion — DONE** (2026-07-23).
4. **agent-shell/ — DONE** (2026-07-23).
5. **canvas/ + graph/ — DONE** (2026-07-23).
6. **editor + sidebar + ghosts + health + engine removal — DONE** (this checkpoint).
7. **Hex pass + enforcement machinery** (NEXT) — fix ~26 off-palette violations + carried
   literals + the three `var(--x)NN` bugs; land the four tests/routes; mark PLAN.md
   item 2 complete; add completion invariants to CLAUDE.md.

## What shipped last (slice 6)

Scope: all of `panels/editor/`, `panels/sidebar/`, `panels/ghosts/`, `panels/health/`,
then the engine flip. Five parallel agents by cluster (editor-meta / editor-core /
sidebar-shell / sidebar-sections / ghosts+health), each writing TSX edits directly and
CSS to a scratchpad fragment; orchestrator assembled the five attributed sections onto
the end of `assets/index.css` under the `Slice 6` banner (byte-identical append,
verified), cross-checked 242 new class definitions against TSX references (zero missing
both directions), pruned two orphaned rules the conversion created (`.sidebar-vault-name`,
`.tree-directory-row[data-drop-target] > .truncate` — replaced by
`.te-filetree-dir-name` variant), then flipped the engine off.

- **New class vocabularies**: editor `.te-frontmatter-*`, `.te-prop-*`, `.te-backlinks-*`,
  `.te-outline-*`, `.te-edpanel-*`, `.te-findbar-*`, `.te-bubblemenu-*`, `.te-connauto-*`,
  `.te-slashmenu-*` (shared by slash + wikilink popups), `.te-codefile-*`,
  `.te-sourceeditor`, `.te-richeditor` (+ `.te-edpanel-prose` applied via Tiptap
  editorProps onto `.ProseMirror`); sidebar `.te-sidebar-*`, `.te-filetree-*`,
  `.te-searchbar-*`, `.te-wsfilter-chip`, `.te-rename-input`, `.te-tree-chevron`,
  `.te-vault-selector*` (incl. `__health-dot`), `.te-dailynote-*`, `.te-tagbrowser-*`,
  `.te-bookmarks-*`; `.te-ghostpanel-*`, `.te-health-*`. Existing vocabularies
  (`.tag-browser*`, `.vault-switcher*`, `.fm-*`, `.ghost-row*`, `.file-row-hover`)
  extended via compound selectors, never redefined.
- **Engine removal**: `assets/index.css` now opens with `@layer theme, base, components,
  utilities;` + fonts import + a **vendored compiled Tailwind v4.2.2 prelude** (`@layer
  theme` = font/ease/default vars; `@layer base` = compiled preflight) extracted verbatim
  from the last engine-on build. Layered rules always lose to the unlayered app CSS —
  identical cascade semantics. The dropped utilities layer contained only 38 bare
  single-word scanner false positives (`flex`, `hidden`, …) with zero real references
  (grep-proven). Pre/post-flip dist CSS compared at selector level: only deltas are the
  dead utilities/`--tw-*` registrations, LightningCSS `color-mix` `@supports` fallback
  duplication (Chromium always took the branch post-flip CSS now states directly), and
  cosmetic normalization. Two tests updated to assert the new state (vite-entries:
  engine absent; FileTree: typography via `.te-filetree-file-row` class, not inline).

Verify: `npm run check` green — **331 files / 4052 tests** (baseline 4051 + 1 new
engine-absence test), lint + typecheck clean. Build exit 0 post-flip. `npm audit`
unchanged (9 pre-existing, sharp). spotcheck-verifier PASS on all six checks (zero
Tailwind class-strings; exemption counts exact; repo-wide tailwind refs = prose comments
only; prelude once, banner at end, no fragment duplication; 12+6 cross-reference samples
clean; diff exactly in scope — 33 files). Live CDP probe against `dev:debug`: preflight
live (border-box, body margin 0), `--font-sans`/`--t-spring` resolve, file-tree rows
13px Manrope flex via pure CSS; screenshots of editor (frontmatter header, mode toggle,
rich prose), ghosts (EmptyState), health (masthead + issue rows) eyeballed clean.

## Landmines

- **Vendored prelude is a compiled artifact**: the `@layer theme`/`@layer base` blocks at
  the top of index.css came from Tailwind's compiler output. Don't hand-tune them; don't
  remove the `@layer` statement (unlayered-beats-layered is what preserves cascade
  parity). `--font-sans` there is shadowed by the app's own `:root --font-sans` (line
  ~600) — both exist on purpose.
- **SectionLabel forces two inline styles** (`BacklinksPanel.tsx:294` fontSize,
  `GhostPanel.tsx:336` color): it merges `baseStyle` INLINE, so classes can't override.
  Slice-7 gates test must exempt them, or grow SectionLabel a size/color variant prop
  first (recommended follow-up, not mid-slice).
- **Three latent `var(--x)NN` color bugs** reproduced pixel-identically, commented in the
  slice-6 CSS: PropertyInputs boolean on-track tint + list add-pill border,
  FrontmatterHeader source-link underline — all render as if the color were absent
  (invalid var()+hex-suffix syntax predates the slice). Fix in the slice-7 hex pass.
- **Imperative animation literal** `'te-scale-in 150ms ease-out'` set via
  `container.style.animation` in slash-command.tsx + wikilink-suggestion.tsx (non-JSX
  DOM nodes, out of gate scope like NoteCard's cssText). Tokenize only if the slice-7
  scanner is extended to imperative styles.
- **Stale e2e test (pre-existing)**: `e2e/app.spec.ts:200` still exercises the removed
  File Tree font-size slider (ADR 0005 slice 1 deleted the axis) — fails independent of
  slice 6. Delete or rewrite it in slice 7 alongside `e2e/visual.spec.ts`.
- **Transition vocabulary is now two-tier** (see gate table): `--t-*` + exact-value
  `--transition-hover`/`--transition-focus-ring`. Don't "unify" them mid-item; Layer 4
  owns the retune.
- **`--t-spring`, `--t-reveal` are CSS-only** (Theme.tsx re-emits only
  micro/fast/med/slow/surface). Unchanged from slice 5.
- **`--env-card-title-font-size` fallback mismatch** (index.css 12px vs Theme.tsx 13px on
  mount) — slice-7 gates tests must read computed styles live. Unchanged from slice 5.
- **Append-order dependencies**: slice-5 `.canvas-card` state rules; slice-6
  `.sidebar-popover-item.te-vault-selector__recent/__open-different` win their
  equal-specificity tie against `.sidebar-popover-item:hover` only because the slice-6
  section is later in the file. Inserting rules between sections can flip states.
- **Compound selectors are deliberate** (specificity raises): slice-5 set, plus slice-6
  `.file-row-hover.te-filetree-file-row`, `.tag-browser__chip.te-tagbrowser-chip`,
  `.sidebar-vault-button.te-vault-selector__button` — don't simplify to single classes.
- **`.thread-input-textarea` min/max-height duplicates JS clamps in ThreadInputBar.tsx**
  — change together. Unchanged from slice 5.
- **Happy-dom can't read the external stylesheet**: tests assert class presence /
  data-attributes only (FileTree.test.tsx:174 is the slice-6 example). Pinned-px values
  are CSS-only — candidates for `e2e/visual.spec.ts`.
- **Glass literals** now at 9+ sites (slice-5 list + slice-6 `.te-slashmenu-panel`,
  `.te-bubblemenu`) mirroring `floatingPanel.glass` — fold into CSS vars in slice 7
  alongside the gates test.
- **npm audit has 9 pre-existing vulnerabilities** (3 high, sharp/libvips). Slice 6
  *removed* two deps, added none; still needs a separate deps pass.
- **rem conversions assume the 13px root** (`--ui-fs`); slice 6 added more (editor
  paddings, popup sizes). Layer 4 retune scaling with the root is intended.
- **Visual-verify tricks**: settings modal via `window.dispatchEvent(new
  Event('te:open-settings'))`; ghosts/health via side-dock ribbon "Open ghosts"/"Open
  health" aria-labels; editor via "Open editor" + file-row click. CDP driver:
  session scratchpad `slice6/cdp.js` (plain Node, no deps; finds the non-devtools page
  target on :9222); not tracked.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json`** — `git restore` it
  before every commit; never commit it. (Slice 6 ran check + build only; fixture
  verified clean via `git status`.)
- **Cursor's background git worker + GitLens hold `.git/index.lock`** intermittently — a
  commit can fail then succeed on retry; don't `rm` the lock blindly.
- eslint uses `--cache`; `npx eslint --no-cache` if a result looks stale. npm installs
  need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored and is the sole operator doc; its Tailwind line was updated
  this slice. Item-2 completion invariants get added in slice 7, not before.
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
