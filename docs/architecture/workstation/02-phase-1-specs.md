# Workstation Phase 1 — Implementation Specs (canonical order)

Distilled from a 6-designer + 4-verifier + completeness-critic workflow (2026-07-05, 11
agents, all findings absorbed or explicitly deferred). Each step is one grabbable unit of
work ending in a green `npm run check` and a main commit (repo convention: no feature
branches; full pre-commit gate). Contracts: `01-interface-contracts.md` v1.1. Every
file:line below was disk-verified at `7735644`/`ec6fa6d` — **re-verify with `rg` against
disk before editing**; steps land sequentially and move each other's code (and this repo
has used git skip-worktree bits: check `git ls-files -v` before trusting a silent Write).

Cross-step rules:

- Use the `TE_DIR` constant everywhere (`.machina-dev` in dev, `.machina` in prod/tests);
  a hardcoded `.machina` is a bug except inside `HARNESS_PROTECTED_GLOBS`.
- Any deliberate deviation from the contracts amends `01-interface-contracts.md` in the
  same commit (doc-sync rule; the contracts stay source of truth).
- `ipc-channels.ts` / `preload/index.ts` / `main/index.ts` are shared hotspots for every
  step: keep additions append-only within each file; item 1.9 is landed (constraint moot).
- Dev-app smoke checks are Claude-driven (Casey is not handed DevTools steps); Electron
  visual verification is by Casey observing — no programmatic Electron screenshots.

## Step 1 — Workspace generalization — **DONE** (`76d0699`, 2026-07-05)

Replace the vault singleton with `WorkspaceService`; open any folder; per-turn cwd from
the renderer; MCP aliases. No dependency on later steps. Shipped as specced with two
additions recorded in HANDOFF.md: the stale e2e suite was repaired to the current UI
(one `test.fixme` against the known-open titlebar drag issue), and no
`getActiveVaultRoot()` bridge exists — later steps resolve root via
`getWorkspaceService().current()`.

**New files:** `src/shared/workspace-types.ts` (WorkspaceId brand + constructor,
Workspace, WorkspaceCapability); `src/main/services/workspace-service.ts` — pure
`classifyCapabilities(evidence)` (knowledge iff md-outside-TE_DIR; coding iff .git or
root manifest; empty ⇒ `['knowledge']`), bounded evidence walk (depth 4, ~5000 entries,
skip TE_DIR/.git/node_modules/dot-dirs, stop at first hit), `open()` in load-bearing
order: canonicalize → **detect before scaffold** → `new PathGuard(root)` →
`fileService.initVault(root)` (unconditional; renderer readConfig/readState at
vault-store.ts:128-129 throws without it) → set current → sequential-await ready
callbacks → return; `getWorkspaceService()` lazy singleton; `src/main/ipc/workspace.ts`
(workspace:open/current handlers).

**Edits:** `filesystem.ts` — delete activePathGuard/activeVaultRoot/setActiveVault/
onVaultReady (sole consumer main/index.ts:415 rewired to
`getWorkspaceService().onReady(ws => reconfigureForVault(ws.root))`); `guardPath` reads
from the service, keeping the exact legacy before-init error message; `vault:init`
handler becomes the alias returning `ws.root`; shell:show-in-folder reads
`workspaceHistory`. `ipc-channels.ts` — workspace:open/current + **required `cwd` on
cli-thread:input**. `cli-thread.ts` — take cwd from the request, delete the
readAppConfigValue('lastVaultPath') read (line 28); the renderer already holds it
(`agent-transport.ts:104` sendTurn gains ctx.vaultPath → compile-enforced).
`config.ts` — `LEGACY_KEY_FALLBACKS = { lastWorkspacePath: 'lastVaultPath',
workspaceHistory: 'vaultHistory' }` with a `has()`-gated absent-only fallback (stored
null must NOT resurrect the legacy path — FirstRunScreen clears by writing null).
`App.tsx:190-203` (workspace.open + both keys), `FirstRunScreen.tsx:18,24,44`,
`FilesDockAdapter.tsx` (4 key sites). `mcp-server.ts` — loop each of the three vault
tool registrations over `['vault.X','workspace.X']`, the invoked name flowing into
wrapSpotlighting and gate.confirm; counts become 12 tools / 7 CLI-read-only; known
accepted gap: VaultQueryFacade's internal audit lines still say `vault.*`.
`mcp-lifecycle.ts` doc comment; `CLAUDE.md` MCP section (AGENTS.md via regeneration,
never hand-edited). `e2e/app.spec.ts:29,117` — pin to the new key.

