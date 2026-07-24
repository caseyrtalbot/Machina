# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `CLAUDE.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) **item 4 — one tool surface — COMPLETE**
(2026-07-24; PLAN.md item 4 carries the completion note). **Next: Layer 1 item 5 —
one index authority** (main-process VaultIndex is the single truth; renderer
vault-worker becomes a diff-fed projection; `system-artifact-runtime`'s inline parse
removed; verify gate: one parse+graph ingestion path, grep).

## What shipped last (item 4 — one tool surface)

Two sequential implementers (note lane, then canvas lane) + orchestrator (docs,
gates), double-spotcheck-verified. Uncommitted at handoff-write time; this
checkpoint's commit is the whole diff (~19 files).

**Scope finding:** "converges on the MCP tool surface" landed at the implementation
layer, not the tool-name layer — the native agent keeps its 12 tool names/schemas
(relative paths, `edit_note`, dock tools have no MCP twins), but every vault-touching
implementation is now shared with the MCP lane.

**Changes:**

- **`src/shared/spotlighting.ts` (new)** — `SPOTLIGHT_BOUNDARY` + `wrapSpotlighting`
  moved verbatim from `mcp-server.ts`; new `unwrapSpotlighting` for display. Lives in
  `@shared` (not main/services) because the renderer's tool cards display the same
  output object the model receives, so they must unwrap — and only `@shared` serves
  both processes with ONE definition site.
- **Native reads wrapped + audited**: `read_note` wraps `content`; `search_vault`
  output changed `{hits}` → `{results}` (hits JSON serialized and wrapped once);
  `read_canvas` output changed to `{canvasId, snapshot}` (wrapped JSON of
  version/viewport/cards/edges). `list_vault`/`list_canvases` stay unwrapped
  (structured JSON — same exemption as MCP `search.query`). `read_note` and
  `edit_note`'s pre-read audit via `facade.readFile`; `read_canvas` path-audits via
  `facade.assertReadable`.
- **One facade instance**: `ToolContext.facade` (REQUIRED) is the same
  `VaultQueryFacade` the MCP server uses — `McpLifecycle` now exposes `getFacade()`;
  `index.ts` wires `setNativeVaultFacadeProvider(() => mcpLifecycle.getFacade())`.
  `write_note`/`edit_note` post-approval writes go through `facade.writeFile`
  (`agentId: 'native-agent'` + native tool label via new optional `tool` audit-label
  params, MCP defaults unchanged), gaining read-your-writes index refresh.
  `ToolContext.documentManager` deleted (echo suppression now flows via the facade's
  deps). Gate flow (emitPending/awaitApproval/autoAccept/rateLimiter) untouched.
- **`src/main/services/canvas-apply.ts` (new)** — one main-side canvas applier:
  `applyCanvasPlanToFile` (mtime precondition + `validateCanvasMutationOps` +
  `applyPlanOps` inside `enqueueCanvasWrite`) and `writeCanvasViewport`. Native
  `pin_to_canvas`/`unpin_from_canvas` became op builders over it (hand-rolled
  mutations deleted); `focus_canvas`'s viewport write moved into it; MCP
  `canvas.apply_plan` persists through it main-side — fixing the pre-existing bug
  where an accepted plan was silently dropped if the canvas wasn't open in the
  renderer (pinned by test). Native canvas tools stay UNGATED per ratified schema.
- **Bonus bug fix**: native unpin's edge cascade filtered on `from`/`to` but real
  edges use `fromNode`/`toNode` — it had never fired against real canvas files;
  converging onto `applyPlanOps` fixed it (fixtures corrected to real edge shape).
- **Renderer**: `ReadNoteCard`/`SearchVaultCard`/`ReadCanvasCard` unwrap for display.
  No legacy `hits` fallback (by design): search cards in already-persisted dev
  threads render 0 hits; new runs are correct.
- **New CI gate:** `tests/main/tool-surface.test.ts` — Spotlighting defined only in
  `src/shared/spotlighting.ts`; note-tools reads/writes via facade (no note-write
  import, no direct `writeStampedNote`); canvas-tools has zero `fs.writeFile` and
  imports the applier; mcp-server imports the applier. `write-spine.test.ts` Test2
  evolved (note-tools dropped from must-import list; must-NOT-call check added).
- **Docs (same commit):** `safety-subsystem.md` (invariant 3 wrapper location, native
  section flipped — Spotlighting yes, reads audited, facade-level provenance, canvas
  applier; Known Gap 2 deleted; Gap 1 extended with native list/search; code table +
  apply_plan rows), `overview.md` native-agent paragraph, local CLAUDE.md new
  one-tool-surface invariant line, NATIVE_TOOLS descriptions for the three wrapped
  reads.

**Verify evidence:** full `npm run check` green — **336 files / 4122 tests** (baseline
4112 + 10, +1 file), zero lint, zero type errors. `npm run build` exit 0. Two
spotcheck passes: 10/10 checks PASS (one facade instance confirmed by repo-wide
`new VaultQueryFacade` grep — only mcp-lifecycle + the separate headless mcp-cli
process; boundary-injection escape tests pass on read_note AND read_canvas paths;
no renderer consumer of the old shapes missed). `npm audit`: same 7 pre-existing
sharp/libvips vulns (no deps changed).

## Landmines

- **`tests/main/tool-surface.test.ts` is a permanent gate** alongside write-spine:
  new native tools returning vault content must wrap via `@shared/spotlighting` and
  route through the facade, or it bites.
- **`search_vault`/`read_canvas` output shapes changed** (`results`/`snapshot`
  wrapped strings). Anything new consuming native tool outputs must
  `unwrapSpotlighting` for display; the model-facing envelope is the contract.
- **MCP `canvas.apply_plan` now persists main-side** (was renderer-dispatch only).
  If renderer canvas state ever looks doubled, check the plan-dispatch path — today
  renderer applies in-memory + autosaves the same state, which is idempotent.
- **Native PATH_OUT_OF_VAULT denials are still not audited** (resolveInVault
  short-circuits before the facade; unchanged from before — enforcement intact,
  denial-logging absent on the native lane).
- **Optional hardening (not done, deliberate):** `canvas-apply.ts` has no
  self-referential "sole canvas writer" gate; the invariant is enforced caller-side
  in tool-surface.test.ts. Add one if the module grows call sites.
- **Visual verification gap:** the three changed tool cards are covered by unit
  tests (ToolCallRenderer 9/9) but were not eyeballed in a live native-agent run
  (needs real API spend). Cheap check when next in the app: run a native-agent
  "read note X" turn and confirm the tool card shows clean note text, not envelope
  markers.
- All prior landmines hold (design gates, visual baselines darwin-only, e2e fixture
  `state.json` rewrite — restore before commit; git index.lock retries; npm installs
  need `--cache /tmp/npm-cache-te`; skip-worktree check `git ls-files -v | grep ^S`).
