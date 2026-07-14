# Work order — Phase 3 steps 2 ∥ 3 (the first sanctioned parallel pair)

Two isolated sessions off `8f1323c` (Phase 3 step 1). Specs are BINDING:
`06-phase-3-specs.md` steps 2 and 3 + the cross-step rules in its header. Read
`HANDOFF.md` ("What Phase 3 step 1 changed under you") before touching anything —
step 1 changed queue semantics and turn-id shape under you. Re-verify every
file:line with `rg` before editing; check `git ls-files -v | grep '^S'` at session
start. **Delete this file in the docs commit of whichever step lands second.**

## Session A — Step 2: notifications + propose-surface convergence (contracts v1.3.1)

Scope (spec step 2): main-side delta notify at the single choke point; Electron
`Notification` + dock badge with the recorded attention-policy table
(interactive items notify only unfocused; loop-context/breaker/watcher-down/disarm
classes ALWAYS notify — the loop-context signal arrives at step 6, shape the wiring
for it); MCP `QueueHitlGate` swap at `mcp-lifecycle.ts:109`; native
`tool_pending_approval` mirror with single resolution authority (or the recorded
Tier-E-table amendment if a clean mirror is not achievable — never claim
unconverged coverage); copy gate per the `ApprovalsTray.tsx:4-7` header rule.

**Owns:** `approval-queue.ts`, `ipc/git.ts`, new `services/approvals-notifier.ts`,
`mcp-lifecycle.ts`, `machina-native-agent.ts` / `machina-native-tools/`,
`ApprovalsTray.tsx` + its tests, `approvals-store.ts`.

**Step-1 inheritances to respect:** persist-on-mutation wiring lives in
`ipc/git.ts` (the notify tap goes beside it, not through it); mirror persist
failures are currently swallowed — the spec makes surfacing them a candidate for
your notification classes, take it or record why not; gate-confirms are never
serialized — nothing in your convergence work may change that.

**Casey gates (that day):** unfocused OS notification + dock badge for a queued
write, click lands in the tray; an MCP write confirm appears as a tray row (not a
modal) and fails closed at 30s. **If Casey has ratified OQ8 by your landing, the
tray note + per-thread manual kill lands in YOUR tray work; if not, record the
pending ratification in your DONE block.**

## Session B — Step 3: migration substrate hardening (contracts v1.3.2)

Scope (spec step 3): retire the `kind:'terminal'` DockTab (variant + render case);
extract `store/dock-store.ts` (the dock-tab/layout slice out of `thread-store.ts` —
**under 800 lines is this step's hard gate**, `wc -l` recorded in the DONE block;
existing dock tests migrate, not weaken); single-projection invariant test (at most
one mounted webview per sessionId, atomic migration); run the tick-counter
acceptance (Casey watching — this closes the OPEN Phase-1 step-4 acceptance and
banks the plain-terminal half of Phase 3's exit bar 2).

**Owns:** `dock-types.ts`, `DockTabContent.tsx`, `thread-store.ts` (shrink only),
new `store/dock-store.ts`, `panels/agent-shell/terminal-migration.ts` (test
surface), `terminal-strip-store.ts` tests.

**Casey gate (that day):** the tick-counter run — `while true; do echo tick
$((i++)); sleep 0.2; done`, strip→canvas→strip, consecutive ticks, same PTY. If it
FAILS, that is Phase 3 catching its exit-bar regression early: fix HERE, do not
proceed on a broken premise.

## Shared discipline

- **Disjoint ownership is the parallel-safety guarantee** (spec map: 1∥3
  generalizes to this pair because step 2 = main approvals surface, step 3 =
  renderer dock surface). If you find yourself needing the other session's files,
  STOP and coordinate — that is the spec's collision warning firing.
- `ipc-channels.ts` / `preload/index.ts` / `main/index.ts`: append-only at file
  end; the latecomer rebases the trivial conflict.
- Landing: first-done lands first; the second REBASES onto it and re-runs the FULL
  fresh gate on the merged tree (`npm run check` + build + full e2e + audit) —
  evidence, not transcription. One main commit per step, contracts amendment
  (v1.3.1 / v1.3.2) in the same commit, DONE block stamped in 06-phase-3-specs.md,
  HANDOFF "changed under you" section added.
- Worktree sessions: push/land through the canonical repo only; remove worktrees +
  wip branches the same session (`git worktree list` must show canonical only).
- Turn ids are `t<seq>-<runTag>` since step 1 — do not write tests assuming bare
  `t1`/`t2`.
- **Step 3 must land before step 4 starts** (the `thread-store.ts` collision).
  Step 2 has no such constraint on step 4 beyond the queue e2e overlap (spec map).