**Tests:** new workspace-service suite (capability table; detection-before-scaffold
regression: open a .git+package.json folder twice ⇒ still `['coding']` after TE_DIR
exists; guard()-before-open throws; ready-callback order + rejection propagation); new
config-legacy-fallback suite (fallback, null-no-resurrect, writes-on-new-key-only); new
cli-thread-handlers suite (cwd forwarded, no config read); update mcp-server (9→12
sorted list, workspace.* envelope + gate name), mcp-cli (7 names), FirstRunScreen,
filesystem-shell-handlers (stub key).

**Exit:** `npm run check` + `npm run test:e2e` green; `rg 'lastVaultPath|vaultHistory'
src e2e` hits only the fallback map + its test; `rg 'setActiveVault|onVaultReady'` empty;
dev-smoke: existing vault loads unchanged; a coding repo opens, boots, and
`workspace.current()` shows `coding`.

## Step 2 — Git substrate (GitService + ApprovalQueue + channels)

Everything gate parity consumes, landed first so step 3 is purely producers. Queue is
functional but empty until step 3. Depends on step 1 only for
`WorkspaceService.current()` as root resolution (if landing before step 1 for any
reason, bridge via a `getActiveVaultRoot()` export from filesystem.ts).

**New:** `src/shared/git-types.ts` — the v1.1 §2/§4 shapes verbatim: GitFileState (5
states incl. untracked→'added', renamed+origPath), GitStatusResult { isRepo, entries },
CommitApprovedOpts, GitOpResult, PendingChange + PendingChangeFlags (full shape now;
step 3 populates flags), trailer constants (Machina-Agent / Machina-Session /
Machina-Reverts), `SAFE_ID_RE`. `src/main/services/git-service.ts` — **`git mv
vault-git.ts git-service.ts`** (history preserved), keep
isGitRepo/isAutoCommitOptedOut/commitPreAgentSnapshot byte-identical, add `runGit`
helper (execFileSync, GIT_TIMEOUT_MS, maxBuffer 10MB, never-throw), then: `headSha`;
`status` (porcelain v1 -z, --untracked-files=all); `diff` (tracked via `git diff HEAD`,
**untracked via `git diff --no-index /dev/null <path>`** catching the exit-1 stdout —
new agent files never review blind; unborn-HEAD and non-repo synthesize content diffs;
`DIFF_MAX_BYTES = 2_000_000` truncation); `commitApproved` (guards: SAFE_ID_RE on both
ids, relative non-dash in-root paths, nothing-to-commit; `Machina-` subject prefix
neutralized; **`git add -- <paths>` never `-A`**; pathspec-limited commit with both
trailers in one final `-m` paragraph; user-staged other files untouched); `revertAgent`
(`git log --format=%H%x1f%(trailers:key=Machina-Agent,valueonly)`, exact JS match,
sequential `revert --no-commit` newest-first, abort-on-conflict, one commit carrying
**Machina-Reverts**); `discard` (async; tracked → `git restore --source=HEAD --worktree
--staged`; untracked → injected removeFile, wired to `shell.trashItem` at the IPC layer
— recoverable deletion). Recorded decision: `<TE_DIR>/no-auto-commit` gates automatic
commits only. `src/main/services/approval-queue.ts` — Map keyed `pc_<turnId>` (one item
per turn, coalescing), `add/recordWrites`, `list`, `resolve(id, approve, message?)` with
the stale-diff recompute (mismatch ⇒ refresh item + `{ ok:false, reason:'stale-diff' }`),
approve → commitApproved when `isRepo` else acknowledge+audit `{ ok:true }`, reject →
discard (non-repo ⇒ `not-a-git-repo`, item retained), every resolve writes one
AuditEntry (existing shape; `tool:'approvals:resolve'`), `enqueueGateConfirm(opts,
30_000)` (auto-deny AND remove on timeout), notify callback. `src/main/ipc/git.ts` —
registerGitIpc + getApprovalQueue export; AuditLogger at `userData/audit` (outside the
watch root — no self-trigger); all six handlers root-resolved main-side.

