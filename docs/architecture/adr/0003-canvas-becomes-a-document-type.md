# ADR 0003: The canvas becomes a document type

**Status:** Accepted (2026-07-21)
**Supersedes:** the "supervisor lens" and canvas-centric parts of the workstation
plan's ratified decisions Q1 and Q6 (that plan was removed 2026-07-21; git history).
All other workstation decisions stand.

## Context

Machina began as a spatial-canvas app and evolved into a thread-centric agent
workstation. The shell already reflects this: `AgentShell` composes a thread sidebar,
chat column, per-thread surface dock, ribbon, and status bar; the canvas is one of five
dock tab kinds. But the canvas retained privileged residue: a global active-canvas
proxy in `dock-store` (non-canvas tabs keep "the canvas" pointed at the last one
viewed), canvas subscriptions in app boot, and a `workbench/` directory that is
actually canvas internals. The workstation plan (2026-07-05) additionally ratified a
future where zooming out of the canvas IS the agent-supervision lens (Q1/Q6), with
canvas agent session cards and one-click dock↔canvas session migration (Phase 3 steps
8–9).

A 2026-07-21 renderer audit and product review concluded the app suffers from this
split identity: two competing answers to "what is the primary surface" produce
bolted-on chrome and prevent the continuity of apps like Cursor or Claude Desktop.

## Decision

1. **The canvas is a document type.** It is opened, like a note — never a home
   surface, never an implicit default target, never a supervision lens. UI actions that
   operate on a canvas require an explicit canvas context.
2. **Agent supervision lives in the dock, approvals tray, and thread panels.** The
   supervisor-lens vision (workstation Phase 3 steps 8–9: canvas session cards,
   dock↔canvas session migration, zoom-out lens) is retired, not deferred.
3. **Canvas and graph both remain for now.** The DOM-vs-Pixi rendering discontinuity is
   acknowledged; a convergence decision is deliberately postponed until after the UI
   primitives pass, when the cost of each option is visible.
4. **Health demotes to a status-bar popover; Ghosts remains a surface** pending a later
   look at making it a graph/editor affordance.

## Consequences

- The active-canvas proxy and boot-time canvas subscriptions are removed (Plan of
  record, Phase 1).
- `panels/workbench/` folds into `panels/canvas/`.
- The loop scheduler (workstation steps 6–7) survives but will be re-specced on the
  post-refactor shell; its queue-by-default write posture is unchanged.
- Multiple canvases stay supported (per-canvas store factory, canvas dock tabs keep
  their `id`).
- Anything reintroducing an implicit "current canvas" global is a regression against
  this ADR.

Plan of record: `docs/PLAN.md`.
