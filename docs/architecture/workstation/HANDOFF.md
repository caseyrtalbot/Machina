# Workstation Track — Handoff

You are picking up the Machina → agentic-development-workstation track. This file is the
cold-start: read it, then the three docs it points at, and you can start building without
asking questions.

## Where things stand (2026-07-05)

The vision is locked and the design is verified. Phase 0 (seam audit + interface
contracts) shipped to main. The Phase 0 docs were then adversarially re-verified by an
11-agent workflow (4 verification lenses over 52 claims, 6 independent step designers, 1
completeness critic); every confirmed error was folded back into the docs, so what you
are reading is the corrected v1.1 state. No Phase 1 implementation code exists yet — the
next work is step 1.

## The doc map (all in this folder — trust these over memory or older drafts)

1. **PLAN.md** — the vision: 13 locked decisions, five primitives, four phases,
   invariants. Do not re-litigate the decision table.
2. **00-seam-audit.md** — file:line evidence for every seam Phase 1 builds on, plus the
   two work orders (workspace generalization, gate parity). Has a corrections log.
3. **01-interface-contracts.md** — the typed contracts (v1.1). Section 4 is the
   load-bearing one: read its framing before touching anything agent-related.
4. **02-phase-1-specs.md** — six implementation specs in canonical order, one commit
   each. This is your work queue. Step 1 (workspace generalization) is first and has no
   dependencies; step 4 (dock shell) can run in parallel with 2–3 after step 1 lands.

## The five things that will bite you if you skip the docs

1. **The gate is post-persistence containment, not prevention.** CLI-agent writes are
   live on disk before anyone reviews them. Approve blesses into history; Reject reverts
   via git. UI copy and your own mental model must never claim writes are blocked. The
   agent is a full shell — it can run git itself; we detect (headMoved tripwire), we do
   not prevent. Real enforcement is Phase 2 (adapter-native permission hooks).
2. **Never let rollback coverage gap.** `commitPreAgentSnapshot` stays wired (spawn +
   per-turn) until step 5's G1–G8 evidence gate passes on fresh runs. If G6
   (degraded-mode attribution) fails, the snapshot stays — that is the correct outcome.
3. **The AgentWriteWatcher must NOT reuse vault-watcher's ignore patterns.** Those
   ignore TE_DIR and all dotpaths, which would blind the verify.sh auto-reject and every
   `.env` write. Contracts §4 v1.1 specifies its own ignore policy.
4. **Use the TE_DIR constant, never a literal `.machina`** (dev runtime is
   `.machina-dev`). The single exception is `HARNESS_PROTECTED_GLOBS`, which
   deliberately carries both variants.
5. **Verify disk before editing.** Line numbers in the specs were verified at
   `7735644`/`ec6fa6d` but steps move each other's code; `rg` first. This repo has also
   used git skip-worktree bits that silently ignore Writes (`git ls-files -v`).

## House rules that apply to every step

- Commit directly to main, one step per commit, no feature branches. Full pre-commit
  gate: `npm run check` + `npm run build`, fresh runs, evidence not transcription.
- Every deliberate deviation from the contracts amends `01-interface-contracts.md` in
  the same commit. CLAUDE.md changes propagate to AGENTS.md only via regeneration —
  never hand-edit AGENTS.md.
- Dev-app/DevTools smoke checks are driven by the agent, not handed to Casey as steps.
  Electron visual verification is Casey observing the running app — no programmatic
  Electron screenshots. The step 4 dock↔canvas migration acceptance (tick-counter
  continuity) explicitly needs Casey watching.
- Surgical scope: every changed line traces to the step's spec. Files under 800 lines
  (thread-store.ts is already at 825 — do not grow it; the specs route around it).

## Definition of done for Phase 1

The tracer bullet, on a real repo, in one sitting: open repo → spawn terminal → create
test-fixer harness → run it → watch the turn in the tray → approve the diff → see the
`Machina-Agent: test-fixer` trailer commit → `revertAgent` cleanly undoes it. All
invariants in PLAN.md hold at every step boundary.

## Machinery you inherit (verified working, don't rebuild)

PTY core with ring-buffer reconnect (`terminal:reconnect` already exists — migration is
a renderer affordance), block protocol (OSC hooks → BlockDetector → BlockWatcher),
safety trio (`hitl-gate.ts` / `audit-logger.ts` / `path-guard.ts`), typed-IPC 4-step
pattern, `ShellService.create` already takes per-session cwd, `ThreadStorage` already
takes its root, `commitPreAgentSnapshot` already wired at CLI spawn. The full reuse map
with import-graph evidence is in 00-seam-audit.md §1.

## Open items deliberately left for later phases

Adapter registry + session-types (Phase 2), loop scheduler (Phase 3), LSP + git map
(Phase 4), worktree isolation (only if parallel usage demands), renderer "workspace"
filter-naming cleanup, state.md knowledge-indexing, DocumentManager coordination for git
discard, MCP gate convergence onto QueueHitlGate. The full residual list with rationale
is at the end of 02-phase-1-specs.md.