**Edits:** ipc-channels (six channels + approvals:changed event per §6), preload (`git`,
`approvals` namespaces + `on.approvalsChanged`), main/index (registerGitIpc),
`cli-thread-spawner.ts` (import path → './git-service'; **per-turn snapshot in
`input()`**: `if (hasLiveSession) commitPreAgentSnapshot(cwd, threadId)` before send —
no double-snapshot on the spawn path), its test (mock path + per-turn case), `git mv
tests/main/vault-git.test.ts tests/main/git-service.test.ts`.

**Tests:** git-service suite on real temp repos — status 5-state mapping; untracked-file
diff non-empty (the load-bearing case); commitApproved trailer round-trip via
`%(trailers:key=Machina-Agent,valueonly)`, exact staging with a bystander dirty file AND
a user-staged file untouched, id/path guard rejections, subject-forgery neutralized;
revertAgent multi-agent isolation (A,A,B ⇒ revert A only), exact match (`fixer` ≠
`fixer-2`), no re-enumeration of reverts, conflict-abort leaves clean status; discard
tracked/untracked/mixed + non-repo no-op; approval-queue suite — add/list/resolve/audit,
stale-diff, unknown-change, non-repo approve-acknowledge.

**Exit:** `rg -n 'vault-git' src tests e2e` zero hits; check green; Claude-driven smoke:
`window.api.git.status()` on a dirtied repo, commitApproved → `git log -1 --format=%B`
shows both trailers, revertAgent restores; non-repo returns structured no-ops; snapshot
commits now count == turns sent (per-turn granularity evidence).

## Step 3 — Gate parity (attribution + watcher + queue UI)

The producers. Depends on steps 1–2.

**New:** `src/main/services/cli-turn-registry.ts` — Map<threadId, Turn { turnId
monotonic, agentId, cwd, headShaAtStart, startedAt, endedAt }> + sawTurnEnd set;
`turnStarted/turnEnded/threadClosed`; `activeTurnFor(root, now)` → most-recent turn whose
cwd is inside root and (open OR within **LINGER_MS=1500** of end), `concurrent` flag when
>1 qualify, **`degraded`** when no block event ever arrived for the thread
(DEGRADED_AFTER_MS=30_000) ⇒ PTY-alive attribution instead of silently attributing
nothing; injectable clock. `src/main/services/agent-write-watcher.ts` — own chokidar
instance, **own ignore policy per contracts §4 v1.1** (never vault-watcher's
DEFAULT_IGNORE_PATTERNS); chokidar opts mirror vault-watcher (awaitWriteFinish 300/100,
ignoreInitial, followSymlinks:false, atomic) + 50ms EventBatcher; pure
`partitionBatch(events, { isSelfWrite, turn, forbiddenMatcher })` → { selfWrites,
forbidden, attributed, unattributed } so tests avoid chokidar timing; self-writes via
injected `documentManager.hasPendingWrite` (add that small read-only seam to
document-manager.ts); unattributed → audit `cli-agent:unattributed-write`, never queued;
`HARNESS_PROTECTED_GLOBS` matches → `queue.autoReject` (immediate discard + audit;
non-repo keeps the item flagged `forbidden`); rest → `queue.recordWrites` with flags
(highVelocity via per-thread WriteRateLimiter, **headMoved when git-service.headSha ≠
turn.headShaAtStart** — the agent-ran-git tripwire, concurrentTurns, degradedAttribution).
`src/main/services/queue-hitl-gate.ts` — `QueueHitlGate implements HitlGate` delegating
to `enqueueGateConfirm` (proves the §4 convergence seam; unit-tested; NOT wired over the
MCP gate in production this step — flag in commit message). `src/main/ipc/approvals.ts`
merge into ipc/git.ts if cleaner — `initApprovalsForRoot(root)` called from
reconfigureForVault: stop old watcher, clear queue, start new at root.
`src/renderer/src/store/approvals-store.ts` + `ApprovalsTray.tsx` mounted in
AgentShell — badge + popover: agentId/threadId header, capped path list, diff block,
flag chips (No rollback / High-velocity / **History rewritten during turn** / Attribution
degraded / Concurrent turns / Forbidden path), Reject disabled when !revertible, honest
copy: *"These changes are already on disk. Approve records them as a commit; Reject
reverts files via git."* + root-only scope footer; knife-edge geometry, tokens only.

