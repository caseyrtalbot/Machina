# Workstation Track — Handoff

You are picking up the Machina → agentic-development-workstation track. This file is the
cold-start: read it, then the docs it points at (the doc map below), and you can start
building without asking questions.

## Where things stand (2026-07-15 — Phases 0–2 COMPLETE; Phase 3 steps 1–4 shipped)

**Phase 0 (seam audit + interface contracts) is COMPLETE.** The Phase 0 docs were
adversarially re-verified by an 11-agent workflow (4 verification lenses over 52 claims,
6 independent step designers, 1 completeness critic); every confirmed error was folded
back into the docs. Full record: `00-seam-audit.md` (including its corrections log) plus
the v1.1/v1.1.1 entries in the contracts §8 changelog.

**Phase 1 is COMPLETE (2026-07-06).** Six steps — workspace generalization (`76d0699`),
git substrate (`3198ddd`), gate parity, dock IDE shell (`424b3cc`), snapshot retirement,
test-fixer harness — each with a dated DONE block (gate numbers, smoke evidence,
recorded deviations; shas where recorded) in `02-phase-1-specs.md`. The pre-run snapshot is RETIRED — the
approvals gate owns CLI rollback; the G1–G8 gate checklist, parity ledger, and full
P1/P2 built-app transcripts live in `03-snapshot-retirement-evidence.md`. The Phase-1
tracer bullet PASSED with Casey confirming on the running app (2026-07-06); the run
record lives in 02's tracer-bullet section.

**Phase 2 is COMPLETE (2026-07-10, contracts v1.2–v1.2.8).** Eight steps — adapter
registry + model aliasing (`18cc29d`), watcher health model (`be07439`), main-side
harness↔thread binding (`4047d35`), two-projection agent view (`61f8ce3`), per-agent
revert UI (`5b1589d`), budget stack + circuit breakers + kill switch (`24d53e1`),
harness linter (`065d312`), template gallery + blank builder (v1.2.8) — each with a
dated DONE block in `04-phase-2-specs.md`; the durable contract statements are the §8
v1.2–v1.2.8 changelog entries. The 5∥6 post-merge adversarial review record is
`05-steps-5-6-review-followup.md` (RESOLVED at the `c1b21c8` hardening commit, v1.2.7).
The step-8 gallery roster is the exact ten-role catalog recorded in contracts §5 and the
04 step-8 spec (OQ7 RESOLVED by Casey 2026-07-09) — do not reconstruct or replace it
from older ~5-template text.

