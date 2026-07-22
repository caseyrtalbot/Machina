# ADR 0004: Spatial authoring is descoped; the canvas's future is projection

**Status:** Accepted (2026-07-22)
**Extends:** ADR 0003 (canvas is a document type). Nothing here reopens 0003; this
records what the canvas is *for* going forward.

## Context

A 2026-07-22 cold review (six independent codebase reads plus a vision panel)
found `panels/canvas/` is the largest renderer directory (~14k lines) and that most
of its interior — ontology Organize, folder-map semantic augmentation, focus frames,
tiling, the split editor — serves the retired spatial-thinking identity. The review
also found the canvas's most durable mechanisms were built for automated writers,
not hand-arrangement: `canvas:apply-plan` optimistic-concurrency mutations,
`terminal-block` evidence cards, and the pan-zoom card surface itself.

The distinction that resolves "is a visualization canvas a different product?" is
**who arranges the cards**. If a human arranges cards to construct meaning, that is
spatial authoring — a PKM product. If the system projects structure (running agents,
turns, writes, verify verdicts, build topology) and the human inspects, pins, and
annotates, that is a projection surface — the visible face of Machina's governance
substrate.

## Decision

1. **Spatial authoring is out of scope.** The human-arranged spatial-thinking product
   is not part of this iteration and may become a separate product later. Its interior
   (ontology Organize, folder-map semantic augmentation, focus frames, tiling,
   `CanvasSplitEditor`) is **frozen**: no new investment, no polish passes. Parts the
   review confirmed dead are deleted (Plan of record, Layer 0). The rest stays frozen,
   not destroyed — git history is the archive.
2. **The canvas chassis is retained as the substrate for a projection surface**: the
   pan-zoom surface, the card system, `canvas:apply-plan`, and `terminal-block` cards.
   The future canvas renders agents, runs, and builds as system-arranged projections.
3. **Projection work begins only after Loop Runner v0 ships.** A projection surface
   built before the engine has nothing real to project and would force invented
   content — the mechanism by which decorative features get built.
4. **The projection test** for any future canvas feature: every card position must be
   derivable from data, such that deleting all hand layout loses nothing except pins.
   A feature that fails this test belongs to the other product and is not built here.
5. **One editor per note.** Canvas note-opens route through `openNoteInEditor`; the
   `CanvasSplitEditor` fork is retired (Plan of record, Layer 1).

## Consequences

- The D2 graph/canvas convergence question is re-evaluated under the projection
  frame, where canvas (curated, pinnable) and graph (derived, topological) are both
  projections of system state — convergence becomes an implementation question, not
  an identity question.
- Canvas pinning of terminal blocks (evidence cards) survives as the bridge feature:
  it already satisfies the projection test.
- Reintroducing hand-arranged meaning-making features into Machina's canvas is a
  regression against this ADR.

Plan of record: `docs/PLAN.md`.
