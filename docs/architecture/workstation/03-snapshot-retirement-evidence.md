# Step 5 — Snapshot Retirement Evidence (gates G1–G8 + parity ledger)

`commitPreAgentSnapshot` (spawn-site + per-turn in `CliThreadSpawner.input()`) is retired
ONLY when every gate below is checked against evidence collected **fresh at the landing
HEAD**. Evidence is HEAD-anchored: transcripts or test runs collected before a rebase are
dead — re-run them, never transcribe. A single unchecked box halts the step with the
snapshot wired; **a red G6 means the snapshot stays**, and that outcome is the step
succeeding at its job (contracts §2/§4 never-regress rule).

Box discipline: every `[ ]` below stays unchecked until the landing phase re-runs the
cited tests (they are all inside `npm run check`) and executes the transcript procedures
at the landing HEAD. Prep-phase status (2026-07-06, branch `step-5-snapshot-retirement`
off `41859dc`): all cited tests verified passing via

```
npx vitest run tests/main/git-service.test.ts tests/main/approval-queue.test.ts \
  src/main/services/__tests__/cli-turn-registry.test.ts \
  src/main/services/__tests__/agent-write-watcher.test.ts \
  src/main/services/__tests__/cli-thread-spawner.test.ts
# 5 files, 183 tests, 183 passed
```

Gates G2 and G8 were unit-testable but uncovered; their tests were **written in this
step's Part A** and pass (marked NEW below).

**LANDING STATUS (2026-07-06, landed): ALL GATES GREEN — every box below is checked
against evidence collected fresh at the landing HEAD.** The branch was rebased onto
main at `5f5c641` (step 6 landed first, so the transcripts below also witness
slug-trailer attribution on the exact tracer-bullet path — every turn ran with
`agentId: 'test-fixer'`). Fresh full gate at the rebased code HEAD (`d862e81`):
`npm run check` 281 files / **3149 passed**, `npm run build` green, `npm run test:e2e`
**17 passed / 1 fixme-skipped**. Cited suites re-run fresh:

```
npx vitest run tests/main/git-service.test.ts tests/main/approval-queue.test.ts \
  src/main/services/__tests__/cli-turn-registry.test.ts \
  src/main/services/__tests__/agent-write-watcher.test.ts \
  src/main/services/__tests__/cli-thread-spawner.test.ts
# 5 files, 172 tests, 172 passed  (183 pre-Part-B minus the 11 deleted snapshot tests)
```

`rg -n 'commitPreAgentSnapshot|PreAgentCommitResult|isAutoCommitOptedOut' src tests e2e`
returns zero matches. Full P1/P2 transcripts are recorded at the bottom of this file.

## Gate checklist

### G1 — Reject restores (modified + created files)

- [x] Rejecting a pending change restores a modified tracked file from HEAD and removes
      an agent-created file (recoverably), leaving porcelain clean.

Evidence — cited tests (service + queue level):

- `tests/main/git-service.test.ts` › `discard` ›
  - `restores tracked paths from HEAD without calling removeFile` (modified)
  - `routes untracked paths through the injected removeFile callback` (created)
  - `handles mixed tracked and untracked paths in one call` (both in one reject)
  - `fails closed when git ls-files fails instead of trashing tracked files`
- `tests/main/approval-queue.test.ts` › `ApprovalQueue with real git-service` ›
  `reject on a real repo removes the untracked file and empties the queue`

End-to-end witness: landing transcript P1 step 7 (reject turn 2 on a real repo).

### G2 — Approve-then-revertAgent equals the pre-agent tree

- [x] The replacement rollback path (approve → `revertAgent`) lands a tree
      byte-identical to the pre-agent state — the guarantee
      `git reset --hard <snapshot>~1` used to give.

Evidence — cited tests:

- `tests/main/git-service.test.ts` › `revertAgent` ›
  `approve-then-revertAgent restores the exact pre-agent tree (modified + created)`
  (**NEW**, written for this gate: asserts `HEAD^{tree}` equality with the pre-agent
  commit tree, file content restored, created file gone, porcelain clean)
- Supporting: `reverts only the named agent across multiple agents (A,A,B ⇒ revert A
  only)`, `reverts stacked commits on the same file (requires newest-first ordering)`,
  `aborts on conflict and leaves the working tree clean`,
  `restores the pre-revert state when the final commit fails`

