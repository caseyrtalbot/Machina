# Phase 2 steps 5+6 — post-merge review follow-up (OPEN)

Steps 5 (`5b1589d`, per-agent revert UI, contracts v1.2.5) and 6 (`24d53e1`, budget
stack + circuit breakers + kill switch, contracts v1.2.6) are LANDED on main and each
passed its own `npm run check` + `npm run build` gate. They were then run through the
full sequential post-merge e2e suite and a 7-lens adversarial review (step-5/step-6 spec
compliance, adversarial git plumbing, adversarial breaker/kill semantics, test quality,
merge spotcheck, Codex cold read; every blocker/major attacked by two independent
refuters before confirmation). **The review and e2e turned up real defects that are NOT
yet fixed** — this doc is the durable cold-start for that fix commit. The session that
started the fixes ran out of budget before landing anything; the working tree was clean
when it stopped (no partial edits on disk).

The confirmed-findings JSON produced by the review is the fuller record but lived only in
an ephemeral scratchpad; the load-bearing content is transcribed below.

## Current main is e2e-RED — fix before declaring the pair done

`e2e/agent-breaker.spec.ts` has two failing tests on the built app (the rest of the suite,
22 tests incl. `e2e/revert-agent.spec.ts`, passed):

- `:179 › a scripted write loop trips the velocity breaker: PTY dead, UI shows tripped` —
  90s predicate timeout (~line 203) waiting for main to report the spawner session dead
  after the velocity trip.
- `:249 › manual kill: the header kill switch halts a live turn mid-output` — 15s timeout
  (~line 281, "main-side authority reports dead"); `hasLiveSession` stayed true.

Same signature both times: **the trip/kill fires but the PTY never actually dies.**
Root-cause the kill wiring first (is `setBreakerKillCallback` bound to something that
truly terminates the PTY session — `spawner.close` vs whatever actually kills the pty in
shell-service/pty-service — and does the kill-switch IPC handler reach it?). Note the
review independently found the kill wiring is untested behaviorally (see finding [6]).
It could also be a probe defect — these two specs were WRITTEN but never executed before
merge (the 4∥7 landing shipped plausible-but-unrunnable probes once). Write the failing
behavioral repro (real listener path, fake PTY that records kill) before touching code.

## Confirmed majors (fix, test-first, one follow-up commit, contracts v1.2.7)

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

6. **`headMoved` wrongful-kill channel — ORCHESTRATOR DECISION recorded here, not yet
   applied** (`agent-circuit-breaker.ts:141`). `noteHeadMoved` kills on the FIRST signal
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

## Still open, not part of this fix commit

The docs-reconciliation commit (HANDOFF.md "Next work order" update, delete
`HANDOFF-PHASE2-STEPS-5-6.md` per its own instruction) should land WITH or AFTER the fix
commit, once the pair is genuinely green. Steps 5+6 are unpushed (`main` is ahead 2) and
should stay local until the e2e suite is green and the confirmed majors are fixed. OQ7
(before step 8) and OQ8 (the severable step-6 workspace-switch graft) remain pending Casey.
