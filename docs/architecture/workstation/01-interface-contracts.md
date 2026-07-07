# Workstation Phase 0 — Interface Contracts

Typed contracts for the Phase 1 tracer bullet, written before code per the workstation
plan. Companion to `00-seam-audit.md` (file:line evidence for every seam referenced here).
House conventions apply throughout: branded ids (`@shared/types`), `Result`-style
structured errors over throws, the 4-step IPC pattern (`AGENTS.md`), files under 800
lines.

## 1. Workspace service (main process)

Replaces the module-level singleton in `src/main/ipc/filesystem.ts:34-36`
(`activePathGuard` / `activeVaultRoot` / `onVaultReady`). Like-for-like: Phase 1 keeps
exactly one active workspace; multi-workspace is not in contract.

```ts
// src/shared/workspace-types.ts
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' }
export type WorkspaceCapability = 'knowledge' | 'coding'

export interface Workspace {
  readonly id: WorkspaceId
  /** Canonicalized root (symlinks resolved, NFC) — same rule as today's vault:init. */
  readonly root: string
  readonly capabilities: readonly WorkspaceCapability[]
}
```

```ts
// src/main/services/workspace-service.ts
export interface WorkspaceService {
  /** Canonicalize, detect capabilities, build PathGuard, fire ready callbacks. */
  open(path: string): Promise<Workspace>
  current(): Workspace | null
  /** The one PathGuard for the active workspace — same object every caller sees. */
  guard(): PathGuard
  /** Replaces filesystem.ts onVaultReady. */
  onReady(cb: (ws: Workspace) => void | Promise<void>): void
}
```

Capability detection (pure, unit-testable): `knowledge` when the root contains any `.md`
outside `<TE_DIR>/`; `coding` when the root contains `.git/` or a recognized manifest
(`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`); empty-evidence default =
`['knowledge']` (preserves first-run UX). **v1.1 correction:** the original "existing
`.machina/` config ⇒ knowledge" clause is dropped — `open()` scaffolds TE_DIR
unconditionally (the renderer load path hard-requires it), which made that clause
self-fulfilling: every once-opened coding repo would reclassify as knowledge on reopen.
Detection therefore runs **before** scaffold and never keys on TE_DIR contents. Both
capabilities may be true; the knowledge toggle (Q5/Q13) reads this. Revisit conditional
scaffolding when the renderer becomes capability-aware.

Migration: `vault:init` delegates to `WorkspaceService.open` and stays as an alias for one
release; config keys `lastVaultPath` → `lastWorkspacePath` **and `vaultHistory` →
`workspaceHistory`** (the history key is load-bearing: PathGuard bypass allowlist +
recent-vaults UI) with an absent-only read fallback — a stored `null` must NOT resurrect
the legacy value. PathGuard's API is untouched — only its construction moves. Naming note:
the renderer already uses "workspace" for the vault folder *filter*
(`vault-store.activeWorkspace`) — no compile collision, but the filter concept should be
renamed in a later cleanup; recorded so the overload is a decision, not an accident.

## 2. Git service (main process)

`src/main/services/vault-git.ts` grows into `git-service.ts`, keeping its style:
`execFileSync` with `GIT_TIMEOUT_MS`, structured no-op results, never throws across the
service boundary, `.machina/no-auto-commit` opt-out respected.

```ts
// src/shared/git-types.ts (types shared with the renderer; service impl in main)
export interface CommitApprovedOpts {
  readonly agentId: string // harness slug, or adapter id for ad-hoc threads; SAFE_ID_RE-validated
  readonly threadId: string
  readonly paths: readonly string[] // staged exactly via `git add -- <paths>`; never `add -A`
  readonly message: string // first line only; trailers appended by the service
}

export type GitOpResult =
  | { readonly ok: true; readonly sha?: string }
  | { readonly ok: false; readonly reason: string }

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed'
export interface GitStatusEntry { readonly path: string; readonly state: GitFileState; readonly origPath?: string }
/** isRepo lets the renderer surface "non-repo = no rollback protection" honestly. */
export interface GitStatusResult { readonly isRepo: boolean; readonly entries: readonly GitStatusEntry[] }

// src/main/services/git-service.ts (vault-git.ts grown via git mv, history preserved)
export interface GitService {
  isRepo(root: string): boolean
  headSha(root: string): string | null
  status(root: string): readonly GitStatusEntry[] // porcelain v1 -z; '??' → added
  /**
   * Review diff: tracked paths via `git diff HEAD`; untracked/new paths synthesized via
   * `git diff --no-index /dev/null <path>` so agent-CREATED files never review blind.
   */
  diff(root: string, paths?: readonly string[]): string
  commitApproved(root: string, opts: CommitApprovedOpts): GitOpResult
  /**
   * Enumerate commits via `git log --format=%H%x1f%(trailers:key=Machina-Agent,valueonly)`
   * with EXACT value match in JS (no --grep injection/prefix collisions); ONE sequencer
   * run (`revert --no-commit <newest..oldest>`) so a conflict OR a failed final commit
   * aborts the whole sequence cleanly; one revert commit whose Machina-Reverts trailer
   * VALUE is the space-separated reverted shas (v1.1.1 — the agentId alone cannot prevent
   * re-reverting, because the original commits keep their Machina-Agent trailers forever;
   * shas already listed in any Machina-Reverts trailer are excluded from later reverts).
   * The agentId stays readable in the revert commit subject.
   */
  revertAgent(root: string, agentId: string): GitOpResult
  /**
   * Reject flow. Tracked → `git restore --source=HEAD`; untracked → the INJECTED
   * removeFile callback (v1.1.1: required third parameter; the IPC layer binds
   * `shell.trashItem` so deletion stays recoverable — no non-recoverable default exists).
   * Fails closed: an ls-files failure returns git-failed rather than trashing tracked files.
   */
  discard(root: string, paths: readonly string[], removeFile: (absPath: string) => Promise<void>): Promise<GitOpResult>
}
```

