# Phase 2 steps 5+6 — post-merge review follow-up (RESOLVED)

**RESOLVED 2026-07-07: every confirmed finding below is fixed in `c1b21c8`
(contracts v1.2.7).** Gate evidence on the final tree: `npm run check` green
(3505 tests), `npm run build` green, full sequential e2e 24 passed / 1 known
fixme-skip — including both `e2e/agent-breaker.spec.ts` tests that were red at
review time. The e2e root cause: turn attribution compared paths as strings, so
a symlink-aliased workspace root disengaged the whole containment gate — turn
attribution is PATH identity now (realpath-canonicalized both sides). The
durable statements of the fixes live in the §8 v1.2.7 changelog entry in
`01-interface-contracts.md` and the step 5/6 DONE blocks (+ v1.2.7 amendment)
in `04-phase-2-specs.md`; the cross-session facts live in the §8 v1.2.5–v1.2.7
changelog entries. Everything below is kept as the historical record of what
the review caught.

Steps 5 (`5b1589d`, per-agent revert UI, contracts v1.2.5) and 6 (`24d53e1`, budget
stack + circuit breakers + kill switch, contracts v1.2.6) LANDED on main and each
passed its own `npm run check` + `npm run build` gate. They were then run through the
full sequential post-merge e2e suite and a 7-lens adversarial review (step-5/step-6 spec
compliance, adversarial git plumbing, adversarial breaker/kill semantics, test quality,
merge spotcheck, Codex cold read; every blocker/major attacked by two independent
refuters before confirmation).

The confirmed-findings JSON produced by the review is the fuller record but lived only in
an ephemeral scratchpad; the load-bearing content is transcribed below.

## The two e2e failures at review time (both green after `c1b21c8`)

`e2e/agent-breaker.spec.ts` had two failing tests on the built app (the rest of the suite,
22 tests incl. `e2e/revert-agent.spec.ts`, passed):

- `:179 › a scripted write loop trips the velocity breaker: PTY dead, UI shows tripped` —
  90s predicate timeout (~line 203) waiting for main to report the spawner session dead
  after the velocity trip.
- `:249 › manual kill: the header kill switch halts a live turn mid-output` — 15s timeout
  (~line 281, "main-side authority reports dead"); `hasLiveSession` stayed true.

Same signature both times: the trip/kill fired but the PTY was never observed dying.
As-diagnosed resolution (recorded in §8 v1.2.7): the velocity failure was PRODUCT —
string-identity turn attribution under the probe's symlink-aliased tmpdir root detached
every turn window from the watcher root, so no signals ever reached the breaker; the
manual-kill failure was PROBE — the dead-PTY polls coerced the post-kill null session to
"alive" (`?.live ?? true`) and could never observe a kill. The probe deliberately keeps
its un-realpathed tmpdir root as the standing regression check.

## Confirmed majors (all fixed in `c1b21c8`, contracts v1.2.7)

**Git surface (step 5):**

1. **revertAgent sweeps user-staged bystanders into the revert commit**
   (`git-service.ts:487-495`). Plain `git commit --no-verify --allow-empty` with no
   pathspec limiting after `git revert --no-commit` folds any independently user-staged
   file into the `Machina-Reverts` commit (empirically reproduced). `commitApproved`
   already defends against exactly this by pathspec-limiting add+commit
   (`git-service.ts:325-327`); mirror that. (Codex cold-read finding [8] is the same bug.)

2. **git-log failure renders as the "false empty" the v1.2.5 contract forbids**
   (`git-service.ts:432-433` → `ipc/git.ts:388-393`). `readTrailerLog` failure maps to
   `[]`, wrapped as `{ok:true, agents:[]}`; on a large-history/slow-disk workspace the
   unbounded `git log` (5s timeout, 10MB buffer) fails and the tray shows "no unreverted
   agent commits" while revertable commits exist — a false negative on a containment
   surface, contradicting the honesty rationale in `ipc/git.ts:386-387` and contracts
   §-v1.2.5. Distinguish git-failure from genuinely-empty; surface an honest error state
   in `RevertAgentSection`.

3. **Trailer-value field injection poisons the `Machina-Reverts` exclusion set**
   (`git-service.ts:399-416`). Positional `\x1f` split protects only the subject
   (`fields.slice(4).join`); a path-2 agent committing a forged trailer value containing
   `\x1f` shifts attacker-chosen shas into `fields[3]`, adding them to `reverted` — those
   commits vanish from `listAgentCommits` AND are skipped by `revertAgent`, permanently
   immunizing them (the head-moved tripwire fires but the commit persists). Make parsing
   injection-proof by construction: validate each field before use (shas `^[0-9a-f]{40}$`,
   ids `SAFE_ID_RE`; discard non-conforming tokens). Untested — add the forged-trailer repro.

