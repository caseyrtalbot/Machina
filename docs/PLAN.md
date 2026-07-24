# Machina — Plan of Record

**This is the only active plan.** Approved 2026-07-21; amended 2026-07-22 (vision
ratification, layered restructure, ADRs 0004–0005). Any other document describing
future work is wrong; if you find a conflicting plan, stop and flag it. Shipped-work
evidence lives in git history; the surviving reference for shipped interfaces is
`docs/architecture/interface-contracts.md`.

## Identity (settled — do not re-litigate)

Machina is **the governed workbench for agents you don't own**: run any agent — CLI
or MCP client — against your real files and knowledge; every write is attributed,
gated through one approval queue, committed with provenance, and revertable
wholesale; every turn is observable as structured blocks; every harness carries a
scope, a budget, and a verification script; a harness that has earned trust can loop
unattended under the same brakes.

The core loop the product exists to serve:
**brief** (harness: scope globs + budget + verify.sh) → **dispatch** → **observe**
(blocks stream into the thread) → **verify** (verify.sh exit code badges the turn) →
**approve/revert** (tray) → **loop** unattended once trusted.

Structurally, Machina is a thread-centric agent workstation: each thread carries its
workspace (dock tabs), and every surface is chrome arranged around that. The spatial
canvas is a document type (ADR 0003) whose long-term future is a system-arranged
projection surface (ADR 0004). Appearance is a set of ratified constants, not
preferences (ADR 0005).

Ratified decisions:

| # | Decision |
|---|----------|
| D1 | Canvas = document type. The workstation-era "zoom-out IS the supervisor lens" vision is retired; agent supervision lives in the dock, tray, and thread panels. (2026-07-21, ADR 0003) |
| D2 | Canvas and graph both stay for now; convergence is re-evaluated under the ADR 0004 projection frame, after the primitives pass. |
| D3 | Health demotes from a dock surface to a status-bar popover. Ghosts stays a surface for now; revisit as a graph/editor affordance when its dock tab is next touched. (2026-07-21) |
| D4 | Spatial authoring is descoped; the canvas chassis is retained for a post-loops projection surface. (2026-07-22, ADR 0004) |
| D5 | Design constitution: constants over configuration; appearance settings deleted; one styling mechanism (tokens + `te-` classes, Tailwind removed). (2026-07-22, ADR 0005) |
| D6 | **Track exit bar: this track is done when Loop Runner v0 ships** (Layer 3). No layer's polish or consolidation extends past it. Rationale: five audit-plan-scrub cycles in 19 weeks all died parking the product feature behind open-ended consolidation; the exit bar is the structural fix. (2026-07-22) |

## Active track: layered build to Loop Runner v0

Layers ship in order; a layer is done when its verify gates pass and `npm run check`
is green. Layer 4 items may start once their stated dependencies exist.

### Layer 0 — Integrity (docs tell the truth; dead code deleted) — COMPLETE 2026-07-22

1. Fix the false MCP transport claims: `docs/architecture/safety-subsystem.md` states
   the transport is never connected in production and `CLAUDE.md` repeats it, but
   `src/main/index.ts` starts Streamable HTTP on every vault open (ADR 0002).
   → verify: docs match code; grep finds no stale claim.
   (Completed 2026-07-22, commit debe976; residual-claim grep re-run clean after
   items 2–3 landed.)
2. Per-launch bearer token on the MCP endpoint (currently Host-header check only on
   127.0.0.1:41627, including 7 ungated read tools).
   → verify: a transport test rejects a tokenless request.
   (Completed 2026-07-22, commit be71003; tokenless and wrong-token transport tests
   pass; `MCP_TOOL_COUNT` unchanged at 12.)
3. Delete confirmed-dead code: `vendor/tmux` + `resources/tmux.conf` (retired
   librarian v1); section/cluster synthesis (`section-rewriter`, `section-rematch`,
   `section-projection`, `ClusterDraftSchema` — consumers with no producer);
   `ElectronHitlGate` (superseded by QueueHitlGate); librarian/curator renderer
   residue (`FilesDockAdapter` label filters, `activeVaultAgent`, their token colors).
   → verify: knip stays clean; greps for the deleted names return nothing.
   (Completed 2026-07-22, commit 0be971a, with one evidence-forced exception: the
   three section modules are LIVE via the File View canvas card, so only
   `ClusterDraftSchema` of that group was dead and deleted — see HANDOFF. Deleted-name
   greps clean; knip strictly improved over its pre-deletion baseline;
   `TimeoutHitlGate` verified test-only and deleted alongside `ElectronHitlGate`.)

### Layer 1 — Foundations (one spine each: primitives, styling, writes, tools, truth)