Guards, all structured-error not throw: `SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/`
on agentId/threadId (blocks trailer forgery/format injection); paths must be relative,
non-`-`-leading, and resolve inside root **after following symlinks** (v1.1.1 — lexical
containment alone let `link/secret` under a symlinked directory escape the workspace);
every validated path reaches git pinned as a `:(literal)` pathspec (v1.1.1 — a bare `*`
or `:/` after `--` is still wildmatch/magic and would expand to the whole repo in
add/commit/restore/diff); a message first-line starting with `Machina-` is neutralized.
`diff` routes explicit paths on index/HEAD membership rather than porcelain status so
gitignored-but-present files still synthesize via `--no-index` (a write to an ignored
`.env` must never diff empty), and its `DIFF_MAX_BYTES` truncation marker embeds a sha256
of the full text so the queue's stale-diff comparison stays sound past the cutoff; a
failed diff yields a visible `[diff unavailable]` marker, never a silent empty string. `.machina/no-auto-commit` (TE_DIR-resolved) gates **automatic** commits only
(`commitPreAgentSnapshot`); commitApproved/revertAgent/discard are explicit user actions
and proceed regardless.

**Attribution is by commit trailers, not refs** — this is what the plan's "tagged commits"
resolves to:

```
fix: correct off-by-one in retry loop

Machina-Agent: test-fixer
Machina-Session: th_9f2c41aa
```

Trailers survive rebase, trailer enumeration finds one agent's commits for `revertAgent`,
and the tag/branch namespaces stay clean. Trailer attribution is review bookkeeping, **not
tamper-proof**: the CLI child is a full shell and can forge, strip, or self-commit — see
§4's security-boundary statement. `commitPreAgentSnapshot` (vault-git.ts:32) is unchanged
and remains wired at spawn until Phase 1 step 5 retires it. Interim hardening: also call
it per turn in `CliThreadSpawner.input()` — **not** `sendUserMessage`, which has no cwd
(adversarial correction) — to close the PTY-lifetime granularity gap found in audit §3.

**Status 2026-07-06 (step 5, v1.1.4):** `commitPreAgentSnapshot` is RETIRED — both call
sites (spawn + per-turn) removed after the G1–G8 evidence gate passed on fresh runs
(`03-snapshot-retirement-evidence.md`). The `<TE_DIR>/no-auto-commit` opt-out retired with
it: no automatic commits remain, so the paragraph above about its scope is historical.
`isAutoCommitOptedOut` is deleted from `git-service.ts`; `isGitRepo` and the §2 substrate
are unchanged.

## 3. Session, adapter, projection (shared types)

```ts
// src/shared/session-types.ts
export type AdapterId = 'claude' | 'codex' | 'gemini' | 'raw'

export interface WorkstationSession {
  readonly id: SessionId // existing branded type
  readonly cwd: string
  /** null = plain terminal; 'raw' = unknown agent CLI run as plain PTY (Q8). */
  readonly adapterId: AdapterId | null
  readonly threadId?: string // bound thread for adapter sessions
}

export interface AgentAdapter {
  readonly id: AdapterId
  /**
   * Absorbs formatCliInvocation (was cli-thread-spawner.ts:63-96). opts carries
   * resume/continue state, an optional pre-validated `model`, and — raw only —
   * the `invocationTemplate` (OQ3).
   */
  formatInvocation(prompt: string, opts: CliInvocationOptions): string
  /** Structured-event parser; absent = raw PTY projection (the BRIDGE contract — nuance below). */
  parseEvent?(line: string): AgentStreamEvent | null
  /** Spike-verified ids/aliases only. Absent (raw) = no model concept; empty (gemini) = none verifiable. */
  readonly models?: readonly string[]
  /** RESERVED — OQ1 deferral seam (§4). Phase 2 never sets or reads it. */
  readonly permissionHooks?: 'adapter-native'
}
```

**Phase scope (adversarial pass):** the adapter registry and `session-types.ts` are
**Phase 2**; Phase 1 keeps the `formatCliInvocation` switch as-is. The types above are the
target shape, not Phase 1 work. (Nuance recorded: gemini does have a heuristic parser
today — `geminiToolCallParser`, `cli-agent-parsers.ts` — but the bridge treats it as
non-structured; "absent parser = raw projection" describes the bridge contract, not the
file.) `CLI_AGENT_IDENTITIES` maps 1:1 onto `AdapterId` minus `raw`.

