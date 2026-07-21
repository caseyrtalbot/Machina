# Machina — Plan of Record

**This is the only active plan.** Approved 2026-07-21. Any other document describing
future work is wrong; if you find a conflicting plan, stop and flag it. Shipped-work
evidence lives in git history; the surviving reference for shipped interfaces is
`docs/architecture/interface-contracts.md`.

## Identity (settled — do not re-litigate)

Machina is a **thread-centric agent workstation**: each thread carries its workspace
(dock tabs), and every surface is chrome arranged around that. The spatial canvas is a
**document type** — something you open, like a note — not a home surface, not a default
target, not an agent-supervision lens. Full rationale and consequences:
[ADR 0003](architecture/adr/0003-canvas-becomes-a-document-type.md).

Decisions ratified 2026-07-21 (supersede workstation decisions Q1/Q6 where they
conflict; see ADR 0003):

| # | Decision |
|---|----------|
| D1 | Canvas = document type. The workstation-era "zoom-out IS the supervisor lens" vision is retired; agent supervision lives in the dock, tray, and thread panels. |
| D2 | Canvas and graph both stay for now (DOM vs Pixi discontinuity acknowledged); convergence is re-evaluated only after the primitives pass, as a separate decision. |
| D3 | Health demotes from a dock surface to a status-bar popover. Ghosts stays a surface for now; revisit as a graph/editor affordance when its dock tab is next touched. |

## Active track: UI refactor

Goal: the continuity of Cursor/Claude Desktop — one primary surface model, one set of
UI primitives, chrome with opinions. Grounded in the 2026-07-21 renderer audit
(three tab-bar implementations, four context-menu implementations, ~nine bespoke
modal/overlay implementations, divergent empty/loading states, canvas-privilege residue
in shell and stores).

### Phase 1 — Excise canvas privilege (complete 2026-07-21)

1. Remove the active-canvas proxy (`dock-store.ts` `syncActiveCanvas`/`setActiveCanvas`).
   Palette/sidebar actions that target "the canvas" take an explicit canvas context or
   disable when none is focused.
   → verify: no proxy consumers remain (grep), `npm run check` green.
2. Move the canvas autosave subscription out of `App.tsx` boot into the canvas
   surface's own lifecycle. (Scoped 2026-07-21: the `te:open-vault` listener stays
   app-level — it is the general vault-switch mechanism, dispatched by ApprovalsTray
   and FilesDockAdapter too, and its handler needs App-coupled `orchestrateLoad`.
   Retiring the window-event indirection is a backlog item.)
   → verify: autosave fires on canvas edit.
3. Fold `panels/workbench/` into `panels/canvas/` (it is canvas internals) and replace
   its 12 hardcoded hex values with tokens in the same move.
   → verify: `project-file`/`system-artifact` cards render unchanged.
4. The canvas-only dock-tab `id` stays (multiple canvases are real); document it where
   the special case lives.

### Phase 2 — Primitives kit + migration

Build in `src/renderer/src/components/`, one primitive per slice, migrating all
consumers in the same slice so nothing ships unused:

1. `Modal`/`Overlay` — shared scrim, focus trap, escape, positioning. Migrate
   SettingsModal, CommandPalette, HarnessGallery (delete `HarnessGallery.css`),
   HarnessTaskBriefDialog, ApprovalsTray popover, ImportPalette, SaveTextCardDialog,
   OnboardingOverlay. (complete 2026-07-21, commit 638e2ef — plus the canvas
   ShortcutOverlay, a ninth consumer the survey missed)
2. `TabBar` — extract from `DockTabBar.tsx` (most complete: drag/reorder, context menu,
   animated close); adopt in editor note-tabs and terminal strip.
3. `PanelHeader` — one header/toolbar pattern for Ghosts, Graph, Editor, and canvas
   toolbar chrome.
4. `EmptyState` — collapse `CanvasEmptyStates.tsx`, `EmptyDockState`, and per-panel
   bespokes; unify the three loading patterns while there.
5. Consolidate every menu on `components/ContextMenu.tsx`; retire the canvas, editor,
   and sidebar variants.

Each slice: `npm run check` + visual pass in the running app; spotcheck-verifier over
the batch when the phase completes.

### Phase 3 — Surface registry

Collapse the five-touchpoint surface enumeration (ribbon, palette sources, keybindings,
`DockTabContent` switch, `dock-types.ts`) into one surface registry the others derive
from. Includes executing D3 (Health → status-bar popover) as the first registry change.

### Phase 4 — Micro-polish

Spacing rhythm, transition timing, hover/focus states, typographic scale — applied
per-primitive so it propagates everywhere. Only starts once Phases 1–3 are done.

## Merged track: loops (from the workstation plan)

The workstation track's shipped work (Phases 0–2, Phase 3 steps 1–5) stands; its open
scope was dispositioned 2026-07-21:

- **Loop scheduler + autonomy policy** (old Phase 3 steps 6–7): still wanted — the
  trigger × prompt × agent primitive with queue-by-default writes. **Re-scoped and
  re-specced after the UI refactor** so it lands on the new primitives and registry.
  The old specs were removed in the 2026-07-21 scrub; use git history only as
  background, not as the spec.
- **Canvas agent session cards + dock↔canvas migration** (old step 8): **retired** (ADR
  0003).
- **Supervisor lens** (old step 9): **retired** (ADR 0003).
- **Old Phase 4** (LSP languages, Pixi git map, worktree isolation, MCP third-party
  hardening): unscheduled backlog, below.

## Backlog (unscheduled — re-verify before scheduling)

Known-open residuals; everything else from prior plans either shipped or was
deliberately dropped:

- Distribution: Developer ID signing + notarization; enable the auto-updater against a
  real update feed (runtime ships disabled).
- Local-first fonts (bundle default woff2, Google Fonts only for user picks) — verify
  current state before scheduling.
- LSP languages incrementally (TS first); visual git map; worktree isolation if
  parallel agent usage demands it; MCP third-party hardening (hash-pinned tool
  descriptions).
- Graph/canvas convergence decision (D2 follow-up, after Phase 2).
- Extract `orchestrateLoad` from `App.tsx` into a callable module so vault switching
  (welcome card, ApprovalsTray, FilesDockAdapter) invokes it directly and the
  `te:open-vault` window-event indirection can be deleted.

## Invariants (every phase)

- `npm run check` green at every phase boundary; no red-gate completions.
- Safety posture only moves toward parity: approvals gate, audit, PathGuard, and
  Spotlighting behavior never regress.
- Terminal core + block protocol keep behavior and latency.
- Existing patterns extended, not paralleled (store shape, 4-step IPC registration,
  dock-adapter shape).
- Doc-reconciliation on every architecture change: this file, `CLAUDE.md`/`AGENTS.md`,
  and `docs/architecture/overview.md` stay consistent with the tree in the same commit.