End-to-end witness: landing transcript P1 step 8 (tree-sha equality on a real repo).

### G3 — Trailer integrity

- [x] Both attribution trailers round-trip through git; forgery, injection, and
      collision paths are closed.

Evidence — cited tests (`tests/main/git-service.test.ts`):

- `commitApproved` › `round-trips both trailers through git log`
- `commitApproved` › `neutralizes a subject line forged as a Machina- trailer`
- `commitApproved` › `rejects unsafe agentId and threadId` (SAFE_ID_RE)
- `revertAgent` › `matches agent ids exactly — fixer does not match fixer-2`
- `revertAgent` › `does not re-enumerate revert commits on a second call`
  (Machina-Reverts sha-exclusion semantics, contracts v1.1.1)

End-to-end witness: landing transcript P1 step 6 (`git log -1 --format=%B` shows both
trailers on the built app).

### G4 — Exact staging (the inverse of the snapshot's `add -A` overreach)

- [x] Approve stages exactly the approved paths; bystander dirty files and user-staged
      files are untouched. (The retired snapshot's `git add -A` swept unrelated user
      work into every snapshot commit — retirement must prove the replacement never
      overreaches.)

Evidence — cited tests (`tests/main/git-service.test.ts` › `commitApproved`):

- `stages exactly the given paths — bystander dirty and user-staged files untouched`
- `treats pathspec metacharacters literally — * commits nothing, bystanders untouched`
- `rejects absolute, dash-leading, and root-escaping paths`
- `rejects paths that escape the root through a symlinked directory`

Plus ignored-path staging (approve must not brick): `tests/main/approval-queue.test.ts`
› `ApprovalQueue approve with ignored-untracked paths` › both tests.

### G5 — Attribution quiescence (write inside the 300ms+batch lag at turn end still queued)

- [x] A write landing at the very end of a turn — inside the watcher's
      `awaitWriteFinish` (300ms) + 50ms batch lag — is still attributed and queued.
      Mechanism: `LINGER_MS = 1500` keeps a closed window attributable past
      `turnEnded`, with margin over 300 + 50 + dispatch lag.

Evidence — cited tests:

- `src/main/services/__tests__/cli-turn-registry.test.ts` › `linger boundary after
  turnEnded` ›
  - `attributes within LINGER_MS, including exactly at the boundary, but not past it`
  - `attributes a closed window in linger even when the PTY is dead`
- `src/main/services/__tests__/agent-write-watcher.test.ts` › `AgentWriteWatcher
  integration (real chokidar)` › `records a real file write and ignores TE_DIR
  state.json` (proves the real chokidar → batch → handleBatch → queue path with the
  production awaitWriteFinish settings)

End-to-end witness: in landing transcript P1, the queued item for each turn must contain
the file written as the agent's LAST action before the turn completed.

### G6 — Degraded-mode attribution with hooks absent (the likely blocker)

- [x] With shell hooks absent (no block events ever), an agent write is STILL queued —
      attributed via the PTY-alive fallback and flagged `degradedAttribution` — not
      silently dropped and not merely audited as an escape. **Failing this gate means
      the snapshot stays wired. Do not soften it to unblock Part B.**

Evidence — cited unit tests (mechanism):

- `src/main/services/__tests__/cli-turn-registry.test.ts` › `degraded mode (thread
  never saw turnEnded)` ›
  - `is not degraded before DEGRADED_AFTER_MS` (early writes attribute normally — the
    window is open, attribution is never zero)
  - `attributes with degraded=true at and after DEGRADED_AFTER_MS while the PTY is alive`
  - `returns null past DEGRADED_AFTER_MS when the PTY is dead`
- `src/main/services/__tests__/agent-write-watcher.test.ts` › `AgentWriteWatcher.handleBatch`
  › `flows concurrent and degraded through from the ActiveTurnMatch` (flag reaches the
  PendingChange)

REQUIRED end-to-end evidence: fresh transcript per procedure **P2** below, at landing
HEAD, on the built app, with the hook file physically absent. The unit tests prove the
registry math; only the app run proves the wiring (spawner → registry → watcher → queue)
holds when the bridge never fires `onTurnComplete`.

### G7 — Dotpath coverage + no self-trigger