**Status 2026-07-06 (Phase 2 step 1, v1.2):** LANDED — the shapes above are code.
`src/shared/session-types.ts` carries them verbatim (plus the `CliInvocationOptions` and
`AgentStreamEvent` types they reference); `src/shared/agent-adapters.ts` (pure,
renderer-importable, like `cli-agents.ts`) exports `ADAPTERS: Record<AdapterId,
AgentAdapter>`. The spawner's `formatCliInvocation` switch and the bridge's
`extractClaudeEvent`/`extractCodexEvent` are deleted — both now dispatch through the
registry (the bridge routes on `parseEvent` presence via its `adapterForAgent` lookup).
What landed, point by point:

- **Name-collision cross-reference** (seam-map trap, recorded in the `session-types.ts`
  header): `src/shared/cli-agent-session-types.ts` is a different, unrelated module — the
  CLI-agent *presence* wire types for the external-process session listener (Move 8).
  `session-types.ts` types workstation terminal sessions and the adapter seam.
- **`formatInvocation(prompt, opts incl. model?)`**: pure, trusts its input — the model
  flag is emitted whenever `opts.model` is set. Validation lives at the IPC boundary
  (`resolveRequestedModel` in `src/main/ipc/cli-thread.ts`, backed by the shared
  `resolveModelPick`); see the v1.2 changelog entry for the full trust rule.
- **`raw` semantics (OQ3, recorded)**: the whole command line comes from a single-line
  template string carrying the literal `{prompt}` placeholder; the prompt is
  `singleQuote`-escaped into every occurrence; a missing, multiline, or placeholder-less
  template is a structured error. No parser, no resume, no models. In step 1 ad-hoc raw
  threads have no template source: picking raw spawns a plain PTY and the thread input
  surface disables sending with honest "no structured view" copy — harness-supplied
  templates arrive in step 8.
- **`permissionHooks` (OQ1, recorded)**: reserved optional capability field — the seam
  for adapter-native pre-write enforcement, deferred to a dedicated follow-on phase.
  Phase 2 never sets or reads it (§4).
- **Gemini nuance, restated**: the heuristic parser still exists in
  `cli-agent-parsers.ts`; "absent `parseEvent` = raw projection" is the *bridge*
  contract, not a claim about that file. Adapters without `parseEvent` (gemini, raw) get
  byte-for-byte plain PTY passthrough — the legacy `toolCallParser` path.
- **Identity mapping, superseded**: `AGENT_IDENTITIES` gained `'cli-raw'` (appended), so
  `CLI_AGENT_IDENTITIES` now maps 1:1 onto `AdapterId` *including* `raw`;
  `identityForAdapter` moved to `agent-adapters.ts` (re-exported by `harness-types.ts`).

**Projection** is not a new subsystem — it names the existing seam:

```ts
export interface SessionProjection {
  readonly sessionId: SessionId
  readonly surface: 'dock' | 'canvas'
}
```

Migration = `session-router.unregister` → new surface mounts → `terminal:reconnect`
(ipc-channels.ts:115) replays the ring buffer → `session-router.register` with the new
webContentsId. All three pieces exist (audit §4); Phase 1 only adds the renderer
affordance.

## 4. Gate parity for CLI agents (the load-bearing contract) — v1.1, post adversarial pass

CLI children write to disk directly (audit §3); in-process interception is impossible.
The gate is **post-persistence containment**: the write is live on disk (and visible to
open editors via the vault watcher) the moment the agent makes it. What the queue governs
is whether the write gets *blessed into history* (commit with trailers) or *reverted*.
Queue UI copy must say exactly this and never claim writes are blocked.

**This is not a security boundary.** The CLI child is a full shell at the user's
permission level: it can self-commit, `git reset --hard`, forge or strip trailers, chmod
files, or edit `.gitignore`. Phase 1 delivers accident containment + visibility; a
`headMoved` tripwire (HEAD captured at turn start vs turn end) detects crude history
rewrites and surfaces a banner + audit entry. Adapter-native permission hooks (Claude Code
`--permission-prompt-tool` routed into `HitlGate`) remain the future enforcement path,
**deferred out of Phase 2's step list to a dedicated follow-on** (OQ1, recorded at step 1,
v1.2): the reserved optional `AgentAdapter.permissionHooks` field (§3) is the seam; Phase 2
never sets or reads it, and containment stays post-persistence via the approvals queue.

```
CLI turn window (CliTurnRegistry — NEW primitive; the bridge tracks nothing per-thread)
  → AgentWriteWatcher attributes workspace-root fs events to the open turn
  → PendingChange (one per turn, coalesced; diff snapshot via GitService.diff)
  → approval queue (renderer tray)
      approve → GitService.commitApproved (trailers) → AuditLogger entry
                (non-repo: acknowledge + audit only — no commit possible)
      reject  → GitService.discard(paths)            → AuditLogger entry
                (non-repo: disabled, item flagged "no rollback")
```