**The Phase 3 spec pass LANDED 2026-07-14**: `06-phase-3-specs.md` (9 steps, canonical
order) distilled from a 4-designer + 2-judge workflow over six disk-verified
investigation dossiers — both judges independently selected the risk-lens design;
grafts from the three runners-up are folded in and attributed inline. The spec carries
a stale-claim ledger (cost observable now EXISTS for claude — the old "no cost
observable" deferral rationale is corrected at step 5; FilesDockAdapter split-brain
follow-up verified FIXED on disk; `thread-store.ts` was 1009 lines, since remediated by
step 3's dock-store extraction).

**Phase 3 step 1 is SHIPPED 2026-07-14** (contracts v1.3.0, same-day as the spec
pass): the approval queue is multi-root (nothing clears it; resolution stays
root-bound per item), cli-change items persist to a userData mirror and rehydrate
with fresh-diff re-validation, gate-confirms are root-bound and never serialized,
and the tray shows root labels + the switch-to-resolve affordance. Built by a
13-agent workflow (4 implementers, gate loop, 4 review lenses incl. Codex cold
read, findings fix, final full gate); all 6 blocker/major review findings fixed
in-tree — including run-unique turn ids (`t<seq>-<runTag>`), a cross-cutting
change every future step inherits. Full record: the step-1 DONE block in
`06-phase-3-specs.md` (recorded deviations + 4 residual minors). Casey-observed
acceptance PASSED (2026-07-15, live dev app): multi-root tray survival + the
foreign-root switch-to-resolve affordance confirmed on the running app.

**Phase 3 steps 2 (queue notifications + MCP/native gate convergence) and 3
(dock-store extraction + single-projection invariant) SHIPPED 2026-07-14** as a
parallel pair (`4f6213e`, contracts v1.3.1; `d75a62c`, contracts v1.3.2), all Casey
gates PASSED — see their "changed under you" sections below and the DONE blocks in
`06-phase-3-specs.md`.

**Phase 3 step 4 is SHIPPED 2026-07-15** (contracts v1.3.3): a full turn is now
main-originable and main-persisted — `dispatchAgentTurn` exported (spawner still
module-private, validation chain identical, serialized per threadId), a main-side
BlockWatcher readiness wait before every send, the exactly-once transcript
cutover (main is the persistence authority for cli threads; renderer
display-only with a `thread:changed` refresh), and the dev-gated
`cli-thread:test-dispatch` channel for the unattended e2e probes. Built by a
4-implementer workflow + adversarial review; all 10 confirmed major findings
fixed in-tree. Full gate on the final tree: `npm run check` 324 files / 3954
tests green, build green, full e2e 30 passed / 1 known fixme-skip (2.3m)
including both new `e2e/unattended-dispatch.spec.ts` probes (also executed
targeted against the real authed `claude`: 2/2, 35.1s). Full record: the step-4
DONE block in `06-phase-3-specs.md` + the v1.3.3 contracts changelog (deviations
d1–d4, residuals r1–r6; r5 closed at review). No Casey-observed gate on this
DONE bar — the evidence is transcript-on-disk + queue-item-present with no
renderer participation; the one Casey item is the d2 ratification bullet below.

**Next work order for the incoming team(s):**

- **Next = step 5 (containment aggregation + durable budgets + cost
  observable)**, strictly sequential AFTER step 4 per the spec's parallel map
  (both own `ipc/cli-thread.ts`: step 5's scheduler calls the exported
  `dispatchAgentTurn` and extends the `DispatchOrigin` union with its own audit
  literal, residual r6), and step 5 must land strictly BEFORE step 6 (step 6
  consumes step 5's rollups and budget headroom). OQ8 + OQ-A–E still want Casey
  answers — recommendations are the defaults (next bullet). Steps 2 ∥ 3 landed
  2026-07-14 (`4f6213e` v1.3.1 + `d75a62c` v1.3.2, all Casey gates PASSED); the
  step-4 landing is the SHIPPED paragraph above. New e2e
  `e2e/unattended-dispatch.spec.ts` is a serial suite sharing the Electron
  user-data dir — run it targeted/sequential, never parallel with the other
  queue e2e specs.
- **Casey answers wanted (recommendations are the defaults if unanswered):** OQ8
  ratification at kickoff (blocker-class now — loops + canvas cards multiply
  cross-root PTYs; step 6 carries a root fence as the interim), plus OQ-A through
  OQ-E in the spec's open-questions section.
- **Casey ratification, step 4 (d2 — decided at review, ratify or re-open):** the
  design deferred CLI status messages (dispatch-refusal / start-status) to
  session-display-only pending your call; the adversarial review flagged the
  transcript regression and the specced reversal was implemented instead — they now
  persist via the main-owned `thread:append-system` append (contracts v1.3.3
  changelog). If you prefer display-only, the reversal is one channel + two
  renderer call sites to unwind.
- Dependabot triage still open: `npm audit --omit=dev` reports 1 moderate production
  vuln (js-yaml via gray-matter); Phase 3 step 6 must take the scoped fix or record
  why not (spec cross-step rule).
- Two live-app observations from the 2026-07-14/15 acceptance session (pre-existing,
  deferred to the polish pass — verified NOT from the steps 2/3 diffs): (a) the
  file-tree header's vault dropdown (`VaultSelector.tsx`) does not switch
  workspaces; the working switch paths are the thread-sidebar button and the tray
  affordance, both through `workspace.open()`; (b) with a coding repo open as the
  workspace, the knowledge engine indexes `node_modules` (search surfaces dependency
  READMEs) — needs an ignore-policy decision.
- Untracked `.agents/skills/thought-engine-council/` at the repo root is Casey's —
  leave it alone, do not commit or delete it.

## The doc map (all in this folder — trust these over memory or older drafts)

1. **PLAN.md** — the vision: 13 locked decisions, five primitives, four phases,
   invariants. Do not re-litigate the decision table.
2. **00-seam-audit.md** — file:line evidence for every seam Phase 1 built on, plus the
   two original work orders. Has a corrections log.
3. **01-interface-contracts.md** — the typed contracts (v1.3.3). Section 4 is the
   load-bearing one: read its framing before touching anything agent-related. §8 is
   the reverse-chronological changelog — new entries go at the TOP; the per-version
   entries are the durable statements of every landed deviation.
4. **02-phase-1-specs.md** — the six Phase-1 implementation specs in canonical order.
   Phase 1 is COMPLETE — all six steps DONE, each header carrying a dated DONE block
   with its recorded deviations; the tracer-bullet run record and the Phase-1
   deferred/accepted residuals live at the end. Line numbers in the specs were
   verified at the Phase-1 spec pass and later steps have moved code — re-verify with
   `rg` before citing.
5. **03-snapshot-retirement-evidence.md** — the snapshot-retirement evidence record:
   G1–G8 gate checklist, parity ledger, and the full P1/P2 built-app transcripts.
6. **04-phase-2-specs.md** — the eight Phase-2 specs in canonical order (spec pass
   2026-07-06 from a 4-designer + 2-judge workflow over four disk-verified
   investigation dossiers). Phase 2 is COMPLETE — all eight steps DONE with dated
   DONE blocks (steps 1 `18cc29d`, 2 `be07439`, 3 `4047d35`, 4 `61f8ce3`, 7
   `065d312`, 5 `5b1589d`, 6 `24d53e1` — 5/6 hardened at `c1b21c8`, contracts
   v1.2.7 — and 8 at v1.2.8, 2026-07-10). Ends with the Phase-2 open questions and
   deferred/accepted residuals.
7. **05-steps-5-6-review-followup.md** — the RESOLVED post-merge review record for
   the Phase-2 5∥6 landing: what the 7-lens review caught and how `c1b21c8` fixed it.
8. **06-phase-3-specs.md** — the Phase 3 work queue (9 steps, canonical order; spec
   pass 2026-07-14 from a 4-designer + 2-judge workflow over six disk-verified
   investigation dossiers; both judges picked the risk design). Phase 2 is COMPLETE —
   new sessions start here. Carries its own stale-claim ledger, safety-invariant gate
   ledger, exit-bar coverage map, and open questions OQ8 + OQ-A–E.

## What Phase 3 step 4 changed under you (contracts v1.3.3)

1. **Main is the persistence authority for CLI-thread messages now.** `thread:save`
   is a metadata-only merge for cli threads, branched on the ON-DISK agent inside
   the per-thread write queue (`ThreadStorage.saveThreadFromRenderer`; `agent` is
   immutable after mint — a relabeled payload buys nothing). Your renderer code can
   still call `thread.save` freely, but its `messages` array is ignored for cli
   threads: main appends the user message (top of `dispatchAgentTurn`), the
   assistant final (`onTurnComplete` in `ipc/shell.ts`, root = turn cwd else
   bind-time cwd — mid-turn kills persist their synthetic final), and status system
   messages via the new `thread:append-system` invoke. The renderer's
   `thread:cli-message` subscriber is display-only — persistence MOVED, it did not
   duplicate: exactly-once is the recorded §4 rule, double-append is the failure
   mode, and probe A gates it with the thread loaded in a subscribed renderer.
   Never hand-write a cli thread file.
2. **`dispatchAgentTurn(args, origin)` is exported from `ipc/cli-thread.ts`** — the
   one dispatch body behind `'cli-thread:input'`, the dev-gated
   `'cli-thread:test-dispatch'` (`!app.isPackaged && MACHINA_E2E=1` only), and your
   step-5 scheduler. It appends the user message first (missing file ⇒ `ok:false`,
   fail closed), runs the full validation chain (`resolveRequestedAgentId` →
   `resolveRequestedModel` — identical for every caller, audit entries carry the
   caller's origin), and is **serialized per threadId** — do not add your own
   per-thread locking on top, and do not call the spawner directly (`getSpawner`
   stays module-private; the export is the one sanctioned door). Extend
   `DispatchOrigin` with your scheduler's literal (r6).
3. **Fresh-PTY sends wait for the shell prompt in main** (`shell-readiness.ts`,
   BlockWatcher-fed, awaited before EVERY send; 10s bounded, send-anyway). The
   renderer harness poll still works and is now a harmless double wait.
4. **Open renderers refresh via `thread:changed`** (`store/thread-sync.ts`:
   root-filtered, replaces `messages`/`lastMessage` only). `thread:created` does
   NOT exist — unattended turns must target existing thread files (r1).
5. **Coordinated quit drains thread writes** (`drainThreadWrites`, after shell
   shutdown in `src/main/index.ts`). Failed appends surface as
   `thread:append-failed` audit entries under `userData/audit`.
6. **New e2e: `e2e/unattended-dispatch.spec.ts`** (probe A blurred unattended
   dispatch with the thread loaded in the renderer — the exactly-once gate; probe B
   attended regression guard with a settle-point recheck). Serial suite, shared
   Electron user-data dir, needs a real authed `claude` — run targeted/sequential.
7. **Residuals a later step will trip on** (full list: the v1.3.3 changelog + §4
   step-4 subsection in contracts): r4 — degraded/hookless `cli-raw` sessions emit
   no blocks, so a fresh raw turn eats the full 10s readiness timeout INSIDE the
   renderer's 15s `CLI_IPC_TIMEOUT_MS` window (a scheduler calling
   `dispatchAgentTurn` directly has no such ceiling); an explicit renderer
   `cli-thread:spawn` still runs OUTSIDE the per-thread dispatch queue and can
   race a dispatch's shared attribution maps (narrower than the fixed overlap —
   fence it when the step-5 scheduler lands); `appendMessage` stamps
   `lastMessage` unconditionally, so an overlapping turn's assistant final can
   move it backward (cosmetic sidebar ordering); the `thread-sync` subscription
   registration is NOT exercised by the unit suite (recorded minor) — deleting
   its side-effect import in `use-thread-streaming.ts` keeps `npm run check`
   green while killing unattended refresh, so verify that seam by hand if you
   touch it.

## What Phase 3 step 3 changed under you (contracts v1.3.2)

1. **Dock tab/layout state lives in `src/renderer/src/store/dock-store.ts` now.**
   thread-store.ts is 786 lines (the < 800 hard gate) and stays SHRINK-ONLY per the
   cross-step rule. `dockTabsByThreadId` / `dockActiveIndexByThreadId` /
   `dockCollapsed`, every dock tab action, `toggleDock`, the setActiveCanvas
   indirection, `validateThreadTabs`, and `flushDockState` moved; vault-persist
   imports `flushDockState` from dock-store. The two stores import each other —
   cycle-safe ONLY while no module top level reads the other's non-hoisted bindings
   (rule documented in the dock-store header; `syncActiveCanvas` is a function
   declaration on purpose). Read dock state from dock-store, thread identity from
   thread-store; the chat↔dock never-both-collapsed mirror now spans the two.
2. **The `kind:'terminal'` DockTab is gone** (union variant, `DOCK_TAB_KINDS`, render
   dispatch, tab-bar labels). Plain terminals live in the strip; agent sessions in
   ThreadPanel's agent surface (contracts §3 decision). The native `open_dock_tab`
   tool rejects `kind:'terminal'` at runtime. SurfaceDock's dock-tab agent-presence
   strip went with it — only terminal tabs could feed it.
3. **Terminal reconnect keeps the replayed viewport.** TerminalApp's first-flush
   whole-viewport erase wiped replayed ring-buffer lines still on screen — the
   migration-continuity regression the automated tick probe caught. It now clears
   only the current line; the guest source-pin test FORBIDS reintroducing a viewport
   clear on the reconnect path. Known cosmetic edge (observation, not a regression):
   if the ring-buffer replay ends mid-line and the FIRST live chunk is that same
   line's continuation (a fast-emitting program, not an idle prompt redraw), the
   current-line clear erases the replayed prefix and the continuation renders alone
   at column 0. No scrollback above is lost, and any resulting tick gap would fail
   the probe (it passed) — strictly better than the old full-viewport wipe.
4. **The single-projection invariant is contract + test:** at most one mounted
   webview per sessionId; the migration seam attaches the destination before
   detaching the source in one synchronous task; `session-router.register` stays
   last-writer-wins; no multicast in Phase 3. New probe: `e2e/tick-continuity.spec.ts`
   (UI-driven strip→canvas→strip, gapless dedupe-checked ticks, exactly one webview
   per hop, same OS shell PID via lsof-by-cwd, live PTY after Ctrl+C). It shares the
   Electron user-data dir with the other e2e specs — run targeted or sequentially.
5. **Casey-observed acceptance PASSED (2026-07-14 evening) — step 3 is DONE:** the
   live tick-counter run (strip→canvas→strip, consecutive ticks, same PTY) passed
   watched live; the DONE bar is met, the OPEN Phase-1 step-4 acceptance is
   closed, and the plain-terminal half of exit bar 2 is banked.
6. **Out-of-ownership edits flagged for the landing rebase:** `dock-tools.ts`
   (forced deletion of the retired terminal case), `thread-md.test.ts` (fixture kind
   swap), `TerminalApp.tsx` + `terminal-app.test.ts` (the continuity fix). All
   minimal, type-forced or regression-forced; pty-service untouched (its
   `reconnectQueue` is inert — `connected` never flips false — noted, not changed).

## What Phase 3 step 2 changed under you (contracts v1.3.1)

1. **The queue notify carries a delta.** `ApprovalQueueDeps.notify` is now
   `(pending, added)` and the `approvals:changed` payload is
   `{ pending, added }` — the added-items delta is computed at the queue's single
   mutation choke point (`notifyChanged`), empty on resolves/flag-merges/coalesces.
   Anything constructing an `ApprovalQueue` supplies the two-arg notify; renderer
   listeners that only read `pending` are unaffected.
2. **OS notifications + dock badge live in `services/approvals-notifier.ts`**, fed
   from exactly four taps: the queue delta (beside the persist wiring in
   `ipc/git.ts`, not through it), breaker trips (`ipc/cli-thread.ts`, beside the
   existing `typedSend`), watcher-down TRANSITIONS (`markApprovalsWatcherDown`),
   and mirror persist ok/failure (the step-1 swallowed-failure residual, closed —
   one notice per failure streak). The attention policy is a recorded product
   decision in contracts §4 — do not re-litigate; the loop-context class is
   reserved (`ApprovalsAddedItem.loopContext`, never set before step 6). Delivery
   is best-effort and access-safe: a notifier failure never fails the mutation.
3. **MCP write confirms are tray rows, not dialogs.** `mcp-lifecycle` builds
   `QueueHitlGate` over the queue via the late-bound `setMcpApprovalQueueProvider`
   seam (wired in `registerGitIpc`; an unwired provider DENIES, pinned). 30s
   fail-closed remove-on-timeout kept (OQ-B). `TimeoutHitlGate`/`ElectronHitlGate`
   are production-orphaned on the MCP path (classes + tests remain).
4. **Native holds mirror into the queue.** `tool_pending_approval` emits a `gh_`
   gate-confirm row (`enqueueGateHold` — no auto-deny timer; `removeGateHold`
   drops it when the hold settles native-side, one `approvals:hold-released`
   audit). Single resolution authority is the context.ts approvals map
   (`setHoldSettledListener` seam; `setNativeHoldQueueProvider` in
   `machina-native-agent.ts`, wired from `registerGitIpc`). Double-resolve is
   pinned in both orders; gate-confirms remain never-serialized.
5. **Appended surfaces:** `approvals:open-tray` IpcEvent + `ApprovalsAddedItem`
   (end of `ipc-channels.ts`), preload `notifications.onOpenTray`, and the tray's
   open-on-notification-click subscription. Tray gate-confirm rows carry a
   `write confirm` label, honest Approve/Reject titles, and a conditional footer
   sentence (pre-write confirms are not "already on disk").
6. **Casey-observed acceptance PASSED at the 2026-07-14 landing** (all Casey
   gates for the steps 2 ∥ 3 pair). Still genuinely open: OQ8 ratification
   (cross-root tray note + per-thread manual kill NOT implemented). Evidence
   (post review fix pass): check green — 317 files / 3850 tests (+40), build
   green, targeted `e2e/mcp-gate-confirm.spec.ts` green (31.0s); full e2e ran
   at landing.
7. **Review fix pass (same day, before landing):** gate deny reasons are now
   marker-free (`Approval queue timeout (30000ms)`, `Approval queue not wired`)
   and `mcp-server.ts` (untouched) adds its `Denied: ` prefix exactly once, so
   external MCP clients no longer see `Denied: Denied: …`; if you pin these
   strings, pin the new form. `tests/main/approval-queue.test.ts` was split at
   the 800-line ceiling into core + `approval-queue-scope.test.ts` (v1.3.0
   scope/real-git + v1.3.1 delta/holds) with shared fakes in
   `approval-queue-harness.ts`.

## What Phase 3 step 1 changed under you (`8f1323c`, contracts v1.3.0)

1. **The approval queue is multi-root and durable.** `initApprovalsForRoot` no longer
   clears it (the orphaned `ApprovalQueue.clear()` method was deleted entirely —
   recorded deviation); items carry and display their `capturedRoot`; cli-change items
   mirror to a versioned userData file (`approval-queue-persistence.ts`,
   HarnessRunRegistry pattern) and rehydrate once per app run, each re-validated
   against a fresh git diff of its OWN root — drift, missing root, or a failed diff
   recompute drops the item with an `approvals:rehydrate-drop` audit entry.
2. **Resolution never crosses roots.** `resolve()`'s `workspace-changed` refusal is
   untouched; the tray withholds Approve/Reject on foreign-root items and offers
   "Switch to <root> to resolve" through the one full-switch path (`te:open-vault` →
   `workspace.open()`). Gate-confirms now record `capturedRoot`, refuse cross-root
   resolution, and are NEVER serialized (queue-snapshot filter + decode-level refusal,
   both pinned). A pending gate-confirm survives a workspace switch only until its 30s
   timeout (recorded deviation from the old instant-deny-via-clear).
3. **Turn ids are run-unique** (`t<seq>-<runTag>`, minted per `CliTurnRegistry`
   instance) — the review-confirmed fix for cross-run `pc_<turnId>` collisions that
   could silently rebind a rehydrated item. Every later step inherits this shape; do
   not assume `t1`, `t2`… in tests. `recordWrites` also binds items to the
   caller-supplied capturing root (watcher passes its own root) and refuses to
   coalesce into an item whose `capturedRoot` differs (audited).
4. **`[diff unavailable` is not a comparable snapshot.** The marker constant +
   `isDiffUnavailable` live in `git-types.ts`; rehydration treats it as `diff-failed`
   (drop + audit). Builder and detector share the constant — keep it that way.
5. **Recorded residual minors** (step-1 DONE block in 06-phase-3-specs.md): no
   barrier against a pre-rehydrate queue mutation truncating the un-read mirror
   (re-check at step 6, which arms the trigger); mirror persist failures are swallowed
   (candidate for step 2's notification classes); no mirror flush on quit; transient
   stale-activeRoot tray window after a switch.
6. **Evidence:** check 3810 green (+42), build green, full e2e 26 + 1 known skip incl.
   the new `e2e/approvals-persistence.spec.ts` restart probe (real claude turn → item
   → quit → relaunch → rehydrate → trailered commit). Casey-observed acceptance
   PASSED (2026-07-15, live dev app): multi-root tray survival + the foreign-root
   switch-to-resolve affordance confirmed on the running app.

## Lessons that survive the phases

Unique load-bearing facts from Phases 1–2; the shipping chronicle lives in the
spec-doc DONE blocks and the contracts §8 changelog.

- **`terminal-strip-store.seed()` is FIRST-WRITE-WINS by design**: `loadThreads`
  re-runs mid-session (unarchive, vault re-open) and must not clobber live sessions
  (pinned in code — seed returns early if the threadId is present).
- **The harness frontmatter parser is deliberately NOT YAML** — it reads exactly the
  subset the generator emits (`key: value` + one `budgets` flow mapping, inline
  comments stripped); unreadable hand-edits surface as frontmatter-invalid
  diagnostics (Phase 2 step 7). Do not "fix" it by swapping in a full YAML parser.
- **bash/fish shell hooks were never re-verified** during the Phase-1 step-6 stale
  `~/.te.zsh` incident (zsh was fixed) — if cli replies misbehave under those shells,
  re-run the app's "Set up shell hooks".
- **`WriteRateLimiter` (hitl-gate.ts) uses wall-clock `Date.now()`** while the watcher
  clock is injectable via `deps.now` — prod-consistent by decision; this is why
  velocity tests use real timing.
- **The selection-time PTY spawn does not forward agentId** (input does, and input is
  where turns open) — observed in the Phase-2 step-3 probe; harmless, attribution
  unaffected, recorded so nobody rediscovers it as a bug.
- **`WorkspaceService.open()` re-entrancy is FIXED on main** (serialized open chain,
  last caller wins; regression tests in the workspace-service suite) — flagged in the
  Phase-1 step-1 review, do not re-litigate. The sibling FilesDockAdapter
  vault-switch finding is likewise FIXED (06's stale-claim ledger).
- **Chat-output quality pass (`fb7e17c`, thread-rendering only) residuals** for a
  later polish pass: the interim-stream → final-markdown reflow "pop" in
  `InflightAssistant`, and streamed-CLI finals dropping bridge metadata
  (`use-thread-streaming.ts` finalize path rebuilds the message — possibly partially
  addressed by v1.3.3 d4, which persists the bridge-final shape main-side; verify
  before carrying).
- **e2e gotchas** (bite every new built-app spec): `page.evaluate` dies across the
  boot-time `location.reload()` ("Execution context was destroyed") — locator waits
  span navigations, evaluate does not; after seeding + reload, wait on an app-mounted
  locator BEFORE any evaluate polling and wrap polled evaluates in try/catch
  returning a retry sentinel (`watcher-health.spec.ts` is the working template).
  Non-packaged runs share `~/Library/Application Support/Electron/` for
  electron-store + localStorage — pollution persists across runs; move the dir aside
  for a clean boot. A probe that runs a real headless `claude --print` turn needs a
  repo-local `.claude/settings.json` allowlist in its throwaway repo (`npm test` /
  `sh` / `node`) or it blocks forever on an interactive permission prompt — real
  users answer those in the dock terminal.

## The five things that will bite you if you skip the docs

1. **The gate is post-persistence containment, not prevention.** CLI-agent writes are
   live on disk before anyone reviews them. Approve blesses into history; Reject reverts
   via git. UI copy and your own mental model must never claim writes are blocked. The
   agent is a full shell — it can run git itself; we detect (headMoved tripwire), we do
   not prevent. Adapter-native permission hooks were DEFERRED (OQ1, recorded in
   04-phase-2-specs.md; OQ-C records the Phase-3 disposition) — containment stays
   post-persistence; a reserved `AgentAdapter` capability field keeps the future seam
   cheap.
2. **Never let rollback coverage gap.** DISCHARGED 2026-07-06: step 5's G1–G8 evidence
   gate passed on fresh runs (G6 included) and the snapshot was retired in the same
   step — coverage never gapped. The rule's spirit survives: rollback is now the
   approvals gate exclusively; do not weaken it without an equivalent evidence gate.
3. **The AgentWriteWatcher must NOT reuse vault-watcher's ignore patterns.** Those
   ignore TE_DIR and all dotpaths, which would blind the verify.sh auto-reject and every
   `.env` write. Contracts §4 specifies its own ignore policy.
4. **Use the TE_DIR constant, never a literal `.machina`** (dev runtime is
   `.machina-dev`). The single exception is `HARNESS_PROTECTED_GLOBS`, which
   deliberately carries both variants.
5. **Verify disk before editing.** Each spec doc's line numbers were verified at its
   own spec pass, and steps move each other's code; `rg` first. This repo has also
   used git skip-worktree bits that silently ignore Writes (`git ls-files -v`).

## House rules that apply to every step

- Commit directly to main, one step per commit, no feature branches. Full pre-commit
  gate: `npm run check` + `npm run build`, fresh runs, evidence not transcription.
- Every deliberate deviation from the contracts amends `01-interface-contracts.md` in
  the same commit. `CLAUDE.md` is the fuller reference and `AGENTS.md` is the tracked,
  Codex-scoped instruction file; update each intentionally when its audience needs the
  change. `npm run sync:agents` never overwrites the curated file.
- Contracts §8 changelog entries go at the TOP (reverse-chronological) — the Phase-2
  4∥7 append-at-end rule caused avoidable churn; keep top-inserting.
- Dev-app/DevTools smoke checks are driven by the agent, not handed to Casey as steps.
  Electron visual verification is Casey observing the running app — no programmatic
  Electron screenshots. Casey-observed acceptance gates are named per step in the
  spec docs.
- Surgical scope: every changed line traces to the step's spec. Files under 800 lines
  (`thread-store.ts` is at 786 as of 2026-07-15 — Phase 3 step 3's dock-store
  extraction brought it under the cap after "route around it" failed twice; it is
  SHRINK-ONLY: no step may grow it).

## Machinery you inherit (verified working, don't rebuild)

PTY core with ring-buffer reconnect (`terminal:reconnect` already exists — migration is
a renderer affordance), block protocol (OSC hooks → BlockDetector → BlockWatcher),
safety trio (`hitl-gate.ts` / `audit-logger.ts` / `path-guard.ts`), typed-IPC 4-step
pattern, `ShellService.create` already takes per-session cwd, `ThreadStorage` already
takes its root. (The pre-run snapshot listed here historically was retired by step 5 —
rollback is the approvals gate.) The full reuse map
with import-graph evidence is in 00-seam-audit.md §1.

## Open items deliberately left for later phases

LSP + git map (Phase 4), adapter-native permission hooks (OQ1 deferral, reserved seam;
OQ-C records the Phase-3 disposition), worktree isolation (only if parallel usage
demands), renderer "workspace" filter-naming cleanup, state.md knowledge-indexing,
DocumentManager coordination for git discard. The loop scheduler, per-slug budget
aggregation, and max-$ budget are no longer vague later-phase items — they are the
specced Phase 3 steps 5–7 in `06-phase-3-specs.md`, whose stale-claim ledger also
corrects the old "no cost observable" deferral rationale (claude emits
`total_cost_usd`; do not restate the old rationale). MCP gate convergence onto
QueueHitlGate LANDED at Phase 3 step 2 (contracts v1.3.1). The full residual lists
with rationale: end of `02-phase-1-specs.md` (Phase 1) and "Deferred / accepted
residuals" in `04-phase-2-specs.md` (Phase 2).

## Handoff maintenance rule

When a phase completes, its per-step "changed under you" sections collapse to
pointers at the next landing — the dated DONE blocks in the spec docs and the
contracts §8 changelog are the permanent record. This file stays under ~500 lines:
it carries the current phase's live working set, the next work order, and the
digest above. Never delete a unique load-bearing fact during a compaction — move it
into "Lessons that survive the phases" (or its canonical spec doc) first, and
repoint any cross-doc pointers in the same commit.