**Edits:** cli-thread-spawner — optional `registry` dep, `cwdByThread` map, turnStarted
on send (agentId = optional per-thread agentId, default identity — **the step 6 seam**:
accept an optional `agentId` on cli-thread:spawn/input, store per thread),
threadClosed on close. cli-agent-thread-bridge — optional `onTurnComplete(threadId)`
fired once per completed block; wired in ipc/shell.ts to `registry.turnEnded`.

**Tests:** registry (clock-injected: linger boundary 1400ms in / 1600ms out; degraded
mode attributes with zero block events; overlap ⇒ concurrent; threadClosed immediate),
partitionBatch table (self-write dropped; `.env` + `<TE_DIR>/agents/a/state.md`
attributed; `<TE_DIR>/state.json` + threads/ never queued; verify.sh/rules.md ⇒
forbidden; no-turn ⇒ unattributed), one real-chokidar integration case, queue flags
(headMoved), QueueHitlGate resolve/timeout-removes-item, spawner registry calls, bridge
onTurnComplete once-per-block, tray component (badge, disabled Reject, chips), store
(stale-diff ⇒ refresh + notice).

**Exit:** check green; Claude-driven smoke in a git-repo vault: agent turn creating a
new file ⇒ one PendingChange with non-empty diff; Reject ⇒ `git status --porcelain`
clean; Approve ⇒ trailer commit + 'allowed' NDJSON audit line; verify.sh touch during a
turn auto-rejected while state.json churn produces zero items; non-repo cwd ⇒ "No
rollback" flag + disabled Reject; **agent running `git commit` itself mid-turn ⇒
headMoved banner + audit entry**.

## Step 4 — Minimal dock IDE shell (parallel-safe after step 1)

Editor center and agent panel already exist (EditorPanel routes non-.md to
CodeFileEditor/CodeMirror 6; ThreadPanel is the agent panel) — the build is the terminal
strip, migration affordances, and file-open.

**New:** dock-types strip shapes (TerminalStripSession { tabId stable at spawn,
sessionId '' until webview reports, cwd }, TerminalStripState, DEFAULT);
`terminal-strip-store.ts` (spawn/bind/close-kills-PTY/detach-no-kill/attach/setActive/
collapse/height-clamp/seed/drop; stale persisted sessionIds respawn fresh at cwd via
bindSession overwrite); `TerminalStrip.tsx` (bottom strip in SurfaceDock: drag-resize,
tab row with basename(cwd) labels, [+] at workspace root, folder-picker spawn via
existing fs:select-vault, per-tab ContextMenu 'Move to canvas' disabled while
sessionId==''; visited sessions stay mounted display:none — SurfaceDock mountedIds
pattern); `terminal-webview-src.ts` pure URL builder; `terminal-migration.ts`
(strip→canvas: createCanvasNode('terminal', worldCenter, { content: sessionId, metadata:
{ initialCwd } }) + open canvas tab + detach; canvas→strip: attach + `removeNode(id, {
preserveSession: true })`).

