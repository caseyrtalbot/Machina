# Workstation Track — Handoff

You are picking up the Machina → agentic-development-workstation track. This file is the
cold-start: read it, then the three docs it points at, and you can start building without
asking questions.

## Where things stand (2026-07-14, Phase 2 shipped; Phase 3 spec pass landed)

The vision is locked and the design is verified. Phase 0 (seam audit + interface
contracts) shipped to main. The Phase 0 docs were then adversarially re-verified by an
11-agent workflow (4 verification lenses over 52 claims, 6 independent step designers, 1
completeness critic); every confirmed error was folded back into the docs, so what you
are reading is the corrected state (contracts now v1.1.1).

**Step 1 (workspace generalization) is SHIPPED** at `76d0699` — full gate green,
smoke-verified on the built app (coding repo boots with `capabilities: ['coding']`,
existing vault with `['knowledge']`).

**Step 2 (git substrate) is SHIPPED** at `3198ddd` — implemented by a 10-agent workflow
(4 sequential implementers, full-gate agent, 4-lens review: spec compliance, adversarial
git plumbing, test quality, Codex cold read; all 9 blocker/major findings fixed with
mutation-verified tests). Full gate green (`npm run check` 2909 tests, build,
`npm run test:e2e` 17 passed / 1 fixme-skipped). Smoke-verified on the built app via
Playwright probes: `git.status`/`diff`/`commitApproved` (both trailers in `git log`)/
`revertAgent` (restore + Machina-Reverts) on a real dirtied repo, non-repo structured
no-ops, and per-turn snapshot granularity (2 turns sent ⇒ exactly 2 pre-agent snapshot
commits). **Steps 3 (gate parity) and 4 (dock shell) are both SHIPPED** — see their
"What step N changed under you" sections below. **Steps 5 (snapshot retirement) and 6
(test-fixer template) are ALSO SHIPPED** (2026-07-06, parallel sessions; step 6 landed
first at `5f5c641`, step 5 rebased onto it and landed only after all of G1–G8 passed
on fresh evidence). The pre-run snapshot is RETIRED — the approvals gate owns CLI
rollback now; the gate checklist, parity ledger, and full P1/P2 transcripts live in
`03-snapshot-retirement-evidence.md`. **The Phase-1 tracer bullet PASSED with Casey
confirming on the running app (2026-07-06)** — see "Definition of done" below;
`HANDOFF-PARALLEL-STEPS-5-6.md` deleted per its own instructions. Phase 1 is COMPLETE.

**Phase 2 is underway. Steps 1, 2, and 3 are SHIPPED** — step 1 (adapter
registry + model aliasing + raw fallback) at `18cc29d` (contracts v1.2), step 2
(watcher health model) at `be07439` (contracts v1.2.1), plus a chat-output quality
pass at `fb7e17c` (thinking indicator, secret masking in thread output, honest tool
status), and step 3 (main-side harness↔thread binding + harness:run attribution
authority) at `4047d35` (contracts v1.2.2). All landed with the full gate (3345
tests at step 3, build, full e2e executed); step 3 additionally ran the built-app
tamper probe green (see its DONE block in 04-phase-2-specs.md).

**Steps 4 (two-projection agent view) and 7 (harness linter) SHIPPED 2026-07-07**
as the sanctioned parallel pair: built by two isolated worktree sessions off
`3e8baee`, merged linearly (step 4 at `61f8ce3`, contracts v1.2.3; step 7 at
`065d312`, contracts v1.2.4), then hardened by a post-merge adversarial review
(per-step Claude lenses + Codex cold read + merge spotcheck) whose blocker/major
findings landed in a same-day follow-up fix commit — see "What step 4/7 changed
under you" below. Full gate on the final tree: `npm run check` 3421 tests green,
build green, full e2e 21 passed / 1 known fixme-skip INCLUDING both new built-app
probes executed green (`e2e/agent-projection.spec.ts`, `e2e/harness-lint.spec.ts`).

**Steps 5 (per-agent revert UI) and 6 (budget stack + circuit breakers + kill
switch) SHIPPED 2026-07-07** as the second sanctioned parallel pair: two isolated
worktree sessions per the 5∥6 work order (step 5 landed FIRST at `5b1589d`,
contracts v1.2.5; step 6 rebased onto it and landed at `24d53e1`, v1.2.6), then a
post-merge 7-lens adversarial review (step-5/step-6 spec compliance, adversarial
git plumbing, adversarial breaker/kill semantics, test quality, merge spotcheck,
Codex cold read) plus the full sequential e2e run surfaced 9 confirmed majors —
ALL fixed in the same-day hardening commit `c1b21c8` (contracts v1.2.7). Full
gate on the final tree: `npm run check` 3505 tests green, build green, e2e 24
passed / 1 known fixme-skip, including both new built-app probes executed green
(`e2e/revert-agent.spec.ts`, `e2e/agent-breaker.spec.ts`). The review record is
`05-steps-5-6-review-followup.md` (RESOLVED); the 5∥6 work-order file
(`HANDOFF-PHASE2-STEPS-5-6.md`) was deleted per its own instruction — see "What
Phase 2 step 5/6 changed under you" below.

**Step 8 (template gallery + blank builder) is SHIPPED 2026-07-10** as the final Phase 2
implementation step (contracts v1.2.8). Casey resolved OQ7 on 2026-07-09: the roster is
the exact ten-role Guided / Architecture / Engineering / Bridge catalog recorded in
contracts §5 and the step-8 spec. Casey accepted the previously pending visual/timed gate
by direct instruction on 2026-07-10. Fresh landing evidence: focused UI tests, adjacent
gallery/palette tests, `npm run check`, production build, full built-app E2E, targeted
visible-`New Agent` built-app E2E, dependency audit, and whitespace/format checks. Do not
reconstruct or replace the roster from older ~5-template text.