```ts
// src/shared/git-types.ts
export interface PendingChangeFlags {
  readonly highVelocity: boolean //  WriteRateLimiter per thread
  readonly headMoved: boolean //     agent ran git itself during the turn
  readonly concurrentTurns: boolean // >1 turn window matched — ambiguous attribution
  readonly degradedAttribution: boolean // shell hooks absent; PTY-alive fallback window
  readonly gateDegraded: boolean //  turn opened while watcher state ∉ {watching} (v1.2.1)
  readonly forbidden: boolean //     touched a HARNESS_PROTECTED_GLOBS path
}
export interface PendingChange {
  readonly id: string // one per turn: pc_<turnId>, updated as writes land
  readonly kind: 'cli-change' | 'gate-confirm'
  readonly threadId: string
  readonly agentId: string
  readonly paths: readonly string[]
  readonly diff: string // snapshot at capture — the review artifact and stale-check baseline
  readonly capturedAt: string
  readonly revertible: boolean // false in non-repo workspaces
  readonly flags: PendingChangeFlags
  readonly description?: string
}
```

Contract points (each traceable to a verified finding):

- **Attribution = CliTurnRegistry**, a new main-process primitive (the earlier claim that
  `CliAgentThreadBridge` "already tracks this" was wrong — it holds no per-thread in-flight
  state; the renderer's flag is out of main's reach). Turn start = spawner sends the
  invocation; turn end = bridge block-completion callback, **plus a 1500ms linger** to
  cover the watcher's `awaitWriteFinish` 300ms + batch lag (writes in the last moments of
  a turn must not escape). **Degraded mode**: when shell hooks never emit block events
  (they require installed hooks), the window falls back to PTY-alive attribution with the
  `degradedAttribution` flag — silently attributing zero writes is the failure mode.
- **TOCTOU guard**: `resolve()` recomputes the diff; a mismatch with the reviewed snapshot
  returns `stale-diff`, refreshes the item, and forces re-review. Narrowed, not closed
  (recompute→commit is not atomic) — residual risk documented.
- **Workspace binding (v1.1.1)**: each item records the root it was captured against;
  `resolve()` in a different active workspace returns `workspace-changed` with the item
  retained (checked BEFORE the stale-diff recompute so the snapshot never refreshes
  against the wrong workspace's files). Failed approves/rejects (e.g. `git-failed`)
  also retain the item so the user can retry; only successful resolution (or the
  non-repo approve-acknowledge) removes it.
- **Watcher policy — its OWN ignore set, explicitly NOT vault-watcher's**
  (`DEFAULT_IGNORE_PATTERNS` ignores TE_DIR and every dotpath, which would blind the
  `verify.sh` auto-reject and all dotfile writes). Excluded: `.git`, `node_modules`,
  `dist/build/out`, and the app's own churn (`<TE_DIR>/state.json`, `threads/`,
  `artifacts/`, `embeddings/`). Watched: everything else **including dotfiles, `.env`,
  `.gitignore` itself, and `<TE_DIR>/agents/**`**. `.gitignore` is NOT honored — an agent
  write to an ignored `.env` must not be invisible (git can't diff/commit it, but the
  queue shows it). Self-writes suppressed via a `DocumentManager.hasPendingWrite` seam so
  user autosaves during a turn aren't misattributed (timing race accepted + documented).
- **Non-repo workspaces** (codex spawns with `--skip-git-repo-check`): the gate is
  visibility + audit only — approve acknowledges, reject is disabled, item carries the
  "no rollback" flag. Never render the queue as protection there.
- **Unattributed writes** (outside any turn window) are not queued; they get an audit
  entry (`cli-agent:unattributed-write`) so escapes are logged, not silent.
- **Gate reuse**: the queue is a `HitlGate` implementation (`QueueHitlGate implements
  HitlGate`, `hitl-gate.ts:22`), so native-agent and MCP writes can converge on the same
  queue UI later. `WriteRateLimiter` runs per thread → `highVelocity` flag.
- **Scope limits, stated honestly**: watching sees only the workspace root; out-of-root
  writes and the excluded TE_DIR app-state subpaths remain at the user's OS trust level —
  unchanged from today, documented in the queue UI footer.
- **Never-regress rule**: `commitPreAgentSnapshot` stays wired (spawn + per-turn) until
  approve/reject + `revertAgent` are proven on a real repo against the step 5 evidence
  checklist. No window where neither mechanism covers rollback.
  **Status 2026-07-06 (step 5, v1.1.4):** satisfied and closed — the G1–G8 evidence gate
  passed on fresh runs at the landing HEAD (`03-snapshot-retirement-evidence.md`, all
  boxes checked; parity ledger records the never-covered cases honestly), and the
  snapshot was retired in the same step. Rollback coverage never gapped.

### Watcher health (Phase 2 step 2, v1.2.1)

"Containment + visibility" with zero visibility into its own death is a
self-contradiction (honest-copy principle). The agent-write watcher carries a five-state
health machine, exposed over IPC (§6):

```ts
// src/shared/git-types.ts
export type WatcherState = 'starting' | 'watching' | 'degraded' | 'down' | 'stopped'
export interface WatcherHealth {
  readonly state: WatcherState
  readonly since: string // ISO 8601 — when this state was entered
  readonly attempts: number // restart attempts in the current backoff cycle
  readonly reason?: string // human-readable cause for degraded/down
}
```

- **States**: `starting` = initial scan in progress; `watching` = healthy; `degraded` =
  a batch/containment failure was caught (a `handleBatch` throw, a rejected
  `autoReject`) — events still flow but coverage is suspect, sticky until restart;
  `down` = the watcher is dead or never came up (post-ready chokidar `error`, ready
  timeout, init failure) — nothing is being captured; `stopped` = deliberate disarm
  (workspace switch / shutdown), not a failure and not warned on.
