# Parallel work order — steps 5 + 6 (written post steps 3+4, `719fb85`)

Two sessions can run these simultaneously: step 6 (test-fixer harness) and step 5
(snapshot retirement) touch disjoint code, and both depend only on landed work. Each
session: read `HANDOFF.md` first (the cold-start — its "What step N changed under you"
sections for steps 1–4 are your ground truth), then your step's section in
`02-phase-1-specs.md` and your contracts sections in `01-interface-contracts.md`
(v1.1.2). This file adds only what two simultaneous sessions need to avoid colliding —
it restates nothing. Delete it once both steps have landed and the tracer-bullet run is
recorded.

AGENTS.md regeneration remains PARKED on Casey's instruction — step 5's
doc-reconciliation updates CLAUDE.md only and notes the regen backlog (now steps 1 + 5).
Do not regenerate unprompted.

## Session A — step 6, test-fixer harness (the build-heavy one)

You are building the first harness template end-to-end: `harness-types.ts`,
`harness-templates.ts`, `harness-service.ts`, `src/main/ipc/harness.ts`,
`harness-store.ts`, `harness-run.ts` (all new), plus palette items and the renderer
agentId forwarding. Spec: step 6 in `02-phase-1-specs.md`; contracts §5 (on-disk
schema) and §6 (harness:create/list — Result-typed, root resolved main-side).

The attribution seam is ALREADY LIVE main-side (HANDOFF step-3 §6): `cli-thread:spawn`/
`input` accept optional `agentId` and it flows registry → PendingChange → trailers →
`revertAgent(slug)`. Your work is renderer-side forwarding only (harness-run →
thread-store/agent-transport); zero spawner or registry changes. Non-negotiables from
the spec: `HARNESS_PROTECTED_GLOBS` carries BOTH `.machina` and `.machina-dev` (the one
sanctioned dual-variant literal), `validateHarnessScope` aborts before any write
(refuse-to-emit), create never overwrites, `verify.sh` is written last with mode 0o555.

Files you own (session B stays out): all six new files above, `palette-sources.ts`,
`thread-store.ts` / `agent-transport.ts` (agentId forwarding only — thread-store is at
~830 lines, surgical), `src/shared/ipc-channels.ts` + `src/preload/index.ts` (harness
namespace, append-only at file end per the standing rule).

## Session B — step 5, snapshot retirement (the evidence-heavy, safety-critical one)

Part A first and alone: write `03-snapshot-retirement-evidence.md` (new, yours) with
G1–G8 each citing a passing test or a FRESH transcript at current HEAD, plus the parity
ledger. **G6 (degraded-mode attribution, hooks absent) failing means the snapshot
stays** — halt with Part A committed and the gate honestly red. That outcome is the
step succeeding at its job, not failing; do not soften G6 to unblock Part B. Only after
all boxes check: Part B removes both `commitPreAgentSnapshot` call sites
(`cli-thread-spawner.ts`) and the function from `git-service.ts`, with the
doc-reconciliation pass in the same commit (safety-subsystem.md, overview.md, CLAUDE.md,
contracts §2/§4 status lines + §8 changelog).

Files you own (session A stays out): the evidence doc, `cli-thread-spawner.ts`,
`git-service.ts`, their test files, the three architecture docs. You do NOT touch
ipc-channels or preload this round.

Evidence is HEAD-anchored: if you rebase (see landing order), transcripts collected
before the rebase are dead — re-run them, never transcribe. Verification claims must
match a fresh gate run.

## Coordination contract

- **Isolation**: one worktree per session (`git worktree add ../<name> -b <branch>
  main`), land as a single ff-merge to main, then remove worktree + branch and verify
  `git worktree list` shows only the canonical clone. Main is pushed through `719fb85`;
  push after landing.
- **Shared hotspots**: only session A touches `ipc-channels.ts`, `preload/index.ts`,
  and `palette-sources.ts` this round — session B has no business in any of them. The
  file sets are otherwise disjoint; keep them that way.
- **Landing order**: first fully-green gate lands; the second rebases and re-runs the
  FULL gate fresh (`npm run check`, `npm run build`, `npm run test:e2e`, your step's
  smoke). Preference if timing allows: **session A (step 6) lands first** — B's
  evidence must be re-run after any rebase regardless, and evidence collected at a HEAD
  that already includes the harness also witnesses slug-trailer attribution on the
  exact tracer-bullet path (strengthens G3/G8).
- **Do not run two app instances at once**: non-packaged runs share
  `~/Library/Application Support/Electron/`. Stagger e2e and smoke probes. Both steps'
  smoke drives the SAME approvals machinery — use separate throwaway repos, never the
  same fixture concurrently. After probe runs, prune probe workspaces from
  `machina-settings.json` (`lastWorkspacePath`/`workspaceHistory`) — steps 2–4's probes
  polluted it and each had to clean up after.
- **Before committing**: `git restore e2e/fixtures/test-vault/.machina/state.json`;
  leave the untracked `.agents/` directory alone.
- **On landing, same commit or an immediate docs commit**: mark your step DONE in
  `02-phase-1-specs.md`, add a "What step N changed under you" section to `HANDOFF.md`,
  amend `01-interface-contracts.md` (§8 entry) for any deliberate deviation.

## When both steps have landed

Run the Phase 1 tracer bullet (bottom of `02-phase-1-specs.md`) on a real repo — a
Playwright probe can drive it end-to-end (open repo → harness create → run → tray
approve → slug trailer → revertAgent), with Casey confirming on the running app.
Record the result in HANDOFF.md, then delete this file.

## Open items owed by Casey (carry, do not block on)

- Step-4 manual migration acceptance: tick-counter continuity across strip→canvas→strip,
  Casey observing. Still open.
- AGENTS.md regeneration (steps 1 + 5 backlog). Parked.
- Phase-1 tracer-bullet confirmation on the running app (above).