1. Phase 2 primitives, remaining slices (same method — migrate all consumers in
   the same slice). **Item complete 2026-07-22**: all three remaining slices
   shipped with their gates green.
   - `PanelHeader` — one header/toolbar pattern for Ghosts, Graph, Editor, and canvas
     toolbar chrome.
     (Completed 2026-07-22: `components/panelheader/PanelHeader.tsx` un-orphans the
     `te-panel-header` CSS as `bar` (thread panel, thread sidebar, files sidebar
     action bar, editor mode bar) and `masthead` (ghosts, health) variants; the
     graph's floating chips/buttons and the canvas toolrail take their chrome from
     the new `.te-float-chip` recipe instead of inline glass styles. Invariant
     gates, all grep-clean: `te-panel-header` appears in TSX only inside the
     primitive; `editor-mode-bar`, `sidebar-action-bar`, and
     `sidebar-section-bar-left` return nothing; `floatingPanel.glass` is no longer
     referenced in GraphPanel.tsx.)
   - `EmptyState` — collapse `CanvasEmptyStates.tsx`, `EmptyDockState`, and per-panel
     bespokes; unify the three loading patterns while there.
     (Completed 2026-07-22: `components/emptystate/` ships EmptyState (card/plain,
     overlay, align, height), Spinner (`.te-spinner`), and LoadingState; migrated
     canvas welcome/empty-vault, dock, thread, ghosts, graph, editor, and health
     empty states plus the App/ImageCard/PdfCard spinner rings and the
     NoteCard/FileViewCard/mermaid/DockTabContent loading texts; skeleton
     (CardShellSkeleton) and tool-card shimmer stay as the single implementations
     of their patterns. Invariant gates, all grep-clean: `animate-spin` and the
     `border-t-transparent` ring recipe return nothing; the check-circle path is
     declared only in CheckCircleIcon.)
   - Consolidate every menu on `components/ContextMenu.tsx`; retire the canvas,
     editor, and sidebar variants.
     (Completed 2026-07-22: wrapper components CanvasContextMenu, CardContextMenu,
     EditorContextMenu, FileContextMenu retired to `ContextMenuEntry[]` builders;
     CardShell ConvertMenu and the CanvasToolbar zoom/tile popovers folded onto the
     primitive; AgentPicker corrected to `role="listbox"`. Invariant gates, all
     grep-clean: retired component names return nothing; `role="menu"`/`menuitem`
     exist only in ContextMenu.tsx; no parallel item-model type survives.)
   (Slices 1–2 — Modal/Overlay and TabBar — completed 2026-07-21/22, commits
   638e2ef and c04ffc1, with greppable invariant gates that continue to hold.)
2. Design constitution lands (ADR 0005): delete the eight appearance-settings axes
   from settings UI and `settings-store`; remove Tailwind and converge styling on
   tokens + `te-` classes; stand up the enforcement machinery (contrast unit tests,
   dev-only component gallery route, Playwright visual regression over gallery +
   shell). → verify: ADR 0005 greppable gates pass.
   (Completed 2026-07-24 across seven slices, 2026-07-21→24. All eight appearance
   axes deleted; Tailwind engine and both deps removed; styling converged on tokens +
   `te-` classes. Enforcement machinery, all in-tree: six strict gates in
   `tests/design/greppable-gates.test.ts`; 35 WCAG assertions in
   `tests/design/contrast.test.ts` (muted-text 4.5:1 shortfall pinned at ≥4.0 for the
   Layer 4 retune); dev gallery `design/Gallery.tsx` behind `?gallery=1`
   (`TE_GALLERY=1` for packaged runs); 13 Playwright baselines in
   `e2e/visual.spec.ts`.)
3. One write spine: route ghost-emerge and graph-enrichment writes through
   PathGuard + `writeStampedNote` + ApprovalQueue, retiring the bespoke
   `claude-cli.ts`/`ghost-emerge.ts` path's ungated writes.
   → verify: no agent-originated vault write outside `note-write.ts` (grep); a ghost
   synthesis produces an approvals-tray diff.
4. One tool surface: the native agent converges on the MCP tool surface; Spotlighting
   wraps all agent-facing vault reads (closing the asymmetry where the path holding
   write tools reads unwrapped content).
   → verify: duplicated native-tool read/write/canvas implementations deleted; native
   read path wrapped.
5. One index authority: the main-process VaultIndex is the single truth; the renderer
   vault-worker becomes a diff-fed projection; `system-artifact-runtime`'s inline
   parse is removed. → verify: one parse+graph ingestion path (grep).
6. Surface registry (was Phase 3): collapse the five-touchpoint surface enumeration
   (ribbon, palette sources, keybindings, `DockTabContent` switch, `dock-types.ts`)
   into one registry the others derive from; execute D3 (Health → status-bar popover)
   as the first registry change. → verify: adding or removing a surface is a
   one-site change.
7. One editor per note (ADR 0004 §5): canvas note-opens route through
   `openNoteInEditor`; retire `CanvasSplitEditor`.
   → verify: no canvas code path opens a note outside `openNoteInEditor`.

### Layer 2 — Signal (observability becomes control)