4. **Tray revert during a live agent turn falsely trips the breaker and kills the healthy
   agent** (`ipc/git.ts:379-383`). The `git:revert-agent` handler, unlike the gate's own
   paths in the same file, neither suppresses the revert's file writes on the watcher
   (`discard` does at ~96) nor excuses the revert commit sha (`commitApproved` does via
   `noteQueueCommit` at ~88). A revert while a turn window is open attributes the revert's
   writes to the agent, computes `headMoved=true`, and kills it + queues a bogus pending
   item. Fix with the existing mechanisms: suppress the reverted paths and record the new
   revert sha as excused (it is user-authorized containment machinery).

**Breaker seam (step 6):**

5. **Budget enforcement silently disengages when the bindings mirror is not loaded**
   (`ipc/cli-thread.ts:199-207`, `ipc/git.ts:267-268`). `checkMaxTurnsOnTurnStarted` and
   `getWriteBudget` read the in-memory `HarnessRunRegistry`, but nothing on the
   no-agentId-forwarded path awaits `ensureRootReady` (`resolveRequestedAgentId` returns
   at `cli-thread.ts:135` before the load when `requested === undefined`). After relaunch
   with stripped frontmatter, budgets don't enforce on the first send. Guarantee the mirror
   is loaded before budget reads on every turn path, degrade-not-fail preserved.

6. **`headMoved` wrongful-kill channel — ORCHESTRATOR DECISION recorded here, applied
   in `c1b21c8`** (`agent-circuit-breaker.ts:141`). `noteHeadMoved` kills on the FIRST signal
   with no threshold; `isAgentHeadMove` excuses only queue-made approval commits, so the
   user's own `git commit`/`pull`/`checkout` during a live turn is indistinguishable from
   agent git activity and kills the healthy agent (both refuters traced it end-to-end;
   pre-step-6 this was advisory audit+flag, step 6 escalated it to a kill). **Decision:
   degrade bare `headMoved` from kill to the notice-latch class the breaker already has for
   `concurrentTurns`** — notice + audit + tray row on first signal, escalate to the single
   kill only on a later unambiguous signal in the same episode; keep "exactly one kill per
   episode"; the step-3 audit/flag path is unchanged. This is a policy call, recorded so it
   is reversible cheaply — if a later owner wants headMoved to kill, that is a one-line
   revert plus a corroboration rule.

**Test hardening (mutations that survive the current 3485-test suite):**

7. **maxTurns kill wiring is pinned only as mock plumbing** — deleting the
   `setTurnStartedListener` registration (or dropping its one-microtask deferral) passes the
   whole suite. Add a test exercising the REAL registration seam so those mutations fail.

8. **The "never trip on degraded" negative test cannot distinguish health-ignored from
   health-suppressed** (`agent-circuit-breaker.test.ts:173-182`) — a mutation adding an
   early `if (!healthy) return` to every `note*` (silencing all trips while degraded) passes.
   Add the companion positive: the same signals under a HEALTHY gate must trip.

## Notable minors (record-only unless cheap alongside the above)

- Palette re-dispatch of the same agent while the tray is open fails to re-arm the confirm.
- `listAgentCommits` lists trailer ids `revertAgent` will always refuse (SAFE_ID_RE asymmetry).
- Step-5 DONE block records 2 deviations; the §8 v1.2.5 entry records 3 (reconcile).
- Step 6 edited `ipc/git.ts` though the ownership map assigned it "step 5 only" — undeclared
  in the DONE block (benign; the rebase merged both cleanly).
- Stale docstring in `harness-types.ts` still claims `harness:list` is skip-not-throw
  (contradicts step 7's list-with-diagnostics shape).
- Breaker trips are never pruned for closed/deleted threads or across workspace switches —
  stale "breaker tripped" tray rows persist for the app run.
- Watcher restart during an open turn drops the discard-suppression map, letting the gate's
  own revert events feed the velocity limiter/breaker.
- `RevertAgentSection` state update after unmount (Codex).
- Several unpinned test behaviors (recordWrites-before-noteVelocity ordering; renderer breaker
  push path uncovered; trip thresholds parametrized so a drift to 1 passes vacuously).

## Disposition

The fix commit landed as `c1b21c8` (contracts v1.2.7); the docs-reconciliation commit
that carries this RESOLVED flip stamps steps 5+6 DONE (HANDOFF.md sections updated,
`HANDOFF-PHASE2-STEPS-5-6.md` deleted per its own instruction). The "Notable minors"
above were record-only findings — treat each as unresolved unless a fix is verified on
disk. OQ7 (before step 8) and OQ8 (the severable step-6 workspace-switch graft) remain
pending Casey. (Status 2026-07-17: OQ7 was RESOLVED by Casey 2026-07-09 — the frozen
ten-role roster, recorded in contracts §5 and the 04 step-8 spec; OQ8 remains open,
now blocker-class at Phase 3 step 6.)