- **Hardened death paths** (all previously silent): chokidar `error` → audit
  (`cli-agent:watcher-failure`) + `down` (was console-only); a `handleBatch` throw →
  caught + audited + `degraded`, later batches keep processing (was an uncaught
  main-process exception via EventBatcher's timer, or a throw propagating into
  `stopApprovals` via the stop-time synchronous flush); the voided `autoReject`
  promise → `.catch` + audit + `degraded`; `start()` races ready vs error vs a 30s
  timeout and THROWS on failure (was an un-timed await that could hang vault init) —
  the init catch marks `down` while the workspace stays live.
- **Restart-preserves-queue rule**: same-root `restartWatcher()` (ipc/git.ts) is a
  watcher-only rebuild and must NOT call `getApprovalQueue().clear()` — a crash
  recovery that cleared the queue would silently drop captured-but-unreviewed writes.
  The clear-on-init in `initApprovalsForRoot` stays load-bearing for root-binding on
  workspace switch; the two paths are mutation-tested as genuinely separate.
- **Backoff**: automatic restarts at 1s/5s/30s (30s repeating), cap 5 failed attempts,
  then down-until-manual; the tray Retry (`approvals:watcher-retry`) resets the cap.
  A pending backoff timer is cancelled in `stopApprovals` (the reconfigureForVault
  race: a surviving timer would rearm a restart against a dead root). An already
  EXECUTING restart is guarded by a generation counter (bumped by `stopApprovals`,
  `initApprovalsForRoot`, and each `restartWatcher` entry): it revalidates after
  every await and aborts as `watcher-restart-superseded`, retiring any watcher it
  built — an in-flight restart overlapping a workspace switch or manual Retry can
  neither rebind the dead old root (orphaning the live watcher) nor flip a
  recovered `watching` state back to `down`. Health emissions from a superseded
  watcher instance are ignored.
- **Recovery audit entry**: closing a `down` window writes one
  `approvals:watcher-recovered` entry (decision `error`) recording
  `gapStartedAt`/`gapEndedAt` — escapes are logged, never silent. A fully-down watcher
  captures NO writes at all; this entry is the real evidence of the gap, and the flags
  below cannot be (nothing reached the queue to flag).
- **Turn-start policy (OQ6, recorded product decision)**: turns opened while state ∉
  {watching} are **visibly degraded, never blocked** — `CliTurnRegistry.turnStarted`
  tags `gateDegradedAtStart` via a late-bound gate-health probe, the flag surfaces as
  `gateDegraded` on the turn's queue item, and active CLI thread panels show a compact
  containment chip plus a one-time inline notice. UI copy never claims writes are
  blocked (they never were; right now they are not even captured).

**Flag taxonomy** (three near-synonyms, reconciled):

| Flag | Meaning | Set where |
| --- | --- | --- |
| `degradedAttribution` | shell hooks absent; PTY-alive window attribution | `CliTurnRegistry.windowState` per match |
| `gateDegraded` | turn opened while watcher state ∉ {watching} | `turnStarted` via the gate-health probe |
| `attributionSuspect` | agentId failed main-side binding validation | step 3 (reserved; not yet landed) |

## 5. Agent harness folder (on-disk schema)

```
<workspace>/.machina/agents/<slug>/
  SKILL.md      # portable definition; frontmatter carries config (below)
  rules.md      # machine-checkable rules, one per line item, severity-tagged
  scope.json    # per-task scope contract
  verify.sh     # deterministic verification gate — never agent-writable
  state.md      # repo memory; indexed by knowledge capability (Q13, zero extra wiring)
  handoffs/     # session handoff notes, markdown
```

`SKILL.md` frontmatter (Phase 1 uses template defaults; the Phase 2 wizard edits it):

```yaml
name: test-fixer
description: Runs the test suite, fixes the first failure, stops.
adapter: claude
permissionMode: queue-all-writes # immutable default (Q9)
budgets: { maxTurns: 10, maxWritesPerMinute: 10 }
```

`scope.json`: `{ goal, allowedGlobs, forbiddenGlobs, acceptance, rollback }` — the
curriculum 14.36 shape. `forbiddenGlobs` always contains `HARNESS_PROTECTED_GLOBS`
(verify.sh + rules.md under **both** `.machina/` and `.machina-dev/` — TE_DIR flips per
runtime, the on-disk contract must not); the harness generator refuses to emit a contract
without them, and `AgentWriteWatcher` auto-rejects (and audits) any pending change touching
`verify.sh` regardless of contract — reachable only because §4's watcher explicitly
include-lists `<TE_DIR>/agents/**`. `verify.sh` also ships mode `0o555` (defense-in-depth,
not a boundary — a same-user shell can chmod it back).

**Corrections (adversarial pass):** the "indexed by knowledge capability, zero extra
wiring" claim was false — vault-watcher ignores the whole TE_DIR subtree, so `state.md`
never reaches the index. Phase 1 repo memory is **prompt-composition only** (state.md is
read and injected into the agent prompt); indexing is deferred, with un-ignoring the
agents subtree as the future path. `scope.json` is advisory in Phase 1: nothing on the CLI
write path enforces globs — the watcher's auto-reject and the queue are the only teeth,
and UI copy must not imply more.