1. Blocks move home: shell-hook install on terminal-strip session creation;
   per-session block view in the strip and per-turn block timeline in threads; canvas
   pinning stays as the evidence-card affordance.
   → verify: `installHooks`/`block-pin` no longer imported only from `panels/canvas`;
   a command in a strip terminal yields a structured block inline.
2. Turn verdicts: correlate a harness turn's verify.sh block exit code with its turn
   window; render a pass/fail chip on the thread turn and tray row; audit entry on
   failure. → verify: nonzero exit shows fail, zero shows pass, absent verify.sh
   shows nothing.
3. Durable budgets: persist per-slug turn counts and spend under userData; enforce
   `maxTurns`/`maxSpendUsd` across app relaunches (today all enforcement state is
   per-process memory). → verify: trip a budget, relaunch, dispatch is still refused
   with an audited reason.

### Layer 3 — Engine (the exit bar)

Loop Runner v0 (`LoopRegistry`): re-dispatch a bound harness turn on timer or
verify-failure; durable budgets and breaker trips disarm the loop; queue-by-default
writes; ⌘. disarms. The spec is written fresh against Layer 1–2 primitives (the loops
re-spec from the 2026-07-21 disposition; old workstation specs are background only).
→ verify: an unattended multi-turn run completes with every write attributed in the
tray, halts at its budget with an audit entry, survives an app relaunch without its
budget resetting, and ⌘. disarms it.
**Shipping this closes the track (D6).**

### Layer 4 — Face (the moat becomes visible, then installable)

1. Fleet home surface (after Layer 2): thread sidebar + tray show per-agent status
   (running / gated / breaker-tripped / gateDegraded), live spend against budget,
   pending-write count, and one-click `revertAgent` — all without opening a dock
   surface. Includes the small affordances that teach the per-thread workspace model
   (surface indicators on thread rows, dock transition on thread switch).
2. Constitution retune passes (after Layer 1 item 2; bounded — replaces the old
   open-ended Phase 4): OKLCH neutral ramp, type scale, elevation constants, motion
   vocabulary, tokenized interaction states — applied per-primitive so it propagates.
   → verify: ADR 0005 gates + visual-regression suite green; the retune checklist is
   enumerated up front and finishes.
3. Projection canvas re-founding (strictly after Layer 3; ADR 0004): agents, runs,
   and builds rendered as system-arranged projections; every card position derivable
   from data.
4. Distribution + story: Developer ID signing, notarization, auto-updater against a
   real feed; README and package.json rewritten to the governed-workbench identity
   (both currently market the retired spatial identity).
   → verify: a stranger downloads a release and runs a governed agent turn without
   cloning the repo.

## Disposition notes (2026-07-21 scrub, unchanged)

The workstation track's shipped work (Phases 0–2, Phase 3 steps 1–5) stands. The loop
scheduler (old steps 6–7) is now scheduled as Layer 3 above. Canvas agent session
cards, dock↔canvas migration, and the supervisor lens (old steps 8–9) remain retired
(ADR 0003).

## Backlog (unscheduled — re-verify before scheduling)

- ADR backfill for settled-by-history decisions: dark-only design, DOM canvas vs Pixi
  graph, the dock/singleton-editor model, Zustand store shape. Prevents the
  re-litigation that historically triggers new audit cycles.
- Store-layer hygiene, opportunistic only: break the two import cycles
  (dock-store↔thread-store; editor-store→system-artifact-runtime→dock-store) and lift
  module-level `window.api.on` subscriptions when those stores are next touched. No
  big-bang refactor.
- Worktree isolation as an optional per-harness mode. Post-hoc containment in the
  real working tree stays the default and the differentiator, argued as a feature.
- LSP languages incrementally (TS first); visual git map; MCP third-party hardening
  (hash-pinned tool descriptions).
- Graph/canvas convergence decision (D2), re-evaluated under the ADR 0004 projection
  frame.
- Extract `orchestrateLoad` from `App.tsx` into a callable module so vault switching
  (welcome card, ApprovalsTray, FilesDockAdapter) invokes it directly and the
  `te:open-vault` window-event indirection can be deleted.
- (Removed from backlog: "local-first fonts" — superseded by ADR 0005's system
  stack + bundled mono. "Distribution" — scheduled as Layer 4 item 4.)

## Invariants (every layer)

- `npm run check` green at every layer boundary; no red-gate completions.
- Safety posture only moves toward parity: approvals gate, audit, PathGuard, and
  Spotlighting behavior never regress.
- Terminal core + block protocol keep behavior and latency.
- Existing patterns extended, not paralleled (store shape, 4-step IPC registration,
  dock-adapter shape).
- **Feature admission gate:** every new capability names its home (thread, dock,
  tray, or statusbar) before it is built, or it is not built. Generalizes ADR 0003's
  regression clause; the April 2026 build-and-delete arc is the precedent.
- **Constitution gates are permanent once landed** (ADR 0005 enforcement list).
- Doc-reconciliation on every architecture change: this file, `CLAUDE.md`,
  and `docs/architecture/overview.md` stay consistent with the tree in the same
  commit.