**The Phase 3 spec pass LANDED 2026-07-14**: `06-phase-3-specs.md` (9 steps, canonical
order) distilled from a 4-designer + 2-judge workflow over six disk-verified
investigation dossiers — both judges independently selected the risk-lens design;
grafts from the three runners-up are folded in and attributed inline. The spec carries
a stale-claim ledger (cost observable now EXISTS for claude — the old "no cost
observable" deferral rationale is corrected at step 5; FilesDockAdapter split-brain
follow-up verified FIXED on disk; `thread-store.ts` is actually 1009 lines, remediated
by step 3's dock-store extraction).

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
acceptance pending: multi-root tray survival + foreign-root affordance on the
running app.

**Next work order for the incoming team(s):**

- **Next = Phase 3 step 2** (notifications + propose-surface convergence, v1.3.1;
  Session A) — and **step 3** (migration substrate + tick-counter + dock-store
  extraction, v1.3.2; Session B) is parallel-safe with it per the spec's
  two-session schedule (step 3 must land before step 4 starts — the
  `thread-store.ts` collision).
- **Casey answers wanted (recommendations are the defaults if unanswered):** OQ8
  ratification at kickoff (blocker-class now — loops + canvas cards multiply
  cross-root PTYs; step 6 carries a root fence as the interim), plus OQ-A through
  OQ-E in the spec's open-questions section.
- Dependabot triage still open: `npm audit --omit=dev` reports 1 moderate production
  vuln (js-yaml via gray-matter); Phase 3 step 6 must take the scoped fix or record
  why not (spec cross-step rule).
- Untracked `.agents/skills/thought-engine-council/` at the repo root is Casey's —
  leave it alone, do not commit or delete it.

## The doc map (all in this folder — trust these over memory or older drafts)

1. **PLAN.md** — the vision: 13 locked decisions, five primitives, four phases,
   invariants. Do not re-litigate the decision table.
2. **00-seam-audit.md** — file:line evidence for every seam Phase 1 builds on, plus the
   two work orders (workspace generalization, gate parity). Has a corrections log.
3. **01-interface-contracts.md** — the typed contracts (v1.1). Section 4 is the
   load-bearing one: read its framing before touching anything agent-related.
4. **02-phase-1-specs.md** — six implementation specs in canonical order, one commit
   each. This is your work queue. Steps 1–4 are DONE (`76d0699`, `3198ddd`, `424b3cc`,
   step 3's landing commit); next are steps 5–6. Line numbers in the specs were
   verified at `7735644`/`ec6fa6d` and later steps have since moved code — re-verify
   with `rg` before editing.
5. **04-phase-2-specs.md** — the Phase 2 work queue (8 steps, canonical order; spec
   pass 2026-07-06 from a 4-designer + 2-judge workflow over four disk-verified
   investigation dossiers). Phase 1 is COMPLETE — new sessions start here. Pre-Phase-2
   hardening already landed: AGENTS.md regen unparked (`c7d463f`), symlinked-parent
   harness refusal + contracts v1.1.5 (`660dc56`). **Steps 1 (`18cc29d`), 2
   (`be07439`), and 3 (`4047d35`) are DONE — each step header carries a dated DONE
   block with its recorded deviations. Steps 4 (`61f8ce3`) and 7 (`065d312`) are
   DONE (2026-07-07, parallel worktree sessions + post-merge review fix commit).
   Steps 5 (`5b1589d`) and 6 (`24d53e1`) are DONE (2026-07-07, the second parallel
   pair, hardened post-merge at `c1b21c8`, contracts v1.2.7). **Step 8 is DONE
   (2026-07-10, contracts v1.2.8)\*\* — exact ten-role roster, visible sidebar New Agent
   entry point, mandatory task brief, raw bridge hardening, and blank builder shipped.
6. **06-phase-3-specs.md** — the Phase 3 work queue (9 steps, canonical order; spec
   pass 2026-07-14 from a 4-designer + 2-judge workflow over six disk-verified
   investigation dossiers; both judges picked the risk design). Phase 2 is COMPLETE —
   new sessions start here. Carries its own stale-claim ledger, safety-invariant gate
   ledger, exit-bar coverage map, and open questions OQ8 + OQ-A–E.

## What step 8 changed (`2026-07-10`, contracts v1.2.8)

1. **The gallery is an exact ten-role spectrum**, not a generic agent-name list:
   `idea-to-spec`, `docs-maintainer`, `automation-builder`, `architecture-mapper`,
   `boundary-auditor`, `migration-planner`, `bug-reproducer`, `test-fixer`,
   `vertical-slice-builder`, and configuration-required `raw-tool-runner`. Category and
   audience filters cover non-engineers, low-code users, systems thinkers, architects,
   seasoned programmers, and platform builders. All ten still materialize the same
   transparent harness folder and generalized run path. The primary visible entry point is
   the thread-sidebar footer **New Agent** button; the command palette `New agent…` action
   remains a secondary shortcut into the same gallery.
2. **Installing a role is not starting a task.** Every launch opens a mandatory task-brief
   dialog; renderer and main both reject blank/NUL/oversized input, main delimits the exact
   brief beneath rules/scope authority, and the first turn targets the created thread
   explicitly. A transport refusal or bounded IPC failure must retain the brief rather
   than claim the run started.
3. **Raw is a configured bridge, not an escape from authority.** The product never invents
   its command or scope. A valid raw harness uses a standalone unquoted `{prompt}`
   placeholder in one hook-observable simple command, rejects controls/lone surrogates and
   unstable shell forms, requires literal arguments to be quoted, and emits an
   alias-stabilized executable. Main snapshots adapter + invocation in the write-once
   binding, exposes only readiness, rejects identity drift, validates the final PTY command,
   and rolls back a missing-session queue refusal. Shell functions with the executable's
   name remain a documented shell-resolution caveat; hook correlation stays byte-exact.
   Ad-hoc raw remains terminal-only.
4. **Creation and launch are fail-closed.** Shared draft assembly owns preview/main byte
   construction, protected-glob union, frontmatter round-trip, budgets, and verifier
   admission. Main creation never overwrites and writes verify.sh last at 0555. Launch uses
   one realpath-confined inspection snapshot for lint, prompt, and binding; redirected
   required leaf entries refuse.
5. **Dispatch timeout and workspace fences are explicit.** Non-cancelling renderer IPC
   timeouts now return `indeterminate`, retain late settlements, replay Stop onto late
   native run ids, and keep sending blocked until a main-originated completion/refusal.
   Thread deletion/close tombstones prevent late session resurrection; workspace switches
   fence stale state without auto-killing old-workspace PTYs (OQ8 remains excluded).
6. **The bug-reproducer gate is exact-path evidence, not whole-suite red.** JS/Python/Go/
   Rust runners are file-targeted where safe; unsupported setup, discovery, load, hook,
   build, or unrelated-suite failures refuse as non-evidence. The verifier enforces
   pre-run and post-run dirty-tree guards and kills timed-out child/grandchild process
   trees before reporting failure.
7. **Exit evidence is split honestly.** The built-app Playwright probe covers exact cards,
   filters, blank/custom-scope creation, file/mode shape, protected union, duplicate
   preservation, mandatory task persistence, and raw configuration without command
   execution. Deliberate mutation of the in-memory built-in registry remains a main-service
   test because production IPC cannot mutate that registry without adding a test-only hook.
   Fresh evidence on 2026-07-10: focused bug gate 38 tests, dispatch/session gate 131
   tests, raw/bridge/harness gate 313 tests, visible-gallery UI tests 20 tests, adjacent
   gallery/palette tests 67 tests, `npm run check` 313 files / 3768 tests, build green,
   full E2E 25 passed / 1 existing skip, targeted visible-`New Agent` built-app E2E
   passed, and `npm audit --omit=dev` still reports one moderate `js-yaml` advisory via
   `gray-matter`. Casey accepted the under-five-minute visual/timed gate by direct
   instruction on 2026-07-10.

## What step 1 changed under you (`76d0699`)

1. **Root resolution now lives in `WorkspaceService`**
   (`src/main/services/workspace-service.ts`, singleton via `getWorkspaceService()`).
   `current()` returns `{ id, root, capabilities } | null`; `guard()` returns the one
   PathGuard. The old `filesystem.ts` exports (`setActiveVault`, `onVaultReady`,
   `activePathGuard`, `activeVaultRoot`) are GONE — step 2's git/approvals handlers
   resolve root from `getWorkspaceService().current()` main-side, exactly as contracts §6
   assumes; no `getActiveVaultRoot()` bridge is needed.
2. **`open()` order is load-bearing**: canonicalize → detect capabilities (BEFORE the
   TE_DIR scaffold; never key detection on TE_DIR contents) → PathGuard →
   `fileService.initVault` → set current → sequential-await ready callbacks.
   `vault:init` survives as a one-release alias that returns `ws.root`.
3. **`cli-thread:input` now requires `cwd`** (renderer sends `ctx.vaultPath` from
   `agent-transport.ts`). Step 2's per-turn `commitPreAgentSnapshot` goes inside
   `CliThreadSpawner.input()` which already receives that cwd — the spawner signature
   did not change.
4. **Config keys are `lastWorkspacePath` / `workspaceHistory`** with a `has()`-gated
   absent-only fallback to the legacy `lastVaultPath` / `vaultHistory`
   (`src/main/ipc/config.ts`, `LEGACY_KEY_FALLBACKS`). A stored null must never
   resurrect the legacy value; writes land on new keys only. Do not reintroduce the old
   key names anywhere — an exit-check `rg` in the specs enforces this.
5. **MCP tool counts moved**: the three `vault.*` tools are also registered under
   `workspace.*` aliases (invoked name flows into Spotlighting + gate prompts) — 12
   tools in the gated app server (`MCP_TOOL_COUNT`), 7 read-only in `mcp-cli`. Known
   accepted gap: `VaultQueryFacade`'s internal audit lines still say `vault.*`.

## What step 2 changed under you (`3198ddd`)

1. **`git-service.ts` replaced `vault-git.ts`** (git mv, history preserved; the
   snapshot trio is byte-identical). New exports: `headSha`, `status` (entries only —
   `isRepo` is composed at the IPC layer per §6), `diff`, `commitApproved`,
   `revertAgent`, `discard(root, paths, removeFile)` — discard REQUIRES the injected
   removeFile; the IPC layer binds `shell.trashItem`. All paths reach git as
   `:(literal)` pathspecs after a post-symlink containment check — pass plain relative
   paths, the service does the pinning.
2. **`getApprovalQueue()` in `src/main/ipc/git.ts`** is the lazy singleton step 3 wires
   the watcher/registry into — same instance the `approvals:*` handlers serve. The one
   AuditLogger lives at `userData/audit` (outside any watch root). Step 3's producer
   API: `recordWrites({ turnId, threadId, agentId, paths, flags?, description? })`
   (coalesces into `pc_<turnId>`, flags OR-merge, diff recomputed over the merged set)
   and `enqueueGateConfirm(opts, 30_000)` (the QueueHitlGate seam — auto-deny AND
   remove on timeout).
3. **Queue items are workspace-root-bound**: resolve in a different active workspace
   returns `workspace-changed`, item retained; failed approve/reject also retains the
   item. Checked before the stale-diff recompute.
4. **Machina-Reverts trailer value = the reverted shas** (not the agentId — see
   contracts v1.1.1 §8 for why); the agentId lives in the revert commit subject.
5. **Per-turn snapshot lives in `CliThreadSpawner.input()`** behind the
   `hasLiveSession` branch (the respawn path snapshots inside `spawn()` — exactly one
   snapshot per turn, ordering-tested). Step 5's retirement removes both call sites.

## What step 4 changed under you (`424b3cc`)

1. **Terminal strip state is per-thread and rides the thread file.**
   `dockState` is now `{ tabs, terminalStrip? }` (`src/shared/thread-types.ts`);
   legacy files decode `terminalStrip === undefined`. The strip store
   (`src/renderer/src/store/terminal-strip-store.ts`) must never import
   thread-store (thread-store imports it: seed in `loadThreads`, flush in
   `flushDockState`, drop in `deleteThread`). `seed()` is FIRST-WRITE-WINS —
   `loadThreads` re-runs mid-session (unarchive, vault re-open) and must not
   clobber live sessions. `drop()` kills the thread's bound PTYs.
2. **PTY lifetime across surfaces.** Migration = the existing
   `terminal:reconnect` seam (contracts §3): `stripToCanvas`/`canvasToStrip`
   (`terminal-migration.ts`) never kill; `canvas-store.removeNode(id,
{ preserveSession: true })` is the kill opt-out. The load-bearing tests
   assert kill is NEVER called on detach/migration — keep them honest.
3. **The close-before-bind race is handled by pendingKill parking.** Closing a
   strip tab whose webview has not yet reported `session-created` parks the
   session (store field `pendingKill`, runtime-only, never persisted); its
   webview stays mounted hidden IN THE SAME KEYED MAP POSITION (a remount
   would spawn a second PTY) until the id arrives and `resolvePendingKill`
   kills it. Known residual: spawn-then-instant-thread-switch (or thread
   delete) before bind still leaks one PTY — the reporting webview unmounts.
   Real fix is host-side sessionId pre-allocation (extend `terminal:create`
   to accept a caller-supplied id); left for a later step.
4. **TerminalDockAdapter** now takes `cwd` + `onSessionCreated`/`onSessionExited`
   (ipc-message protocol shared with TerminalCard) and always puts `cwd` in the
   webview URL — a stale persisted sessionId falls through reconnect and
   respawns there. URL construction lives in the pure builders in
   `terminal-webview-src.ts`; keep param names in sync with
   `TerminalApp.readUrlParams`.
5. **`fs:select-file`** landed per contracts §6 (guard-checked, null outside
   root, `guardSelectedFile` exported for tests). Appended at the END of
   `IpcChannels` and of the preload `fs` namespace (parallel-session
   append-only rule) — a later tidy-up may regroup it with the fs section.
6. **FilesDockAdapter vault switching is fixed** (step-1 review follow-up):
   `handleOpenVaultPicker`/`handleSelectVault` now dispatch the
   `te:open-vault` CustomEvent → `orchestrateLoad` → `workspace.open()`. The
   `onChangeVault` prop is accepted but unused.
7. **Known cosmetic/UX residuals** (from the step-4 review, deliberately not
   done): strip webview has no render-process-gone recovery; ctrl+backquote
   does not reach the host while a terminal webview has focus (webview
   isolation); a PTY that exits while its strip webview is unmounted respawns
   fresh on revisit; `thread-store.ts` sits at ~830 lines (was 825 — the 3
   sanctioned touches only). **Manual migration acceptance (tick-counter,
   Casey observing) is still open.**

## What step 6 changed under you (test-fixer harness)

1. **The harness surface is four new modules + one IPC file.**
   `src/shared/harness-types.ts` (slug regex, `HarnessScope`,
   `validateHarnessScope` superset check, Result-typed frontmatter parser,
   pure `buildHarnessPrompt`, re-exports `HARNESS_PROTECTED_GLOBS` from
   constants.ts where step 3 landed it), `src/shared/harness-templates.ts`
   (the one 'test-fixer' template; `<dir>` placeholders in allowedGlobs are
   materialized to `<TE_DIR>/agents/<slug>` at create time),
   `src/main/services/harness-service.ts` (create/list),
   `src/main/ipc/harness.ts` (root resolved main-side; null root ⇒
   `{ ok:false, error:'no-workspace' }` / `[]`), renderer
   `store/harness-store.ts` + `store/harness-run.ts`. Channels + preload
   `harness` namespace appended at file end per the standing rule.
2. **Create-order is load-bearing**: slug → template → scope validation
   (refuse-to-emit, BEFORE any write) → non-recursive `mkdir` (the
   no-overwrite check: EEXIST = structured error, never touch) → five
   entries → verify.sh LAST + chmod 0o555 → on any failure the partial dir
   is removed so the slot stays reusable. `harness:create`'s ok `root` is
   the created harness directory (absolute), not the workspace root.
3. **The frontmatter parser is deliberately not YAML.** It reads exactly the
   subset the generator emits (`key: value` + one `budgets` flow mapping,
   inline comments stripped). Hand-edited SKILL.md files it cannot read are
   skipped by `harness:list` (skip-not-throw), not errors.
4. **Thread.agentId is a persisted optional field** (`agent_id` in thread
   frontmatter, thread-md.ts): `createThread(agent, model, title, agentId?)`
   overlays + saves it, and `agent-transport.ts` re-sends it on EVERY
   cli-thread:spawn/input so harness attribution survives relaunch
   (spawn-on-demand path). Absent → spawner defaults to adapter identity —
   zero spawner/registry changes, exactly the step-3 seam.
5. **Palette wiring**: `buildPaletteItems` takes an optional `harnesses`
   snapshot; CommandPalette subscribes to harness-store and refreshes it on
   palette open. Create failures surface via `notifyError` (toast), success
   via `showToast`.
6. **harness-run waits for the fresh PTY's first prompt before the first
   turn** (`waitForNewShellPrompt`, block-store as the readiness signal,
   10s timeout then proceed-anyway). The scripted createThread→
   appendUserMessage path types the invocation into a shell that has not
   finished rc init; the te preexec hook isn't live yet, the block's
   command is mis-derived from the prompt echo, `detectAgentFromCommand`
   fails, and the reply is silently never mirrored. Humans never hit this
   (they type seconds after spawn). Write attribution is unaffected either
   way (PTY-alive window).
7. **Environmental find with daily-driver impact**: the INSTALLED
   `~/.te.zsh` on Casey's machine was a stale pre-`cmd=` version — its
   command-start marker carried no command, so block commands were derived
   from output echo at command-end, which included the prompt line and
   broke the bridge's agent detection (cli-thread replies lost). Fixed
   during the step-6 smoke by installing the current bundled hook (old file
   backed up at `~/.te.zsh.pre-step6-backup`). The bash/fish hooks were NOT
   checked — if cli replies misbehave under those shells, run the app's
   "Set up shell hooks" again.
8. **Smoke note for later steps**: Playwright probes drive the BUILT app, so
   TE_DIR is `.machina` there; `npm run dev` uses `.machina-dev`. The
   exit-bar transcript for step 6 (including the tray-approved
   `Machina-Agent: test-fixer` commit on a throwaway repo) is recorded in
   02-phase-1-specs.md step 6. The throwaway repo carried a repo-local
   `.claude/settings.json` allowlist (`npm test`/`sh`/`node`) so headless
   `claude --print` never blocked on an interactive permission prompt — in
   real use the user answers those in the dock terminal.

## What step 5 changed under you (snapshot retirement)

1. **`commitPreAgentSnapshot` is GONE.** Both call sites removed from
   `CliThreadSpawner` (spawn-site + the per-turn call in `input()`), and the
   function, `PreAgentCommitResult`, the `<TE_DIR>/no-auto-commit` opt-out, and
   `isAutoCommitOptedOut` are deleted from `git-service.ts`. `isGitRepo` and the
   whole §2 substrate are unchanged. `cwdByThread` was NOT orphaned (it still
   feeds `registry.turnStarted`) and stays. `rg 'commitPreAgentSnapshot' src
tests` is zero — do not reintroduce it; rollback is the approvals gate
   (commitApproved trailers / discard / revertAgent).
2. **The retirement was evidence-gated, not assumed.** All of G1–G8 passed
   fresh at the landing HEAD — including G6 (hooks physically absent: writes
   still queue via the PTY-alive fallback with `flags.degradedAttribution`,
   proven on the built app with zero block events) — see
   `03-snapshot-retirement-evidence.md` for the checklist, the parity ledger
   (non-repo, gitignored, out-of-root, agent-runs-git), and the full P1/P2
   transcripts. The opt-out went with the snapshot because it only ever gated
   automatic commits and none remain (contracts §8 v1.1.4 — renumbered; step 6
   landed first and took v1.1.3).
3. **A probe-transcript gotcha for later steps**: the app scaffolds its own
   untracked `<TE_DIR>/` in any opened repo — a "porcelain clean" assertion
   after reject must except that scaffold (it is app state, not an agent
   write; the watcher excludes it too).
4. **Doc reconciliation**: overview.md CLI-agent paragraph, contracts §2/§4
   dated status lines, CLAUDE.md agents bullet, and safety-subsystem.md
   CLI-thread section all now describe the approvals-gate containment story
   (the latter two are gitignored — updated copies were synced to the
   canonical clone at landing). AGENTS.md regeneration remains PARKED
   (backlog: steps 1 + 5).

## What step 3 changed under you (gate parity)

1. **The attribution primitive is `getCliTurnRegistry()`**
   (`src/main/services/cli-turn-registry.ts`). Turn windows: open on spawner
   send, closed by the bridge's `onTurnComplete` (once per completed/cancelled
   block) via **open-invocation counting** — `turnEnded` only stamps when
   sends minus completions drains to 0, so a cancelled turn's late block
   cannot close the follow-up turn (over-counting leaves the window open:
   over-attribution, never silent escape). EVERY open window requires
   `isPtyAlive` (late-bound probe = `spawner.hasLiveSession`, set in
   `ipc/cli-thread.ts`); closed windows linger LINGER_MS regardless.
   `threadClosed` drops the window with zero linger — trailing ~400ms of fs
   events become audited unattributed writes (accepted trade, documented).
2. **headMoved is a two-point tripwire with an immutable baseline.**
   `headShaAtStart` never changes; queue-made approval commits are recorded
   per-turn (`noteQueueCommit`, wired in `ipc/git.ts`) and excused by the
   `git rev-list` walk in `isAgentHeadMove` (exported, pure). Detection at
   every attributed batch (audited once per turn) AND at turn close
   (`checkHeadMovedAtTurnEnd` in `ipc/git.ts` — catches a trailing
   self-commit that produces no watched fs event). An agent commit hiding
   BENEATH a later approval commit is still caught (walk-based, not
   tip-compare). A turn that commits and then writes can produce two audit
   entries (mid-turn + turn-end, disambiguated by `at:'turn-end'`) — by
   design, two independent detection points.
3. **`AgentWriteWatcher` re-binds via `initApprovalsForRoot(root)`**; its
   counterpart `stopApprovals()` is the FIRST await in `reconfigureForVault`
   (the active workspace flips before ready callbacks run — a stale watcher
   batch must never route against the new root; `autoReject` also takes the
   watcher's `expectedRoot` and refuses on mismatch). The watcher suppresses
   the queue's own discard echoes (`suppress(paths)`, 10s TTL, wired around
   the discard binding in `ipc/git.ts`) — without it, a Reject inside a
   still-open window resurrects the just-resolved item. `dist/build/out` are
   excluded at TOP LEVEL only; `.git`/`node_modules` at any depth.
4. **Approve commits AROUND gitignored-untracked paths**
   (`git-service.ignoredUntracked`: check-ignore `--stdin -z` minus
   index/HEAD membership) — `git add` exits 1 on any ignored pathname while
   still staging the rest, which would brick the item on every retry.
   All-ignored items degrade to acknowledge. Tracked-but-ignored files are
   NOT filtered.
5. **Known accepted residuals**: CLI PTYs from workspace A keep writing
   unwatched after a switch to B (contracts §4 scope limits — the tray footer
   states root-only scope; killing PTYs on switch is a product decision, not
   step 3's); self-write suppression outranks the forbidden-path check
   (inverting would auto-trash legitimate user edits to rules.md made through
   the editor; the ~2s same-path race is the contract's accepted timing
   race); `WriteRateLimiter` uses wall-clock internally while the watcher
   clock is injectable (prod-consistent; velocity tests use real timing).
6. **The step 6 seam is live**: `cli-thread:spawn`/`input` accept optional
   `agentId` (stored per thread, defaults to identity) — the harness slug
   flows into turn attribution and commit trailers with no further plumbing.

## What Phase 2 step 1 changed under you (`18cc29d`)

1. **The adapter registry is the single invocation authority.**
   `src/shared/agent-adapters.ts` (pure, renderer-importable): per-adapter
   `formatInvocation` absorbed the spawner's `formatCliInvocation` switch, optional
   `parseEvent` absorbed the bridge's claude/codex extractors
   (`supportsStructuredOutput` is now `!!adapter.parseEvent`), and `models` rosters are
   spike-verified. Session shapes live in `src/shared/session-types.ts` (contracts §3
   landed) — do NOT confuse with `cli-agent-session-types.ts`, which is CLI-agent
   _presence_ types (the seam-map trap the spec warns about).
2. **The model-flag trust rule lives at the IPC boundary** (`resolveModelPick`,
   `src/main/ipc/cli-thread.ts`): a flag is emitted ONLY for an explicit user pick that
   passes membership in `adapter.models` plus a charset regex. Absent, unknown, or the
   persisted `DEFAULT_NATIVE_MODEL` filler ⇒ adapter default with no flag; rejected
   explicit picks are audited. The **golden byte-exact invocation tables** in the
   spawner tests are the regression harness — extend them when you touch invocation
   construction; never bypass them.
3. **Historical step-1 baseline:** ad-hoc `cli-raw` is input-disabled: plain PTY, no
   parser, no resume, no models. The current unlanded step-8 worktree adds only the
   harness-bound structured path, backed by a main-snapshotted invocation template;
   ad-hoc raw stays disabled.
4. **`Thread.model` is real for CLI threads now** — `setThreadModel` is un-no-op'd and
   the model round-trips through thread-md encode/decode. Gemini's roster ships EMPTY
   (`models: []` — no auth on the dev machine to verify ids); widen it only with a
   real CLI spike, not from training data.

## What Phase 2 step 2 changed under you (`be07439`, contracts v1.2.1)

1. **The watcher has a five-state health machine** (starting/watching/degraded/down/
   stopped; `WatcherState`/`WatcherHealth` in `git-types.ts`) emitted via an optional
   `onHealthChange` dep and broadcast as `approvals:watcher-health`, with
   `approvals:watcher-status` (pull) and `approvals:watcher-retry` (manual restart,
   resets the backoff cap). All three silent death paths are hardened; `start()` races
   ready vs error vs a 30s timeout (injectable for tests) and THROWS on failure —
   vault init can no longer hang on a dead watcher.
2. **`restartWatcher` in `ipc/git.ts` is generation-guarded.** A module-level
   `watcherGeneration` counter bumps at `stopApprovals` / `initApprovalsForRoot` /
   `restartWatcher` entry; an in-flight restart that discovers the generation moved
   aborts with `watcher-restart-superseded` and retires its own just-built watcher.
   **Step 3 edits this file — respect the guard**: any new await-bearing path that
   rebuilds or rebinds the watcher must revalidate generation + root after each await,
   and stale watcher instances must not emit health. Same-root restarts NEVER call
   `getApprovalQueue().clear()` (mutation-tested); the clear stays in
   `initApprovalsForRoot` and is load-bearing for workspace switches.
3. **Turn tagging did NOT widen `TurnStartedOpts`** (recorded deviation): the registry
   takes a late-bound `setGateHealthProbe` (same pattern as `setPtyAliveProbe`), and
   `CliTurn.gateDegradedAtStart` flows into `PendingChangeFlags.gateDegraded` → queue
   merge → tray chip. The spawner was deliberately left untouched for step 3.
4. **Degraded UX**: tray warning dot (shows even at zero pending) + banner with the
   contract's honest copy + Retry; `WatcherHealthChip.tsx` holds the thread-header chip
   and the one-time inline notice (latch = inFlight∧unhealthy, a recorded superset of
   turn-start-unhealthy). ThreadPanel integration is three lines. Policy is OQ6:
   visibly degrade, NEVER block turns.
5. **`e2e/watcher-health.spec.ts` is the built-app probe and it has been executed
   green** (healthy boot → `watching`; chmod-000 subdir fixture → workspace live,
   state `down`). It encodes an e2e lesson — see the new repo gotcha below.

## What Phase 2 step 3 changed under you (`4047d35`, contracts v1.2.2)

1. **The attribution authority is `HarnessRunRegistry`**
   (`src/main/services/harness-run-registry.ts`, singleton via
   `getHarnessRunRegistry()`): write-once threadId→slug bindings persisted at
   `userData/harness-bindings.json` (key = workspaceRoot + NUL + threadId; a reserved
   budgets field is step 6's trust anchor). Bindings are minted ONLY inside
   `harness:run` (`harness-run.ts:composeHarnessRun`) after main's own validation:
   slug format + reserved-slug refusal (adapter identities like `cli-claude` can
   never be harness slugs — create/run/backfill all refuse), the v1.1.5
   realpath-equality re-check (residual #1 discharged), all four harness files
   readable, SAFE_ID threadId. Frontmatter `agent_id` is DISPLAY-ONLY now
   (thread-md.ts comments updated) — do not reintroduce it as an attribution source.
2. **Every forwarded agentId is validated at the IPC boundary**
   (`resolveRequestedAgentId` in `ipc/cli-thread.ts`, both spawn and input) with
   degrade-not-fail semantics: malformed / unbound-thread / binding-mismatch /
   registry-error ⇒ adapter identity + `cli-agent:attribution-mismatch` audit
   (decision `denied`, mismatches carry `boundSlug`) + `attributionSuspect`, flowing
   turnStarted → ActiveTurnMatch → PendingChangeFlags → tray chip. A degraded
   resolution also CLEARS any stale in-session slug in the spawner. The turn always
   proceeds — a throwing registry (e.g. one malformed file in the watcher-ignored
   threads dir; that DoS was a caught review blocker) degrades instead of rejecting,
   via the tolerant per-file thread scan (`listThreadAgentIdsTolerant`).
3. **Legacy threads got a one-time trust-on-upgrade backfill** per workspace root
   (persistent `backfilledRoots` marker; each minted binding audited
   `cli-agent:binding-backfill`). One-time is load-bearing: re-running per open
   would re-trust tampered frontmatter after every relaunch. After the epoch, ANY
   forwarded agentId on an unbound thread flags.
4. **The renderer run sequence changed** (`store/harness-run.ts`): createThread
   WITHOUT agentId → `harness:run { slug, threadId }` → on ok
   `setThreadAgentId(id, slug)` (the one sanctioned thread-store addition) → the
   unchanged shell-prompt wait → send main's prompt. Refusals AND thrown rejections
   delete the just-created thread (net "no thread created"). The send stays
   renderer-side — moving it into main re-opens the Phase-1 step-6 lost-reply
   failure.
5. **`HarnessIdentityChip`** on CLI thread headers shows the MAIN-sourced binding via
   the new `harness:binding` read channel; the thread's `agentId` prop is only the
   null→bound re-fetch trigger (the displayed value never comes from frontmatter).
6. **Known accepted residuals**: orphan bindings for deleted threads (revert
   validation is trailer-based, so harmless); a user-level agent can reach userData
   (same class as trailer forgery — accident containment, not a boundary); the
   selection-time PTY spawn does not forward agentId (input does, and input is where
   turns open — observed in the probe, attribution unaffected).
7. **Step 5 is unblocked**: `git:revert-agent` validation is trailer enumeration
   (unknown ⇒ `no-commits-for-agent`, test-pinned) — safe under a one-click UI.

## What Phase 2 step 4 changed under you (`61f8ce3`, contracts v1.2.3)

1. **The renderer `cli-session-store` is the SINGLE sessionId authority**
   (`src/renderer/src/store/cli-session-store.ts`): seeded from the
   `cli-thread:spawn` response (`agent-transport.start` now keeps the sessionId it
   used to drop), updated by the new `cli-thread:session-changed` event (fired on
   the spawn-on-demand respawn path inside `input()`), pull-hydrated by
   `cli-thread:get-session` (`{ sessionId, live } | null`). The bridge's
   `metadata.sessionId` path still exists and must NEVER feed the store. Known
   record-only race: `hydrate()` can overwrite a fresher session-changed binding
   with a stale pull snapshot — fails toward the dead state, never a respawn.
2. **The dead-PTY no-respawn rule is a contract point enforced at BOTH layers**
   (contracts §4 v1.2.3). Adapter: `TerminalDockAdapter` `projection="agent"` is
   reattach-only — no session ⇒ read-only dead state, no webview mounted, and
   cwd/vaultPath are OMITTED from the webview URL. Guest: the `reattachOnly` URL
   param (pure builders in `terminal-webview-src.ts`, names in sync with
   `TerminalApp.readUrlParams`) makes the connect decision skip the
   `terminal:create` fallback and report `session-dead`. The decision logic was
   EXTRACTED to pure `src/renderer/terminal-webview/connect-session.ts` so the
   no-create assertion is behavioral. Plain terminals keep their stale-session
   respawn — the rule is agent-projections-only.
3. **ThreadPanel header has the projection toggle**; a PTY that exits UNDER a live
   raw view also dead-states (not just stale-at-mount). Raw-view keystrokes are
   attributed to the thread's turn windows — the interactive-input residual is
   documented in §4, same trust level as the dock terminal; block-protocol
   integrity under interleaved human input is test-pinned at line boundaries
   (mid-byte-stream echo splitting a JSONL record is a known fidelity limit).
4. **`TerminalApp.tsx` carries a guest-window-scoped `window.__terminalText()`
   test hook** (post-merge fix): xterm renders to a WebGL canvas with no text DOM,
   and this is the only way the e2e probe can observe ring-buffer replay. Guest
   scope only, no user-facing behavior — do not remove it without replacing the
   probe's replay evidence.
5. **e2e boot-seeding is race-prone — use the boot-settle guard.** Seeding
   `lastWorkspacePath` then reloading races the app's first-boot null-write when
   the SHARED electron-store carries a stale path (this transiently broke
   watcher-health on the first merged run). All three built-app spec helpers now
   wait for the initial boot to settle (app shell OR FirstRunScreen) before
   seeding; new specs must do the same. The PID evidence pattern for PTYs is
   `lsof -a -d cwd` (PTY shells have an EMPTY argv — `pgrep -f <path>` matches
   nothing), and the projection probe REQUIRES an installed `claude` binary (it
   executes one real `--print` echo turn).

## What Phase 2 step 7 changed under you (`065d312`, contracts v1.2.4)

1. **The linter is a two-layer composition, and main is the run-time authority.**
   Pure content lints in `src/shared/harness-lint.ts` (`lintHarness(files) →
Diagnostic[]`, renderer-importable; `Diagnostic` is exactly `{ severity, code,
message, file }` with two severities — resist taxonomy creep) composed with
   main-side fs lints in `harness-service.ts` (`inspectHarness`: presence, verify.sh
   mode drift masked `0o7777`, handoffs/ presence, symlink-ancestry realpath). Main
   never reimplements a shared check. **`composeHarnessRun` re-runs the lint
   composition at run time and refuses on any error-severity diagnostic** (post-merge
   fix; closes the palette-snapshot TOCTOU) — the palette grey/disable is
   defense-in-depth, not the boundary.
2. **`listHarnesses` surfaces instead of hiding**: summaries carry `diagnostics` and
   `adapter: HarnessAdapter | null`; malformed harnesses render greyed with the first
   error's reason, run disabled — never vanished. A failed ancestry check returns
   ONLY the `symlink-ancestry` error with NO content read through the link (name
   falls back to slug) — outside-workspace content must never reach the palette.
   Error codes that disable run: scope-protected-globs, scope-unparseable,
   `scope-fields` (gutted goal/acceptance/rollback), frontmatter-invalid,
   file-missing, symlink-ancestry, `reserved-slug` (hand-created adapter-identity
   dir). `<dir>` placeholder leakage and verify.sh mode drift are warnings
   (containment rationale in the v1.2.4 entry).
3. **`harness:lint`** (on-demand re-lint, `[]` with no workspace) appended to §6;
   `harness-store.ts` needed no textual change (diagnostics ride the widened
   summary); `runHarness` re-checks defensively before creating a thread.
4. **Step 6 lands on top of this**: restructure `listHarnesses` around the
   `inspectHarness` composition — do not resurrect the pre-step-7 skip-not-throw
   shape. v1.1.5 residual #2 (symlink ancestry) is DISCHARGED; recorded residuals
   that are NOT covered: file-level symlinks inside a harness dir (hand-created;
   in-app creation is watcher-auto-rejected), dangling agents-dir symlink ⇒ silent
   `[]`, and the run-time lint reading real fs even when `deps.fs` is injected.

## What Phase 2 step 5 changed under you (`5b1589d`, contracts v1.2.5)

Includes the v1.2.7 hardening (`c1b21c8`) facts that belong to this surface.

1. **`listAgentCommits` is the read-only twin of `revertAgent`** — the trailer
   log-walk was factored into ONE shared reader (`readTrailerLog` in
   `git-service.ts`), so enumeration and revert see identical commits and
   identical `Machina-Reverts` exclusions. Ids are trailer-enumerated, never
   registry-checked: commits from a since-deleted harness (or an
   adapter-identity fallback) stay listed and revertable. v1.2.7: a failed
   git-log walk returns null and `git:list-agent-commits` answers
   `{ ok:false, reason:'git-failed' }` — the "never a false empty" rule covers
   git failures too; `RevertAgentSection` renders an honest error state, never
   "no unreverted agent commits" on a failed walk.
2. **`readTrailerLog` is injection-proof by field validation** (v1.2.7):
   exclusion-set tokens must be full 40-hex shas (`FULL_SHA_RE`), listed agent
   ids must pass `SAFE_ID_RE`, and the Machina-Reverts field precedes the agent
   field so a `\x1f` smuggled into a forged trailer value can only push content
   AWAY from the exclusion set. Pre-fix, a forged trailer could permanently
   immunize attacker-chosen shas against listing AND revert.
3. **`revertAgent` pathspec-limits its final commit** to the reverted paths
   (v1.2.7, the `commitApproved` discipline): independently user-staged
   bystander files stay staged and untouched — a bare commit after
   `git revert --no-commit` swept them in. `--allow-empty --only` keeps the
   net-zero and zero-paths marker-commit cases without sweeping the index.
4. **A tray revert during a live turn is gate machinery, not agent activity**
   (v1.2.7): `revertAgent` gained `onWillRevert(paths)` — fired with the union
   of to-be-touched paths BEFORE any tree change — and the `git:revert-agent`
   handler uses it to suppress the watcher's echo of the revert's own writes
   and to excuse the revert commit sha on every open turn window
   (`CliTurnRegistry.noteGateCommitForRoot`). Pre-fix, a revert during a
   writing turn tripped headMoved against the healthy agent and queued a bogus
   pending item.
5. **The UI keeps one confirm surface**: `RevertAgentSection` in the
   ApprovalsTray popover (collapsed by default, enumerates only when opened,
   per-agent rows with count + last subject/date, inline arm→confirm — not a
   modal — with the §4 containment copy: revert CREATES new commits, deletes no
   history, is not protection). Palette "Revert harness: <slug>" entries are
   gated on a non-empty commit list and never one-click revert: they dispatch
   the `te:revert-agent` CustomEvent and the tray opens with the confirm armed;
   `CommandPalette.tsx` fetches the snapshot on palette open (recorded
   deviation — the open-refresh pattern).
6. **Convention change that sticks for parallel landings**: §8 changelog
   entries now go at the TOP (reverse-chronological) — the 4∥7 append-at-end
   rule caused avoidable churn; keep top-inserting.

## What Phase 2 step 6 changed under you (`24d53e1`, contracts v1.2.6)

Includes the v1.2.7 hardening (`c1b21c8`) facts that belong to this surface.

1. **Budgets are real now.** `maxWritesPerMinute` is the per-THREAD limiter
   threshold sourced from the budgets snapshot taken at bind time
   (`HarnessBinding.budgets` — the step-3 reserved field — persisted in the
   userData mirror; write-once covers the snapshot, so post-bind SKILL.md edits
   affect the NEXT run only; SKILL.md frontmatter is the named tamper channel,
   widening `HARNESS_PROTECTED_GLOBS` to cover it was rejected). `maxTurns` =
   CLI invocations per thread counted at `CliTurnRegistry.turnStarted` (OQ2),
   in-memory per app run and surviving `threadClosed` so a kill never refills
   the budget. Backfilled legacy bindings carry NO budgets — default threshold,
   no maxTurns enforcement.
2. **The bindings mirror is guaranteed loaded on every turn open** (v1.2.7):
   the turn-start listener awaits `HarnessRunRegistry.ensureRootReady(cwd)`
   before the budget lookup (still deferred past the in-flight send; registry
   errors degrade to unbound — never a blocked turn), and
   `initApprovalsForRoot` loads the mirror before the watcher starts so the
   synchronous `getWriteBudget` reads are covered. Pre-fix, budgets silently
   disengaged on the no-agentId-forwarded path after relaunch.
3. **`AgentCircuitBreaker`** (`agent-circuit-breaker.ts`, types in the new
   `agent-breaker-types.ts`) escalates advisory signals to EXACTLY ONE hard
   kill per episode (late-bound `spawner.close` callback, per-thread latch,
   reset on the thread's next turn) + audit + the `agent:breaker-tripped`
   event. Kill-class signals: velocity (3 CONSECUTIVE limiter-exceeded batches,
   never one), 3 forbidden autoRejects per turn, maxTurns breach. Negative
   rules are contract points: never trip on watcher-degraded state alone
   (health feeds only `signalsDegraded` honesty — and the v1.2.7 companion
   positive pins that threshold signals under an UNHEALTHY gate still trip),
   and never auto-kill on `concurrentTurns`-flagged signals (tray notice
   instead).
4. **Bare headMoved is notice-latch, NOT kill** (v1.2.7 — ORCHESTRATOR
   DECISION, recorded as such and cheaply reversible): the user's own
   `git commit`/`pull`/`checkout` during a writing turn is indistinguishable
   from agent git activity, so a first headMoved produces notice + audit + tray
   row; the episode escalates to its single kill only on a later unambiguous
   kill-class signal. The step-3 audit/flag path is unchanged; named negative
   test: single window, unexcused HEAD move, NO kill. If a later owner wants
   headMoved to kill again, that is a one-line revert plus a corroboration
   rule.
5. **Turn attribution is PATH identity, not string identity** (v1.2.7 — the
   biggest find of the landing; root cause of the velocity-breaker e2e
   failure): `CliTurnRegistry.isInside` realpath-canonicalizes BOTH sides
   (memoized) before comparing. The watcher roots at the canonical workspace
   path (WorkspaceService realpaths: `/var/...` → `/private/var/...` on macOS)
   but the per-turn cwd arrives from the caller verbatim — a symlink-aliased
   workspace root used to silently detach every turn window from the watcher
   root, routing ALL agent writes to "outside any turn window": no queue
   capture, no velocity/forbidden signals, no breaker coverage — the whole
   containment gate disengaged without a trace outside the audit log. The same
   rule applies to `noteGateCommitForRoot`, so revert-sha excusal reaches
   alias-cwd windows. `e2e/agent-breaker.spec.ts` deliberately keeps an
   un-realpathed tmpdir root as the standing regression probe — do not "fix"
   it. (Its dead-PTY predicate was also repaired: `spawner.close` unbinds the
   session, so a null get-session IS the dead state; the old `?.live ?? true`
   coercion could never observe a kill.)
6. **The kill switch lives in the ThreadPanel header** (recorded deviation —
   the spec offered ThreadInputBar or header; Stop/interrupt and Kill/hard-stop
   stay visually distinct and ThreadInputBar is untouched), surfacing the
   existing hard-kill path (`agent-breaker-kill-switch.tsx` →
   `cli-thread:close`). The tray gains mount-only breaker notice rows
   (`agent-breaker-notice.tsx`). The maxTurns kill wiring is pinned
   BEHAVIORALLY through the real `registerCliThreadIpc` registration path
   against a real persisted mirror (mutation-verified, v1.2.7) — the mock-only
   pin was a review finding.
7. **Post-kill flush-window writes become audited-unattributed** (writes
   flushing within the ~300ms awaitWriteFinish window after `spawner.close`;
   the zero-linger `threadClosed` trade) — documented and tested, not silent.
8. **The OQ8 workspace-switch visibility graft is EXCLUDED by design** — not
   ratified by Casey as of 2026-07-07; the spec marks it severable, step 6
   landed green without it, and the graft becomes its own small follow-up
   commit after the call.

## Chat-output quality pass (`fb7e17c`) — same landing window

Not a workstation step; touched only the thread/message rendering surface.
`ThinkingIndicator.tsx` (mounts via `InflightAssistant`'s `inFlight` prop),
`scanSecrets` masking over CLI output/tool pills/error cards via
`tool-renderers/mask-secrets.ts` (copy follows display; per-card reveal), honest tool
status (ok / failed / observed / pending / not run), `closeSession` synthesizes a
final message on PTY death (stale inFlight cleared), degraded-parse gate stops
truncated JSONL fabricating tool pills, non-AUTH native errors are system messages
now, and ThreadMessage keys are thread-scoped. **Known residuals for a later pass**
(recorded, not blocking): the interim-stream → final-markdown reflow "pop" in
`InflightAssistant`, and streamed-CLI finals dropping bridge metadata
(`use-thread-streaming.ts` finalize path rebuilds the message).

Repo gotchas the step-1 team hit (they will bite you too):

- **CLAUDE.md is gitignored in this repo; AGENTS.md is now deliberately curated.**
  Casey changed the policy on 2026-07-09: `CLAUDE.md` remains the fuller reference,
  while tracked `AGENTS.md` carries only the instructions Codex needs. They are no
  longer byte-identical. `npm run sync:agents` is a no-op guard; update `AGENTS.md`
  intentionally when a Codex-relevant rule changes instead of regenerating it.
- **The e2e suite was stale-red on main before step 1** (6 of 18 failing at `bc86377`):
  it predated the titlebar Files toggle (the file tree lives in a right-edge side panel,
  closed by default — helpers `openFilesPanel`/`closeFilesPanel` in `e2e/app.spec.ts`
  handle it), the FirstRunScreen (no-workspace boot shows an Open Folder CTA, not an
  empty shell), and the settings-modal redesign (flat rows, no "Environment" page).
  Step 1 repaired those. The window-drag test is `test.fixme` against the known-open
  titlebar drag-region product issue — un-fixme it only when that is fixed.
- **e2e runs dirty `e2e/fixtures/test-vault/.machina/state.json`** (the app persists
  state into the fixture). `git restore` it before committing.
- **`page.evaluate` dies across the boot-time `location.reload()`** in e2e probes
  ("Execution context was destroyed"). Locator waits span navigations; evaluate does
  not. Pattern: after seeding the workspace and reloading, wait on an app-mounted
  locator (e.g. the approvals tray button) BEFORE any evaluate-based polling, and wrap
  polled evaluates in try/catch returning a retry sentinel. `watcher-health.spec.ts`
  is the working template — the step-2 gate hit this live.
- **Non-packaged runs (e2e, dev, Playwright probes) share
  `~/Library/Application Support/Electron/`** for electron-store + localStorage. Test
  pollution persists across runs; move the dir aside if you need a clean boot.
- Electron visual verification stays with Casey, but scripted Playwright probes against
  `out/main/index.js` (launch, seed config, reload, assert) are the sanctioned
  Claude-driven smoke path — step 1's probes are a working template.

## The five things that will bite you if you skip the docs

1. **The gate is post-persistence containment, not prevention.** CLI-agent writes are
   live on disk before anyone reviews them. Approve blesses into history; Reject reverts
   via git. UI copy and your own mental model must never claim writes are blocked. The
   agent is a full shell — it can run git itself; we detect (headMoved tripwire), we do
   not prevent. Adapter-native permission hooks were DEFERRED out of Phase 2 (OQ1,
   recorded in 04-phase-2-specs.md) — containment stays post-persistence all phase; a
   reserved `AgentAdapter` capability field keeps the future seam cheap.
2. **Never let rollback coverage gap.** DISCHARGED 2026-07-06: step 5's G1–G8 evidence
   gate passed on fresh runs (G6 included) and the snapshot was retired in the same
   step — coverage never gapped. The rule's spirit survives: rollback is now the
   approvals gate exclusively; do not weaken it without an equivalent evidence gate.
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
  the same commit. `CLAUDE.md` is the fuller reference and `AGENTS.md` is the tracked,
  Codex-scoped instruction file; update each intentionally when its audience needs the
  change. `npm run sync:agents` never overwrites the curated file.
- Dev-app/DevTools smoke checks are driven by the agent, not handed to Casey as steps.
  Electron visual verification is Casey observing the running app — no programmatic
  Electron screenshots. The step 4 dock↔canvas migration acceptance (tick-counter
  continuity) explicitly needs Casey watching.
- Surgical scope: every changed line traces to the step's spec. Files under 800 lines
  (thread-store.ts is at 1009 as of 2026-07-14 — the "route around it" mitigation
  failed twice; Phase 3 step 3 extracts a dock-store to get under the cap, and no
  other step may grow it).

## Definition of done for Phase 1 — **MET (2026-07-06, Casey-confirmed)**

The tracer bullet, on a real repo, in one sitting: open repo → spawn terminal → create
test-fixer harness → run it → watch the turn in the tray → approve the diff → see the
`Machina-Agent: test-fixer` trailer commit → `revertAgent` cleanly undoes it. All
invariants in PLAN.md hold at every step boundary.

**Tracer-bullet run record**: Casey ran the full path manually on the running dev app
(2026-07-06), on a real repo with a deliberately broken test: palette create (six
entries, verify.sh 0555, duplicate-create refused), palette run (cli-claude thread
fixed the failing test), tray approve, `Machina-Agent: test-fixer` +
`Machina-Session` trailers on the approved commit, then
`window.api.git.revertAgent('test-fixer')` from the DevTools console returned
`ok: true` and produced a `Machina-Reverts` commit restoring the pre-agent tree.
All checks reported good. (revertAgent still has no UI affordance — console/IPC only;
candidate Phase-2 surface.) This confirmation followed the earlier automated
transcripts (step-6 smoke 11/11; step-5 P1/P2 in `03-snapshot-retirement-evidence.md`).

## Machinery you inherit (verified working, don't rebuild)

PTY core with ring-buffer reconnect (`terminal:reconnect` already exists — migration is
a renderer affordance), block protocol (OSC hooks → BlockDetector → BlockWatcher),
safety trio (`hitl-gate.ts` / `audit-logger.ts` / `path-guard.ts`), typed-IPC 4-step
pattern, `ShellService.create` already takes per-session cwd, `ThreadStorage` already
takes its root. (The pre-run snapshot listed here historically was retired by step 5 —
rollback is the approvals gate.) The full reuse map
with import-graph evidence is in 00-seam-audit.md §1.

## Known follow-ups from the step 1 review (dual review: Claude adversarial + Codex cold-read)

- **FilesDockAdapter vault switching bypasses `workspace.open()` — FIXED on disk**
  (verified 2026-07-14 during the Phase 3 spec pass): `handleOpenVaultPicker` /
  `handleSelectVault` now dispatch `te:open-vault` → `orchestrateLoad` →
  `workspace.open()`, the one full-switch path, with the step-1 review finding named
  in the comment (`dock-adapters/FilesDockAdapter.tsx:306-325`). No action remains;
  recorded here so nobody re-fixes it.
- `WorkspaceService.open()` re-entrancy was flagged in the same review and is FIXED on
  main (serialized open chain, last caller wins; regression tests in the
  workspace-service suite). No action needed — noted so nobody re-litigates it.

## Open items deliberately left for later phases

Loop scheduler + per-slug budget aggregation + max-$ budget (Phase 3), LSP + git map
(Phase 4), adapter-native permission hooks (OQ1 deferral, reserved seam), worktree
isolation (only if parallel usage demands), renderer "workspace" filter-naming cleanup,
state.md knowledge-indexing, DocumentManager coordination for git discard, MCP gate
convergence onto QueueHitlGate. (Adapter registry + session-types landed as Phase 2
step 1.) The full residual lists with rationale: end of 02-phase-1-specs.md (Phase 1)
and "Deferred / accepted residuals" in 04-phase-2-specs.md (Phase 2).