## 6. IPC channels (names reserved; registration follows the 4-step pattern)

New namespaces `workspace`, `git`, `approvals`, `harness` in `IpcChannels`/`IpcEvents`:

```ts
'workspace:open':        { request: { path: string }; response: Workspace }
'workspace:current':     { request: void; response: Workspace | null }
'git:status':            { request: void; response: GitStatusResult } // { isRepo, entries } — renderer must see non-repo
'git:diff':              { request: { paths?: string[] }; response: string }
'git:commit-approved':   { request: CommitApprovedOpts; response: GitOpResult }
'git:revert-agent':      { request: { agentId: string }; response: GitOpResult }
'fs:select-file':        { request: void; response: string | null } // editor-center open, guard-checked
'harness:create':        { request: { template: string; slug: string }
                           response: { ok: true; root: string } | { ok: false; error: string } } // Result-style: duplicate/invalid slug are expected failures
'harness:list':          { request: void; response: HarnessSummary[] }
'approvals:list':        { request: void; response: PendingChange[] }
'approvals:resolve':     { request: { id: string; approve: boolean; message?: string }; response: GitOpResult }
'approvals:watcher-status': { request: void; response: WatcherHealth } // v1.2.1 — pull mirror for late subscribers
'approvals:watcher-retry':  { request: void; response: GitOpResult }  // v1.2.1 — manual restart; resets the backoff cap
// IpcEvents
'approvals:changed':     { pending: number }
'approvals:watcher-health': WatcherHealth // v1.2.1 — health transitions (tray badge/banner, thread chip)
```

Git/harness channels take no `root` — main resolves it from `WorkspaceService.current()`
(interim bridge before step 1: a `getActiveVaultRoot()` export), so the renderer can never
point git or the generator at an arbitrary path.

**Sequencing constraint — resolved moot** (audit §5 correction): item 1.9 landed as
`4c126f2`, an ancestor of HEAD. Only ordinary rebase awareness against in-flight Wave 2/3
branches remains.

## 7. Phase 1 canonical order ↔ contract map — v1.1

Reordered after the adversarial pass: the original order had gate parity (old step 2)
consuming GitService/approvals artifacts assigned to old step 4 — the two specs
double-built the same files with contradictory shapes. Canonical order:

| Phase 1 step | Contracts consumed |
| --- | --- |
| 1 Workspace generalization | §1 (+ `vault.*`→`workspace.*` MCP aliases, audit §2) |
| 2 Git substrate | §2 full GitService + ApprovalQueue + §6 git/approvals channels (queue empty until step 3) |
| 3 Gate parity | §4 (CliTurnRegistry, AgentWriteWatcher, QueueHitlGate, tray) + §2 per-turn snapshot in `input()` |
| 4 Dock IDE shell | §3 projection (existing seam only; independent of 2–3, may land in parallel after 1) |
| 5 Retire snapshot | §2/§4 never-regress rule — evidence gate (G1–G8), no new interface |
| 6 test-fixer template | §5 folder schema + §6 harness channels + agentId(slug) → turn registry → trailers |

Implementation detail per step: `02-phase-1-specs.md`.

## 8. Contract changelog

- **v1.2.1 (2026-07-06, Phase 2 step 2 landing)** — §4 gains the watcher-health
  subsection: five-state machine (`WatcherState`/`WatcherHealth` in `git-types.ts`),
  the three silent death paths hardened (chokidar `error` → audit + down, was
  console-only at `agent-write-watcher.ts`; `handleBatch` wrapped in try/catch →
  `cli-agent:watcher-failure` audit + degraded + keep-processing, covering BOTH the
  EventBatcher setTimeout flush and the stop-time synchronous flush; the voided
  `autoReject` gains `.catch` → audit + degraded), and `start()` now races
  ready/error/30s-timeout and throws on failure (init catch in `main/index.ts` calls
  `markApprovalsWatcherDown`; workspace stays live). Restart-preserves-queue rule
  recorded and mutation-tested: `restartWatcher()` in `ipc/git.ts` rebuilds the
  watcher ONLY (never `getApprovalQueue().clear()`); backoff 1s/5s/30s, cap 5, then
  down-until-manual, pending timer cancelled in `stopApprovals`. Recovery closes with
  an `approvals:watcher-recovered` audit entry (gap window, decision `error`).
  Turn-start policy recorded (OQ6): visibly degrade, never block —
  `PendingChangeFlags.gateDegraded` + the §4 flag-taxonomy table
  (degradedAttribution / gateDegraded / attributionSuspect); `CliTurn` gains optional
  `gateDegradedAtStart` set by `turnStarted` via a late-bound `setGateHealthProbe`
  (deliberate deviation from widening `TurnStartedOpts`: the probe route keeps
  `cli-thread-spawner.ts` — step 3's surface — untouched and avoids an
  ipc/git↔registry import cycle). §6 gains `approvals:watcher-status`,
  `approvals:watcher-retry`, and the `approvals:watcher-health` event. UI: tray
  warning badge + honest banner ("Write containment is not watching…") + Retry;
  thread-surface containment chip + one-time inline notice on CLI panels (the notice
  latches on in-flight ∧ unhealthy, a deliberate superset of turn-START unhealthy: a
  watcher dying mid-turn is equally uncaptured). `degraded` is sticky until restart
  (recovery claims need a rebuilt watcher, not one lucky batch). Verification
  posture: real-chokidar integration test carries the death/recovery evidence;
  built-app probe (`e2e/watcher-health.spec.ts`) asserts only healthy-boot `watching`
  and unreadable-dir-fixture `down` with the workspace live.