- [x] The watcher sees dotpath writes (`.env`, `.gitignore`, `<TE_DIR>/agents/**`) and
      never triggers on the app's own churn or on the queue's own operations.

Evidence — cited tests (`src/main/services/__tests__/agent-write-watcher.test.ts`):

- `partitionBatch` › `attributes .env when a turn match is present` and
  `attributes <TE_DIR>/agents/a/state.md when a turn match is present` (it.each)
- `isWatcherIgnored` › `watches …` table (`.env`, `.gitignore`, `src/deep/.env`,
  nested `build`/`out` dirs) and `ignores app-state churn: …` table
  (`<TE_DIR>/state.json`, `threads/`, `artifacts/`, `embeddings/`)
- `partitionBatch` › `drops self-writes` (DocumentManager.hasPendingWrite seam — user
  autosaves are not misattributed)
- `AgentWriteWatcher.handleBatch` › `suppresses the gate’s own echoes until the TTL
  expires` (a Reject's discard cannot resurrect its own item)
- Integration › `records a real file write and ignores TE_DIR state.json`

No-self-trigger by construction: the one AuditLogger sink lives at `userData/audit`,
outside any watch root (`src/main/ipc/git.ts`; step-2 design decision) — audit writes
can never feed back into the watcher.

### G8 — Per-turn granularity (approve turn 1, reject turn 2, turn-1 commit intact)

- [x] Resolving one turn never disturbs another turn's outcome — at least the
      granularity the retired per-turn snapshot gave.

Evidence — cited tests:

- `tests/main/approval-queue.test.ts` › `ApprovalQueue with real git-service` ›
  `per-turn granularity: approve turn 1, reject turn 2, turn-1 commit intact`
  (**NEW**, written for this gate: approve lands turn 1's trailer commit, reject of
  turn 2 leaves HEAD, content, and porcelain exactly as turn 1 left them)
- Supporting: `ApprovalQueue add/recordWrites/list` › `distinct turns produce distinct
  items` and `coalesces writes for the same turn: paths union, flags OR-merged, single
  item`

End-to-end witness: landing transcript P1 steps 6–7 (two live turns on the built app).

## Parity ledger — cases neither mechanism ever covered (or coverage changed)

Honest accounting so retirement is judged against what the snapshot actually did, not an
idealized memory of it.

| Case | Snapshot (retiring) | Queue/revert (replacing) | Verdict |
| --- | --- | --- | --- |
| **Non-repo workspace** | Never protected: structured no-op (`tests/main/git-service.test.ts` › `commitPreAgentSnapshot` › `returns not-a-git-repo when vault is not a git repo`) | Visibility + audit only: non-revertible item, approve acknowledges, reject disabled/retained (`tests/main/approval-queue.test.ts` › `non-repo root records a non-revertible item`, `non-repo approve acknowledges with { ok: true }, no commit, item removed`, `non-repo reject returns not-a-git-repo and RETAINS the item`) | Parity on rollback (both none); replacement adds visibility. Tray must keep the "No rollback" chip honest. |
| **Gitignored paths** | Never covered: `git add -A` respects `.gitignore`, so ignored files were never in any snapshot commit | Watched and reviewable: non-empty `--no-index` diff (`git-service.test.ts` › `diff` › `produces a non-empty diff for a gitignored file …`), approve commits around them (`approval-queue.test.ts` › `commits around ignored-untracked paths and removes the item`), reject trashes them recoverably (discard's injected removeFile) | Replacement strictly better. |
| **Out-of-root writes** | Never covered: snapshot committed only the cwd repo | Never covered: watcher is root-scoped; turns with out-of-root cwd never attribute (`cli-turn-registry.test.ts` › `never attributes a turn whose cwd is outside the root`, `does not attribute a sibling directory sharing the root as a string prefix`) | Parity (equal non-coverage). Contracts §4 scope limits; tray footer states root-only scope. |
| **Agent runs git itself** | Defeatable, undetected: the agent could `git reset --hard` past the snapshot commit and nothing noticed | Detected, not prevented: headMoved tripwire with immutable baseline + rev-list walk (`cli-turn-registry.test.ts` › `isAgentHeadMove` suite incl. `catches an agent commit hiding beneath a later queue commit …`, `treats a failed walk (unreachable baseline — history rewritten) as moved`; watcher › `audits headMoved once per turn …`; turn-end check `checkHeadMovedAtTurnEnd` in `src/main/ipc/git.ts`) | Replacement better (detection + audit). Still not a security boundary — contracts §4, Phase 2 owns enforcement. |

## Landing procedures (fresh transcripts at landing HEAD)

Rules: rebase first if session A landed, then `npm run build` and run these on the built
`out/main/index.js` via Playwright probes (the step 2/3 probe template). One throwaway
repo per procedure, never the e2e fixture. Afterward: prune probe workspaces from
`machina-settings.json` (`lastWorkspacePath` / `workspaceHistory`), and
`git restore e2e/fixtures/test-vault/.machina/state.json` before any commit.

### P1 — Real-repo session (witnesses G1/G2/G3/G4/G8 end-to-end + the step exit bar)

1. `mkdir /tmp/te-step5-p1 && cd /tmp/te-step5-p1 && git init` + local user config;
   seed commit containing `notes.md` (known content). Record
   `git rev-parse HEAD^{tree}` as PRE_TREE.
2. Launch the built app via probe; open `/tmp/te-step5-p1` as the workspace.
3. Spawn a `cli-claude` thread. Turn 1: prompt the agent to create `p1-new.txt` with a
   known sentinel string.
4. Assert `window.api.approvals.list()` shows exactly ONE PendingChange (`pc_<turnId>`)
   whose diff contains the sentinel; assert `git log --format=%s` in the repo contains
   ZERO `pre-agent snapshot` subjects (the retirement's core observable).
5. Approve from the tray. Assert `git log -1 --format=%B` carries both
   `Machina-Agent` / `Machina-Session` trailers (G3); assert `git show --name-only`
   lists only `p1-new.txt` (G4). Record the sha as TURN1_SHA.
6. Turn 2: prompt the agent to modify `notes.md`. Assert a second item appears
   (`pc_<turnId2>`, distinct id).
7. Reject turn 2. Assert porcelain clean, `notes.md` content unchanged, and
   `git rev-parse HEAD` still TURN1_SHA (G1 + G8).
8. Call `window.api.git.revertAgent` for the thread's agentId. Assert
   `git rev-parse HEAD^{tree}` equals PRE_TREE (G2), and the revert commit carries a
   `Machina-Reverts` trailer listing TURN1_SHA.
9. Confirm the full session log one more time: zero `pre-agent snapshot` commits with
   reject, approve, and revert all exercised (step-5 exit bar).
10. Quit, clean up repo + settings pollution.

### P2 — G6: hooks absent (REQUIRED; red = halt with Part A only)

1. Disable hooks for the probe run: `mv ~/.te.zsh ~/.te.zsh.step5-bak` (the rc source
   line is guarded by `[ -f ~/.te.zsh ]`, so it no-ops). If `$SHELL` is bash or fish,
   move `~/.te.bash` or `~/.config/fish/conf.d/te.fish` instead. Verify with a plain
   terminal: no `te-` OSC markers.
2. Fresh throwaway repo `/tmp/te-step5-g6`, seed commit. Launch the built app, open it.
3. Spawn a `cli-claude` thread. Send ONE turn instructing the agent to first write
   `g6-early.txt`, then run `sleep 35`, then write `g6-late.txt` (the late write must
   land past `DEGRADED_AFTER_MS = 30_000` with zero block events ever on the thread).
4. Confirm hooks are really absent: the thread shows no completed block/message for
   the turn (the bridge never fires `onTurnComplete`).
5. Assert `window.api.approvals.list()` contains the turn's PendingChange with BOTH
   paths coalesced, and `flags.degradedAttribution === true`; the tray shows the
   "Attribution degraded" chip.
6. FAIL conditions (any one = G6 red, snapshot stays): the write is on disk but no
   queue item exists; the write shows up only as a `cli-agent:unattributed-write`
   audit escape; or the item exists without the degraded flag after 30s+ (silent
   confidence overstatement).
7. Restore hooks: `mv ~/.te.zsh.step5-bak ~/.te.zsh`. Clean up repo + settings.

### Unit-cited gates at landing

Re-run the cited suites fresh at the landing HEAD (they are all part of
`npm run check`, which the landing gate runs anyway):

```
npx vitest run tests/main/git-service.test.ts tests/main/approval-queue.test.ts \
  src/main/services/__tests__/cli-turn-registry.test.ts \
  src/main/services/__tests__/agent-write-watcher.test.ts \
  src/main/services/__tests__/cli-thread-spawner.test.ts
```

Only after every G-box above is checked does Part B (the removal commit) land.

## Landing transcripts (2026-07-06, fresh at the rebased landing HEAD)

Both procedures ran on the BUILT app (`out/main/index.js`, TE_DIR = `.machina`) via
Playwright Electron probes, one app instance at a time, each against its own throwaway
repo (never the e2e fixture). Step 6 had already landed, so every turn was sent with
`agentId: 'test-fixer'` — the transcripts witness slug-trailer attribution on the exact
tracer-bullet path (G3/G8). Probe workspaces were pruned from `machina-settings.json`
afterward; `~/.te.zsh` was restored immediately after P2.

### P1 — real-repo session (G1/G2/G3/G4/G8 + exit bar) — PASS, all assertions

Throwaway repo seeded with `notes.md` + a seed commit; `PRE_TREE d32186a…`.

1. Turn 1 (`cli-claude`, hooks present): agent created `p1-new.txt` with a sentinel.
   Queue showed exactly ONE item `pc_t1`, `agentId: test-fixer`, paths
   `["p1-new.txt"]`, diff containing the sentinel, `revertible: true`, all flags false.
   `git log --format=%s` contained ZERO `pre-agent snapshot` subjects.
2. Approve → `{ok:true, sha:151a8ed…}`. `git log -1 --format=%B`:
   `Machina-Agent: test-fixer` + `Machina-Session: p1thread1783359148261` (G3).
   `git show --name-only` listed exactly `p1-new.txt` — the item's paths, nothing
   else (G4). TURN1_SHA = `151a8ed…`.
3. Turn 2: agent modified `notes.md`; a SECOND item `pc_t2` appeared (distinct id, G8).
4. Reject turn 2 → `{ok:true}`. Porcelain clean apart from the app's own untracked
   `.machina/` scaffold (app state, not an agent write; the watcher excludes it too);
   `notes.md` byte-identical to seed; `git rev-parse HEAD` still TURN1_SHA (G1 + G8:
   turn-1 commit intact).
5. `revertAgent('test-fixer')` → `{ok:true, sha:c7d8570…}`; `git rev-parse HEAD^{tree}`
   equals PRE_TREE (G2); revert commit carries `Machina-Reverts: 151a8ed…` (TURN1_SHA).
6. Final session log: `Revert agent changes (test-fixer)` / `test: p1 turn-1 approved` /
   `seed` — zero `pre-agent snapshot` commits with reject, approve, and revert all
   exercised (the step-5 exit bar).

### P2 — G6, hooks absent — PASS, GATE GREEN

`~/.te.zsh` moved to `~/.te.zsh.step5-bak` (rc source line is `[ -f ]`-guarded);
verified absent. Fresh throwaway repo, seed commit. One turn instructed the agent to
run a single Bash call: write `g6-early.txt`, `sleep 35`, write `g6-late.txt`.

- ZERO block events ever reached the renderer (`block:update` collector empty) — the
  bridge never fired `onTurnComplete`; the turn window never closed normally.
- Both writes landed on disk; the queue held ONE item `pc_t1` with BOTH paths coalesced
  (`g6-early.txt`, `g6-late.txt`), `agentId: test-fixer`, and
  **`flags.degradedAttribution: true`** — the late write attributed ~45s after turn
  start, past `DEGRADED_AFTER_MS = 30_000`, via the PTY-alive fallback.
- None of the fail conditions fired: no on-disk write without a queue item, zero
  `unattributed-write` audit lines mentioning the g6 paths, and the degraded flag was
  present — not a silent-confidence pass.

First P2 attempt is recorded honestly: the agent (three separate tool calls requested)
stopped after the early write, so the >30s condition was never exercised — that run
proved only that hooks-absent early writes queue non-degraded (`pc_t1`,
`g6-early.txt`, degraded false, zero block events). The re-run above with a single
deterministic Bash command exercised the full degraded path. Both runs queued every
write that landed; nothing was silently dropped in either.