**Edits:** thread-types `dockState.terminalStrip?` (thread-md round-trips wholesale —
legacy files decode with undefined); thread-store 3 surgical touches (seed on load,
flush on save, drop on delete — file is 825 lines, do not grow it otherwise);
TerminalDockAdapter (cwd param + ipc-message session-created/exited listeners — closes
the dock-terminal-never-learns-its-sessionId gap migration requires); canvas-store
`removeNode(id, { preserveSession? })`; TerminalCard 'Move to dock' header action;
SideDockRibbon 'New terminal'; palette (new-terminal, new-terminal-in-folder,
open-file-in-editor); keybindings ctrl+backquote; **fs:select-file** channel
(guard-checked, null outside root) + preload.

**Tests:** strip store suite, URL builder, TerminalStrip component, migration handlers
(no terminal.kill on detach — the load-bearing assertion), canvas-store preserveSession,
thread-md round-trip + legacy decode, keybinding, palette, fs:select-file guard.

**Exit:** check green; spawn-anywhere observed (`pwd` outside the vault); palette-opened
.ts file renders CodeMirror and autosaves through DocumentManager; **manual migration
acceptance (Casey observes, audit §4)**: `while true; do echo tick $((i++)); sleep 0.2;
done` in a strip terminal → Move to canvas → tick numbers consecutive across the
boundary → Move to dock → still consecutive → Ctrl+C + `echo ok` proves same PTY;
relaunch restores strips at persisted cwd; closed strip tab leaves no orphan shell (ps).

## Step 5 — Retire the pre-run snapshot (evidence gate first)