- **v1.2 (2026-07-06, Phase 2 step 1 landing)** — §3 promoted from "Phase 2 target" to
  LANDED: `session-types.ts` plus the adapter registry (`agent-adapters.ts`, pure,
  renderer-importable) replace the spawner's `formatCliInvocation` switch and the
  bridge's extract functions; `AgentAdapter` gains spike-verified `models` rosters and
  the reserved optional `permissionHooks` field (OQ1 deferred to a dedicated follow-on —
  §4 amended accordingly; OQ3 raw template semantics recorded in §3).
  **Model-flag trust rule:** a flag is emitted ONLY for an explicit user pick passing
  BOTH membership in `adapter.models` AND a conservative charset regex
  (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`); absent, unknown, or the persisted
  `DEFAULT_NATIVE_MODEL` filler every pre-step-1 CLI thread carries ⇒ no flag, adapter
  default — and an explicit-but-rejected pick additionally writes an audit note
  (decision `denied`; the turn itself still proceeds on the default, and the entry's
  error text says so). Validation sits at the IPC boundary (`resolveRequestedModel` in
  `src/main/ipc/cli-thread.ts` → shared `resolveModelPick`); `formatInvocation` is pure
  and trusts its input. `cli-thread:spawn` / `cli-thread:input` request shapes gain
  optional `model?: string` (shape edit precedented by Phase 1 step 1's `cwd`).
  **Spike-verified flag syntax (2026-07-06; installed CLIs claude 2.1.201 / codex-cli
  0.142.5 / gemini 0.27.0):** claude `--model <m>` on the base flags BEFORE
  `--resume`/`--continue` (roster `fable`/`opus`/`sonnet`/`haiku`; model+resume
  coexistence real-run verified); codex `-m <m>` after `--json --skip-git-repo-check`
  in both `codex exec` and `codex exec resume`, before the resume id (roster
  `gpt-5.5`/`gpt-5.4`, both real-run verified; negative result recorded:
  `gpt-5.5-codex` REJECTED — API 400 on a ChatGPT-account codex — deliberately
  excluded); gemini `-m` parse-verified only — the dev machine has no gemini auth, so
  no id could be real-run verified and gemini ships `models: []` (the picker offers
  nothing, the flag is never emitted; the roster grows when ids become verifiable).
  Residual for the step-1 exit bar: codex continue-with-model (`-m` before `--last`) is
  string-construction-verified only. **Persistence:** `thread-md.ts` `encodeThread` now
  writes `model` for ALL agents (was machina-native only) so a CLI thread's pick
  survives relaunch; decode keeps the `DEFAULT_NATIVE_MODEL` fallback, which the filler
  rule maps to "no flag". **raw fallback:** `'cli-raw'` APPENDED to `AGENT_IDENTITIES`;
  `RAW_AGENT_SPEC` is `alwaysAvailable` and kept out of the probeable `CLI_AGENTS`
  (nothing to probe, detection never runs for raw); raw spawn skips the
  installed-binary check and opens a plain PTY, `sendUserMessage` refuses on raw until
  harness-supplied templates arrive (step 8, OQ3), and the thread input surface shows
  the honest no-structured-view copy with sending disabled.

- **v1.1.5 (2026-07-06, pre-Phase-2 hardening)** — §5 hardening: `createHarness`
  refuses (structured error, no harness content written, empty slug dir removed
  non-recursively; the pre-check `mkdir -p` may leave an inert empty `agents/`
  dir at the redirect target — no files, nothing executable) when the created
  directory does not canonicalize to exactly
  `<canonicalRoot>/<TE_DIR>/agents/<slug>`. Rationale: a symlink at `<TE_DIR>`
  or `<TE_DIR>/agents` redirected every harness write — verify.sh included —
  outside the watched root, where the approvals watcher (`followSymlinks:
  false`) and the `HARNESS_PROTECTED_GLOBS` auto-reject can never see it.
  Realpath EQUALITY, not containment: the glob matcher is literal-relative-path
  based, so even an intra-root alias defeats it. `listHarnesses` gets the same
  guard skip-not-throw style (symlinked agents dir ⇒ `[]`). Slug-level
  symlinks (live or dangling) were already refused by the non-recursive-mkdir
  EEXIST no-overwrite check — now locked by regression tests. The
  write-failure cleanup is bounded (deletes exactly the six known entries,
  never recursive) so a raced parent swap cannot steer a recursive delete.
  Accepted residual, same posture as §4's stale-diff TOCTOU: the
  check-then-write window is narrowed, not closed — a same-privilege process
  that swaps a parent symlink DURING create can still redirect writes; the
  gate is not a security boundary. Residuals for Phase 2: the
  verify.sh/SKILL.md read/exec path must re-run the same check at read time,
  and the harness linter should flag symlinks in the agents ancestry.

- **v1.1.4 (2026-07-06, step 5 landing)** — the §2/§4 never-regress rule is discharged:
  `commitPreAgentSnapshot` retired (spawn-site + per-turn call sites removed from
  `CliThreadSpawner`, function deleted from `git-service.ts`) after the G1–G8 evidence
  gate passed on fresh runs at the landing HEAD — see
  `03-snapshot-retirement-evidence.md` (gate checklist + parity ledger: non-repo,
  gitignored paths, out-of-root, agent-runs-git). Deliberate deviation recorded: the
  `<TE_DIR>/no-auto-commit` opt-out and `isAutoCommitOptedOut` are retired with the
  snapshot (it was scoped to automatic commits only, and none remain);
  commitApproved/revertAgent/discard were always explicit user actions and are
  unaffected. Two gates were unit-uncovered and gained tests in the evidence commit:
  G2 (approve→revertAgent tree equality) and G8 (per-turn approve/reject isolation).
- **v1.1.3 (2026-07-06, step 6 landing)** — two clarifications/deviations found
  while implementing the test-fixer harness: §6 `harness:create`'s success `root`
  is the CREATED HARNESS DIRECTORY (absolute path), not the workspace root — the
  renderer surfaces "where did this land" without recomposing TE_DIR paths. The
  renderer-side agentId forwarding (§4/§7 "agentId(slug) → turn registry") is
  implemented as a persisted optional `Thread.agentId` (`agent_id` thread-file
  frontmatter) re-sent on every `cli-thread:spawn`/`input`, so harness
  attribution survives an app relaunch instead of silently degrading to adapter
  identity on the spawn-on-demand path. `HARNESS_PROTECTED_GLOBS` remains the
  step-3 constant in `constants.ts`; `harness-types.ts` re-exports it (one
  authority, two import surfaces). Behavior is otherwise exactly as specced —
  §5 on-disk schema verbatim, refuse-to-emit before any write, no-overwrite
  absolute, verify.sh last at 0o555.
- **v1.1.2 (2026-07-05, step 3 landing)** — deviations found while implementing gate
  parity, reviewed by a 3-lens workflow + independent fix verification + Codex cold
  read: §4 headMoved hardened from tip-compare to an IMMUTABLE `headShaAtStart` +
  per-turn ledger of queue-made approval commits + `git rev-list` walk
  (`isAgentHeadMove`) — a mid-turn user approval must not erase evidence of an earlier
  agent commit (Codex finding); detection runs at every attributed batch AND at turn
  close (a trailing self-commit emits no watched fs event), both audited
  (`cli-agent:head-moved`). Turn close uses open-invocation counting (a cancelled
  turn's late block event must not close the follow-up turn); every OPEN window
  requires PTY liveness (a crashed shell must not leave an eternal attribution
  window). Approve stages around gitignored-untracked paths (`ignoredUntracked`:
  check-ignore minus index/HEAD membership) — `git add` exits 1 on ignored pathnames
  while partially staging, which bricked the item (review blocker); all-ignored items
  degrade to acknowledge. The watcher suppresses the queue's own discard echoes (TTL
  window) so Reject cannot resurrect its own item; `autoReject` is root-guarded
  (`expectedRoot`) and the approvals surface is disarmed FIRST on workspace switch.
  `dist/build/out` excluded at top level only (nested `scripts/build/` stays watched);
  `.git`/`node_modules` at any depth. Documented accepted residuals: self-write
  suppression outranks the forbidden check (inverse would auto-discard legitimate
  editor edits to rules.md; ~2s same-path race = the §4 accepted timing race), and
  old-workspace PTYs writing unwatched after a switch (§4 scope limits — killing PTYs
  on switch is a product decision deferred).
- **v1.1.1 (2026-07-05, step 2 landing)** — deviations discovered while implementing and
  adversarially reviewing the git substrate, folded back in the same commit: §2
  Machina-Reverts trailer value is the reverted shas (agentId-only semantics could not
  prevent re-reverts — proven by test); `discard` takes a required injected `removeFile`
  (trash-backed at the IPC layer); path guards harden to post-symlink containment +
  `:(literal)` pathspecs (two review blockers: symlink escape, pathspec wildmatch/magic);
  `diff` routes on index/HEAD membership, sha256-stamped truncation marker, visible
  failure marker; §4 queue items are workspace-bound (`workspace-changed`) and retained
  on failed resolves. Behavior is otherwise as specced; `status()` returns entries with
  `isRepo` composed at the IPC layer per the §6 `git:status` response shape.
- **v1.1 (2026-07-05)** — after 4-lens adversarial verification + 6-designer spec pass +
  completeness critique (11 agents): §2 shapes hardened (SAFE_ID_RE, trailer enumeration
  via `trailers:valueonly`, Machina-Reverts, `--no-index` diffs for new files, recoverable
  discard, opt-out scope); §3 adapter registry deferred to Phase 2; §4 rewritten —
  post-persistence containment framing, CliTurnRegistry replaces the false
  bridge-tracks-in-flight claim, own watcher ignore policy, non-repo policy, security
  -boundary statement, flags/TOCTOU; §5 state.md indexing corrected to prompt-composition
  only, dual-TE_DIR protected globs; §6 response shapes + moot sequencing; §7 reordered.
- **v1.0 (2026-07-05)** — initial Phase 0 contracts (`ec6fa6d`).
