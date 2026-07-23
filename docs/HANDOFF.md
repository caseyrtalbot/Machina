# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `AGENTS.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) item 1 — Phase 2 primitives — COMPLETE 2026-07-22.
Next: Layer 1 item 2 (design constitution, ADR 0005).

## What shipped last

- `46bcfc8` — AGENTS.md resynced from CLAUDE.md (shared sections word-identical).
- `6fbbfbc` — slice 3, menu consolidation: every menu popup renders through
  `components/ContextMenu.tsx`. Wrapper components (CanvasContextMenu,
  CardContextMenu, EditorContextMenu, FileContextMenu) retired to pure
  `ContextMenuEntry[]` builders (`*-menu-entries.ts`); CardShell's ConvertMenu and
  the CanvasToolbar zoom/tile popovers folded onto the primitive (gaining keyboard
  nav + viewport clamping); the primitive gained `alignRight`; AgentPicker corrected
  to `role="listbox"`; RenameInput moved to `sidebar/RenameInput.tsx`.
- `9151bfb` — e2e flake fix: the canvas right-click spec now clicks (300, 80); the
  old (300, 300) intermittently landed on the pointer-events-auto empty-vault card
  ("subtree intercepts pointer events", confirmed from the Playwright trace).
- `1552ffe` — slice 4, empty/loading states: `components/emptystate/` ships
  EmptyState (card/plain, overlay, align, height), Spinner (`.te-spinner`, the one
  ring), LoadingState (the one text block), CheckCircleIcon. Migrated 14 call sites
  (canvas welcome/empty-vault, dock, thread, ghosts, graph, editor, health empties;
  App/ImageCard/PdfCard rings; NoteCard/FileViewCard/mermaid/DockTabContent loading
  text). CardShellSkeleton and the tool-card shimmer stay as their patterns' single
  implementations.
- `8d9aa24` — slice 5, PanelHeader: `components/panelheader/PanelHeader.tsx`
  un-orphans the `te-panel-header` CSS as bar/masthead variants (thread panel,
  thread sidebar, files sidebar action bar, editor mode bar; ghosts + health
  mastheads); graph chips/buttons and the canvas toolrail take chrome from the new
  `.te-float-chip` recipe.
- Verification per slice (recorded in each commit body): `npm run check` green
  (final suite 333 files incl. new primitive tests, all passing), production build
  exit 0, Playwright e2e 30 passed / 1 skipped from clean fixture state, knip diff
  vs pre-slice baseline empty each time, `npm audit --omit=dev` pre-existing only,
  CDP visual probes against the dev app with screenshots reviewed (menus, empty
  states, headers), spotcheck-verifier SHIP on slices 3–4.
- PLAN.md item 1 is marked complete with per-slice invariant-gate notes;
  AGENTS.md/CLAUDE.md gained three identical standing-invariant bullets (one menu
  primitive, one empty/loading vocabulary, one panel header pattern).

## Next step: PLAN.md Layer 1 item 2

Design constitution lands (ADR 0005): delete the eight appearance-settings axes from
settings UI and settings-store; remove Tailwind and converge on tokens + `te-`
classes; stand up enforcement (contrast unit tests, dev-only component gallery
route, Playwright visual regression). Execute as written in the plan.

## Landmines

- **Slice 5 spotcheck report is outstanding.** The spotcheck-verifier agent for the
  PanelHeader slice stalled twice without returning its report; all mechanical
  gates (typecheck, no-cache lint, full suite, build, e2e, knip, gate greps) were
  green and the visual probe was reviewed, so it was committed. If paranoid, re-run
  a spotcheck of `8d9aa24` against its commit message.
- **Ghost masthead not visually verified with live data**: the dev vault had zero
  unresolved references, so only the all-resolved empty state rendered. The
  masthead is unit-tested; eyeball it next time a vault has ghosts (subtitle color
  normalized primary → muted).
- **Intentional visual normalizations** shipped across slices (all listed in the
  commit bodies): 13px body text on ghost/health/editor empties, mono styling
  dropped from DockTabContent's suspense fallback, 44px hairline bars on sidebar
  action bar + editor mode bar, graph chips lost backdrop blur, thread empty title
  22 → 18px. If Casey flags a look, check the relevant commit body first — it was
  probably deliberate.
- **e2e runs rewrite `e2e/fixtures/test-vault/.machina/state.json` at runtime**
  (dock/panel state, plus Casey's real home path in `lastOpenNote`).
  `git restore` it before every commit; never commit it — it would reintroduce the
  personal-path leak scrubbed for release. The intercept flake fixed in `9151bfb`
  was caused by this same runtime state shifting panel widths mid-suite.
- **React gotcha caught by the visual gate** (regression-tested in
  CanvasToolbar.test.tsx): never read `e.currentTarget` inside a setState updater —
  it is nulled when the handler returns; the zoom-menu click crashed the whole
  AgentShell error boundary. Capture rects before setState.
- MCP clients still need the per-launch bearer token from `mcp:status`
  (rotates every launch; see `e2e/mcp-gate-confirm.spec.ts`).
- eslint uses `--cache`; run `npx eslint --no-cache` when a stale-file lint result
  looks suspicious. npm installs need `--cache /tmp/npm-cache-te`.
- `CLAUDE.md` is gitignored; `AGENTS.md` is its tracked twin — keep shared wording
  identical (resynced in `46bcfc8`, updated in every slice commit since).
- Skip-worktree gotcha: `git ls-files -v | grep ^S` before assuming an edit landed.