Part A: write `03-snapshot-retirement-evidence.md` with gate checklist **G1–G8** — each
item citing a passing test (file + name) or fresh manual transcript at current HEAD: G1
reject-restores (modified + created files), G2 approve-then-revertAgent equals pre-agent
tree, G3 trailer integrity, G4 exact staging (inverse of snapshot's add -A overreach),
G5 attribution quiescence (write inside the 300ms+batch lag at turn end still queued),
G6 **degraded-mode attribution with hooks absent** (the likely blocker — do not soften
it to unblock; a failing G6 means the snapshot stays), G7 dotpath coverage + no
self-trigger, G8 per-turn granularity (approve turn 1, reject turn 2, turn-1 commit
intact) — plus the parity ledger for cases neither mechanism ever covered (non-repo,
gitignored paths — `add -A` never staged those either, out-of-root, agent-runs-git).
Any unchecked item halts the step with the snapshot wired.

Part B (only after A passes): remove the spawn-site call + import and the step-2
per-turn call in `input()` (+ cwdByThread if orphaned) from cli-thread-spawner; delete
commitPreAgentSnapshot/PreAgentCommitResult from git-service.ts (keep
isGitRepo/isAutoCommitOptedOut iff production importers remain — rg-decide); delete the
spawner snapshot test + the commitPreAgentSnapshot describe. Doc-reconciliation in the
same commit: safety-subsystem.md:61,:99, overview.md:108, CLAUDE.md agents bullet
(AGENTS.md regenerated), 01-contracts §2/§4 dated status line.

**Exit:** evidence doc committed with all G-boxes checked against fresh runs; `rg -n
commitPreAgentSnapshot src tests` zero; check + build green; a real-repo session log
shows zero 'pre-agent snapshot' commits with reject/approve/revert all exercised.

## Step 6 — test-fixer harness template

**New:** `src/shared/harness-types.ts` (HarnessAdapter/identityForAdapter,
HarnessFrontmatter + Result-typed parser, HarnessScope, **HARNESS_PROTECTED_GLOBS with
both `.machina` and `.machina-dev` variants**, validateHarnessScope superset check =
the refuse-to-emit invariant, slug regex `/^[a-z0-9][a-z0-9-]{0,40}$/` — no traversal,
HarnessSummary, pure `buildHarnessPrompt`); `harness-templates.ts` (single 'test-fixer'
entry: contracts §5 frontmatter defaults verbatim; numbered skillBody procedure;
severity-tagged rules; scope with allowedGlobs `['src/**','tests/**',
'<dir>/state.md','<dir>/handoffs/**']`, forbiddenGlobs = PROTECTED + `.git/**` +
`.env*`; verify.sh `#!/bin/sh` cd-to-root + `npm test`; initialState);
`harness-service.ts` (create: validate slug → template → no-overwrite-ever →
validateHarnessScope aborts before any write → mkdir + write six entries → verify.sh
last + chmod 0o555 → cleanup partial dir on failure; list: skip-not-throw malformed);
`src/main/ipc/harness.ts` (root resolved main-side; null root ⇒ structured error);
preload `harness` namespace; `harness-store.ts` (palette needs sync state);
`harness-run.ts` — read the four files via one fs:readFilesBatch, strip frontmatter,
buildHarnessPrompt, `createThread('cli-claude', <model as AgentPicker passes>, slug)`,
appendUserMessage(prompt) — the existing adapter path, zero spawner/transport changes;
palette items (Create harness / Run harness per summary, refresh on palette open).

**Attribution seam (critic):** runHarness passes the slug as the thread's `agentId`;
thread-store forwards it on cli-thread:spawn/input (optional field from step 3);
CliTurnRegistry.turnStarted receives it ⇒ PendingChange.agentId ⇒ `Machina-Agent:
test-fixer` trailers ⇒ `revertAgent('test-fixer')` — the tracer bullet's per-agent
revert works end-to-end for harness runs and defaults to adapter identity for ad-hoc
threads.

**Tests:** harness-types (slug/scope/globs-dual-variant/prompt/identity), harness-service
(node env: six entries materialize under `<root>/.machina/agents/` [TE_DIR=.machina
under vitest], verify.sh mode 0o555 + shebang, scope superset, duplicate/invalid/unknown
⇒ structured errors with no dir, refuse-to-emit via mutated template, list round-trip),
harness-ipc (null root), harness-run (reads exactly four files; createThread cli-claude
titled by slug; prompt contains rules + verify instruction; read-failure creates no
thread).

**Exit:** check green; dev smoke: palette create ⇒ `ls -la
<vault>/.machina-dev/agents/test-fixer/` shows all six with verify.sh mode 555;
duplicate create surfaces the error, never overwrites; palette run ⇒ cli-claude thread
whose first message contains the composed harness prompt and receives a reply through
the stock `claude --print` invocation; a harness-run write lands in the approvals tray
attributed `test-fixer` and its approved commit carries the slug trailer.

## Tracer-bullet exit bar (Phase 1 done)

On a real repo (e.g. `strength-engine`), in one sitting: open the repo (step 1) → spawn
a terminal in it (step 4) → create the test-fixer harness (step 6) → run it, watch the
turn (steps 3/6) → approve the diff from the tray (steps 2/3) → see the
`Machina-Agent: test-fixer` commit and `revertAgent` cleanly undo it (step 2) — with
`npm run check` green and every safety invariant (PLAN.md) intact.

## Deferred / accepted residuals (do not silently re-litigate)

- Not a security boundary: self-commit / trailer forgery / reset --hard by the agent —
  detected (headMoved) not prevented; adapter-native hooks are Phase 2.
- TOCTOU narrowed by stale-diff, not closed (recompute→commit non-atomic).
- discard vs open dirty editor doc: rides the existing external-change/conflict flow; a
  racing autosave can resurrect rejected content — documented limitation, revisit with
  a registerExternalWrite-style seam for git ops.
- Concurrent agent threads in one root: flagged (`concurrentTurns`), not isolated —
  worktrees remain the Q11 answer if usage demands.
- TE_DIR app-state subpaths are a watcher blind spot by design; do not widen excludes.
- state.md indexing deferred (prompt-composition only in Phase 1).
- Legacy DockTab terminal tabs still leak PTYs on close (pre-existing; strip supersedes).
- Renderer "workspace" filter naming overload — schedule the rename.