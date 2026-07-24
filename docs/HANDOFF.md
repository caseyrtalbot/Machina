# Handoff

Single-file handoff: **overwritten** at every clean checkpoint, never appended — git
history is the archive. A fresh agent starts here after reading `docs/PLAN.md` (the
canonical plan; do not restructure it) and `CLAUDE.md` (conventions + working protocol).

**Position:** Layer 1 (Foundations) **item 3 — one write spine — COMPLETE**
(2026-07-24; PLAN.md item 3 carries the completion note). **Next: Layer 1 item 4 —
one tool surface** (native agent converges on the MCP tool surface; Spotlighting
wraps all agent-facing vault reads; verify gate: duplicated native-tool
read/write/canvas implementations deleted, native read path wrapped).

## What shipped last (item 3 — one write spine)

Two parallel implementers (facade convergence, ghost-emerge gating) + orchestrator
(shared `createStampedNote` primitive, docs), spotcheck-verified. Uncommitted at
handoff-write time; this checkpoint's commit is the whole diff.

**Scope finding:** PLAN item 3 named ghost-emerge AND graph-enrichment, but
enrichment was already fully gated — it runs on the native-agent lane
(`EnrichmentPill` → native thread → `note-tools.ts` → `writeStampedNote` with HITL +
audit). The real ungated surface was ghost-emerge, plus `VaultQueryFacade.createFile`
(raw `open('wx')` write with a documented round-trip bug), which the grep gate pulled
into scope.

**Changes:**

- `src/main/utils/note-write.ts` — internal `stampFrontmatter` now shared by
  `stampProvenance` (modified_by/modified_at, behavior unchanged) and new
  `stampCreateProvenance` (created_by/created_at); new `createStampedNote` (exclusive
  `wx` create, EEXIST propagates, returns stamped content). Callers still own
  PathGuard + audit.
- `src/main/services/vault-query-facade.ts` — `createFile` converged onto
  `createStampedNote`, deleting the manual `matter.stringify` stamping and the
  FAST-FOLLOW round-trip bug (body starting with `---` now survives verbatim;
  regression-tested). PathGuard, `MissingIdError`, audit, `refreshIndex` all kept.
- `src/main/ipc/ghost-emerge.ts` — handler body extracted to exported
  `handleEmergeGhost(callClaudeFn, deps, args)`. After synthesis, the serialized note
  goes through `deps.gate.confirm` (tool `vault.emerge_ghost`, contentPreview capped
  4000 — the tray row's diff) BEFORE any folder creation or write. Denied → audit
  'denied', return `{ status: 'denied', reason }`, nothing touched. Allowed → mkdir +
  `createStampedNote(filePath, content, 'ghost-emerge')` + audit 'allowed'. Raw
  `openSync`/`writeSync` block deleted. Default gate with no deps is FAIL-CLOSED
  (denies, pinned test). `claude-cli.ts` remains synthesis transport only (sole
  consumer is ghost-emerge; it never writes).
- `src/main/index.ts` — production wiring: `registerGhostEmergeIpc(callClaude,
  { gate: new QueueHitlGate(getApprovalQueue()), audit: new AuditLogger(userData/audit) })`.
- `src/shared/ipc-channels.ts` — `vault:emerge-ghost` response is now the
  discriminated union `created | denied`; `src/renderer/src/hooks/useGhostEmerge.ts`
  branches on it (denied → notifyError, no editor open).
- **New CI gate:** `tests/main/write-spine.test.ts` — comment-stripped lane scan:
  `mcp-server.ts`, `vault-query-facade.ts`, `ghost-emerge.ts`, all of
  `machina-native-tools/` hold NO raw fs write primitives; only
  `note-write.ts`/`atomic-write.ts` may. Plus `src/main/ipc/__tests__/
  ghost-emerge-handler.test.ts` (allowed/denied/fail-closed/EEXIST — first-ever
  coverage of this write).
- **Docs (same commit):** `safety-subsystem.md` (new `vault:emerge-ghost` subsection;
  createFile fast-follow note replaced with converged status; `note-write.ts` row in
  the code table), `interface-contracts.md` (ghost synthesis added as third converged
  confirm surface under §4 v1.3.1), local CLAUDE.md invariant line updated to name
  both helpers + the CI test.

**Verify evidence:** full `npm run check` green — **335 files / 4112 tests** (baseline
4097 + 15), zero lint, zero type errors. `npm run build` exit 0. spotcheck-verifier:
all 7 checks PASS (scope discipline exact, gate-before-write ordering, facade parity,
AuditEntry/union cross-consistency, lane-gate bites without false positives, no
stampProvenance consumers broken, docs consistent). Live end-to-end check against the
built app + fixture vault: real synthesis raised gate-confirm row `gc_1` with the full
note as its 814-char diff; deny via `approvals:resolve` returned
`{ status: 'denied', reason: 'User denied via approvals queue' }` and wrote nothing.
`npm audit`: 7 pre-existing sharp/libvips vulns (no deps changed).

## Landmines

- **`tests/main/write-spine.test.ts` is now a permanent lane gate** — any new fs
  write in `mcp-server.ts`, `vault-query-facade.ts`, `ghost-emerge.ts`, or
  `machina-native-tools/` must route through `note-write.ts` or the test bites.
- **Gate-confirm rows are never persisted** (live Promise waiters); the ghost-emerge
  confirm inherits the 30s fail-closed timeout, and the `_emerging` lock deliberately
  spans the gate wait — a second synthesis is refused while one awaits review.
- **`createStampedNote` is create-only** (`wx`): re-emerging an existing ghost note
  now surfaces EEXIST to the renderer instead of silently failing — same behavior as
  before (old code used O_EXCL) but now typed through the denied/error path.
- **Item 3's "graph-enrichment" scope was already satisfied** — do not go looking for
  an ungated enrichment writer; there isn't one (see scope finding above).
- All slice-7 landmines from the previous handoff still hold (design gates in
  `tests/design/greppable-gates.test.ts`, visual baselines darwin-only, vendored
  prelude sentinel, e2e fixture `state.json` rewrite — restore before commit).
- Cursor/GitLens intermittently hold `.git/index.lock` — retry a failed commit before
  touching the lock. eslint uses `--cache`; npm installs need
  `--cache /tmp/npm-cache-te`. Skip-worktree check: `git ls-files -v | grep ^S`.
