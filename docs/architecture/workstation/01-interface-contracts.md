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

/**
 * v1.2.5 — one agent's unreverted attributed commits (listAgentCommits). Ids are
 * trailer-sourced: harness slugs, adapter identities, and slugs from since-deleted
 * harnesses all appear. shas newest first; lastSubject/lastDate from the newest commit.
 */
export interface AgentCommits {
  readonly agentId: string
  readonly shas: readonly string[]
  readonly lastSubject: string
  readonly lastDate: string // ISO 8601 author date
}
/** v1.2.5 — response for git:list-agent-commits (structured, never throws). */
export type AgentCommitsResult =
  | { readonly ok: true; readonly agents: readonly AgentCommits[] }
  | { readonly ok: false; readonly reason: string }

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
   * v1.2.5 — read-only twin of revertAgent's enumeration (the SAME single git-log
   * trailer walk, factored into a shared reader): every unreverted agent-attributed
   * commit grouped by exact Machina-Agent trailer value; shas named in any
   * Machina-Reverts trailer are excluded, so the list refreshes past a revert.
   * Non-repo and git failure → [] (list semantics, matching status()).
   */
  listAgentCommits(root: string): readonly AgentCommits[]
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

**Status 2026-07-07 (Phase 2 step 4, v1.2.3):** CONSUMED — the structured thread and
the raw PTY are two projections of ONE WorkstationSession (PLAN Q8), flipped by the
ThreadPanel header toggle. The renderer's single sessionId authority is
`src/renderer/src/store/cli-session-store.ts` (threadId → sessionId + liveness):
seeded from the `cli-thread:spawn` response (agent-transport now KEEPS it), updated by
the `cli-thread:session-changed` event (fired on the spawner's spawn-on-demand respawn
path), pull-hydrated via `cli-thread:get-session` (§6). The bridge's
`metadata.sessionId` path stays untouched and must NOT feed the store — it arrives
only after the first block and goes stale on respawn (the two-sources bug the store
closes). The raw projection reattaches via the existing `terminal:reconnect` seam,
reattach-ONLY: see the §4 dead-PTY no-respawn contract point.

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
| `attributionSuspect` | agentId failed main-side binding validation | `turnStarted`, from the IPC-boundary resolution (v1.2.2 — LANDED) |

### Attribution authority (Phase 2 step 3, v1.2.2)

Frontmatter-persisted `agent_id` was renderer/disk-supplied end-to-end, and
`<TE_DIR>/threads` is watcher-ignored by design — a one-line frontmatter edit silently
reassigned every future commit trailer and corrupted `revertAgent` scope. Main is now the
binding authority:

- **HarnessRunRegistry** (`src/main/services/harness-run-registry.ts`): a **write-once
  threadId→slug binding**, persisted under userData (`harness-bindings.json`, atomic
  writes) keyed workspace root + threadId. A binding is minted ONLY inside `harness:run`
  (`composeHarnessRun`, `src/main/services/harness-run.ts`) after main's own validation —
  slug format (adapter-identity names like `cli-claude` are reserved: a colliding slug's
  trailers would be indistinguishable from the degrade fallback, corrupting `revertAgent`
  scope), threadId format (SAFE_ID — enforces the registry-key precondition at the mint
  boundary), the v1.1.5 realpath-equality re-check, all four harness files readable — so
  a forged renderer request can never record a binding for an unvalidated harness;
  re-binding to a different slug is refused forever (same-slug re-record is idempotent). Acknowledged residual: a
  user-level agent could theoretically reach userData and edit the mirror — same class
  as trailer forgery; this is accident containment, not a security boundary.
- **Degrade-not-fail** (`resolveRequestedAgentId`, `src/main/ipc/cli-thread.ts`, wired
  into BOTH `cli-thread:spawn` and `cli-thread:input`): an absent agentId is the unbound
  ad-hoc case — no lookup, no audit, adapter identity as today. A forwarded agentId that
  is malformed, mismatches the thread's binding, arrives on an unbound thread, or cannot
  be resolved because the registry itself threw (reason `registry-error`)
  degrades to adapter identity + a `cli-agent:attribution-mismatch` audit entry
  (decision `denied`; mismatch includes the `boundSlug`) + the turn tagged
  `attributionSuspect` — flowing `turnStarted` → `ActiveTurnMatch` →
  `PendingChangeFlags` → tray chip exactly as `gateDegraded` does. The turn is NEVER
  blocked.
- **One-time trust-on-upgrade backfill** (`ensureRootReady`): on a root's first touch,
  every existing thread whose persisted `agent_id` is a valid non-reserved slug naming a
  real (realpath-checked) harness dir gets a binding backfilled, each audited
  `cli-agent:binding-backfill`; an `agent_id` naming no harness dir gets NO binding and
  degrades + flags on its next send. The root is then marked in a **persistent**
  `backfilledRoots` set (even when zero threads matched) — re-running backfill on every
  open would re-trust tampered frontmatter after each relaunch and defeat the step.
  After the mark, ANY forwarded agentId on an unbound thread flags. The thread scan is
  per-file tolerant (`listThreadAgentIdsTolerant`): one crafted or corrupt file in the
  watcher-ignored threads dir is skipped (stays unbound), never a scan failure — a
  throwing registry on the turn path degrades (`registry-error`), it does not fail turns.
- **Supersedes v1.1.3's frontmatter-persistence-as-attribution-source**: v1.1.3 made
  `Thread.agentId` (`agent_id` frontmatter) the relaunch-surviving attribution source,
  re-sent on every spawn/input. The transport still re-sends it, but it is now demoted
  to **display-only** input — decode is kept for UI titles and transport forwarding,
  and main validates every forwarded value against the binding.
- **`git:revert-agent` validation = trailer enumeration, NOT registry membership**
  (explicit deviation from the item-3 dossier's req 4): the git-log trailer walk is the
  authority — an unknown-but-well-formed id yields `no-commits-for-agent` — so commits
  from pre-binding history, deleted harnesses, or a wiped userData stay revertable.
  No code change was needed: `git-service.ts` already enumerates trailers; a test pins
  it. Post-binding, forged slugs can no longer *enter* trailers via Machina's own path;
  forged-by-shell trailers remain the accepted §4 forgery residual.

### Two-projection agent view (Phase 2 step 4, v1.2.3)

- **Dead-PTY no-respawn rule (contract point):** an agent thread's raw projection is
  reattach-ONLY. A stale, dead, or absent PTY renders a read-only dead state and NEVER
  respawns a fresh shell in the thread's cwd — an unattributed shell there would be a
  containment hole (no turn window would ever cover its writes). Enforced at BOTH
  layers, each test-pinned in the Phase-1-step-4 no-kill-on-detach style: the host
  adapter (`TerminalDockAdapter` `projection="agent"` mounts no webview at all without
  a session, and omits `cwd`/`vaultPath` from the webview URL) and the webview guest
  itself (`reattachOnly` URL param, built by the pure builders in
  `terminal-webview-src.ts` in name-sync with `TerminalApp.readUrlParams`, read by the
  extracted `connect-session.ts` decision to skip the `terminal:create` fallback and
  report `session-dead` to the host). The webview's stale-session respawn stays
  CORRECT for plain terminals; it is forbidden only for agent projections. The next
  turn — an explicit user send — is the only thing that spawns a fresh, attributed
  PTY (the spawner's existing spawn-on-demand path).
- **Raw-view input is attributed to the thread's turn windows**
  (interactive-input residual, named honestly): the raw view is the user's PTY —
  keystrokes flow through the same shell-hook block → bridge path as agent output,
  at the same trust level as today's dock terminal. Echoed keystrokes inside a
  running agent block and user-run non-agent commands mid-turn are test-pinned
  harmless (the turn still completes once, the reply still mirrors); but a user-typed
  command whose first token matches a CLI agent binary can be mirrored as an agent
  reply (`detectAgentFromCommand`) and interacts with turn-window open/close counting.
  Accepted for Phase 2 and documented here; §4's scope-limit honesty applies — writes
  made by the user through the raw view during an open turn land in that turn's
  queue item.

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

### Harness linter (Phase 2 step 7, v1.2.4)

Everything create-time validation cannot see is the linter's job: scope.json is never
re-validated after create (a hand-edit can strip `HARNESS_PROTECTED_GLOBS` undetected),
verify.sh mode/presence drift is unchecked, and malformed harnesses used to vanish from
the palette silently.

```ts
type DiagnosticSeverity = 'error' | 'warning'
interface Diagnostic {
  severity: DiagnosticSeverity
  code: string    // e.g. 'scope-protected-globs', 'symlink-ancestry', 'file-missing'
  message: string
  file: string    // harness-dir-relative; '.' = the directory itself
}
lintHarness(input: HarnessLintInput): Diagnostic[]   // src/shared/harness-lint.ts — PURE
lintHarnessOnDisk(root, slug): Promise<Diagnostic[]> // harness-service.ts — fs lints ∘ lintHarness
```

`Diagnostic` is deliberately minimal — four fields, TWO severities. Severity-taxonomy
creep is the named linter failure mode; widening this shape requires a contracts
amendment. **Composition rule:** the pure CONTENT lints live in `harness-lint.ts`
(renderer-importable — step 8's wizard previews diagnostics on a would-be harness):
scope superset re-validation (REUSES `validateHarnessScope`, never reimplemented),
rules.md `- [severity] text` tag format, `<dir>` placeholder leakage into a
materialized scope, frontmatter name↔directory-slug mismatch, frontmatter
parse-failure reasons, verify.sh shebang. The FILESYSTEM lints live main-side in
`harness-service.ts`: presence of the five files + `handoffs/`, verify.sh 0o555 mode
drift, and the symlink-in-ancestry realpath-equality check (the agents dir or slug dir
not canonicalizing to its literal path ⇒ error diagnostic) — **this discharges v1.1.5
residual #2**. Main COMPOSES shared + fs lints and never reimplements a shared check.

`harness:list` summaries carry `diagnostics` (and `adapter: HarnessAdapter | null` —
null when the frontmatter is unreadable), so malformed harnesses surface with their
skip reason instead of silently vanishing; only non-addressable entries (invalid-slug
names, stray files) stay skipped. Error severity disables run everywhere — the palette
renders broken harnesses greyed with the reason (never vanished), and `runHarness`
re-checks defensively. Warnings inform but never disable.

### Budget stack + circuit breakers (Phase 2 step 6, v1.2.6)

Budgets are ENFORCED with defined semantics (they were parsed-but-decorative
before this step):

- **`maxWritesPerMinute` = the write-rate-limiter threshold, PER THREAD.**
  `WriteRateLimiter` is keyed per thread, so N concurrent threads bound to one
  slug each get the full threshold — per-thread-per-slug semantics, documented
  honestly rather than building aggregate accounting (per-slug aggregation is
  Phase 3's loop scheduler; a concurrent-same-slug test pins current behavior).
  The watcher takes the threshold from an injected per-thread budgets provider
  (`AgentWriteWatcherDeps.getWriteBudget`, wired in ipc/git.ts from the binding
  snapshot); unbound/ad-hoc threads get the default 10
  (`DEFAULT_MAX_WRITES_PER_MINUTE` — a fallback constant, not a value read from
  any harness).
- **`maxTurns` = CLI invocations per thread**, counted at
  `CliTurnRegistry.turnStarted` (OQ2 — agent-internal iterations are invisible
  in the `--print` model and gemini/raw have no structured stream; Phase-3
  loops are the primary consumer). Counts are in-memory per app run (registry
  lifetime) and deliberately survive `threadClosed`: a kill must not refill the
  budget. Budget N allows exactly N invocations; the N+1th trips.
- **Budgets SNAPSHOT at bind time** (`HarnessBinding.budgets`, the step-3
  reserved field, persisted in the userData mirror): SKILL.md frontmatter is
  agent-writable — `HARNESS_PROTECTED_GLOBS` covers only verify.sh and
  rules.md — so a running agent can edit its own budgets mid-run.
  Snapshot-at-bind is the mitigation: post-bind edits affect the NEXT run only
  (write-once covers the snapshot; a same-slug re-record never refreshes it).
  Widening the protected globs to SKILL.md is REJECTED for now (it would
  auto-reject the agent's legitimate state.md-sibling workflow and user edits
  alike) — accepted residual with the tamper channel named. Trust-on-upgrade
  backfills mint bindings WITHOUT budgets (frontmatter is the tamper channel
  the backfill only half-trusts): legacy threads run under the default
  threshold with no maxTurns enforcement.

**Circuit breaker** (`src/main/services/agent-circuit-breaker.ts`, keyed
threadId/agentId; shared types in `src/shared/agent-breaker-types.ts`). Trip
inputs → trip action = kill (`spawner.close` via a late-bound callback — PTY
killed, turn window dropped with zero linger) + audit
(`cli-agent:breaker-tripped`) + the `agent:breaker-tripped` event:

- **velocity** = `VELOCITY_TRIP_CONSECUTIVE` (3) CONSECUTIVE limiter-exceeded
  batch observations, never one window (one burst flags `highVelocity`; only
  a sustained burst trips; a non-exceeded batch resets the count);
- **forbidden-writes** = `FORBIDDEN_TRIP_PER_TURN` (3) HARNESS_PROTECTED_GLOBS
  autoRejects within one turn;
- **head-moved** = the agent-ran-git tripwire (the watcher's once-per-turn
  audit is the signal; the turn-END tripwire in ipc/git.ts audits + flags but
  does not feed the breaker — the turn is over and the PTY idle);
- **max-turns** = invocation count exceeded the bound budget (surfaced by
  `CliTurnRegistry.onTurnStarted` → `checkMaxTurnsOnTurnStarted` in
  ipc/cli-thread.ts, deferred one microtask so a kill never races the
  in-flight send).

Signal seam: no subscribe API exists on the queue, so
`AgentWriteWatcherDeps.breaker` is an injected port
(`noteVelocity`/`noteForbiddenAutoReject`/`noteHeadMoved`) invoked from the
existing flag-assembly and autoReject sites — the same injected-dependency
style as step 2's `onHealthChange`, wired in ipc/git.ts. Kill runs EXACTLY
ONCE per trip episode (per-thread latch; the episode resets when the thread's
next turn opens — an explicit user send is re-engagement, so a still-breached
maxTurns budget re-trips per send by design).

**Negative rules (contract points, test-pinned):** (1) the breaker NEVER
trips on watcher-degraded state alone — health is consumed only for status
honesty (`AgentBreakerStatus.signalsDegraded`: the velocity/forbidden/
headMoved sources have no coverage right now); a dead watcher must not kill
healthy agents. (2) It NEVER auto-kills on signals from writes flagged
`concurrentTurns` — ambiguous attribution could kill the wrong agent; the
trip degrades to a tray notice (`action: 'notice'`, audited decision `error`,
kill left manual); a later unambiguous signal may escalate to the one kill.

**Kill switch** = the existing hard-kill path surfaced: a Kill button on CLI
thread headers (`agent-breaker-kill-switch.tsx`, liveness from the
cli-session-store) drives `cli-thread:close`; distinct from the input bar's
Stop (Ctrl+C leaves the shell alive). **Kill-vs-awaitWriteFinish semantics
(recorded, tested):** writes flushing within the watcher's ~300ms
awaitWriteFinish window after the kill arrive after `threadClosed` dropped
the window with zero linger — they become audited-unattributed writes
(`cli-agent:unattributed-write`), documented and never silent. UI copy stays
inside the §4 framing: breakers contain accidents faster; they never claim
prevention — the tripping writes are already on disk and stay in the queue.

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
'harness:run':           { request: { slug: string; threadId: string } // v1.2.2 — main-side composition; records the write-once binding
                           response: { ok: true; prompt: string } | { ok: false; error: string } }
'harness:binding':       { request: { threadId: string }; response: { slug: string } | null } // v1.2.2 — recorded deviation: the main-binding-sourced identity chip needs a read path
'approvals:list':        { request: void; response: PendingChange[] }
'approvals:resolve':     { request: { id: string; approve: boolean; message?: string }; response: GitOpResult }
'approvals:watcher-status': { request: void; response: WatcherHealth } // v1.2.1 — pull mirror for late subscribers
'approvals:watcher-retry':  { request: void; response: GitOpResult }  // v1.2.1 — manual restart; resets the backoff cap
'harness:lint':          { request: { slug: string }; response: Diagnostic[] } // v1.2.4 — on-demand re-lint; no workspace ⇒ [] (list semantics). harness:list summaries carry the same diagnostics (+ adapter widened to HarnessAdapter | null)
// IpcEvents
'approvals:changed':     { pending: number }
'approvals:watcher-health': WatcherHealth // v1.2.1 — health transitions (tray badge/banner, thread chip)
'cli-thread:get-session': { request: { threadId: string }; response: { sessionId: string; live: boolean } | null } // v1.2.3 — pull mirror of the spawner binding (invoke, not an event; appended per the parallel-session rule)
// IpcEvents (v1.2.3)
'cli-thread:session-changed': { threadId: string; sessionId: string } // v1.2.3 — spawn-on-demand respawn rebinding; feeds cli-session-store
'git:list-agent-commits': { request: void; response: AgentCommitsResult } // v1.2.5 — read path for the revert UI; null root ⇒ { ok:false, reason:'no-workspace' }, non-repo ⇒ 'not-a-git-repo' (the tray renders the honest "nothing to revert from" state, never a false empty)
'agent:breaker-status':  { request: void; response: AgentBreakerStatus } // v1.2.6 — pull mirror of tripped breakers + signalsDegraded (tray notice rows, kill-switch chip)
// IpcEvents (v1.2.6)
'agent:breaker-tripped': BreakerTripEvent // v1.2.6 — trip broadcast: action 'killed' (containment applied) or 'notice' (concurrentTurns ambiguity, kill left manual)
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

- **v1.2.6 (2026-07-07, Phase 2 step 6 landing)** — §5 gains the
  budget-stack + circuit-breaker subsection: budgets ENFORCED
  (`maxWritesPerMinute` = per-THREAD limiter threshold from an injected
  budgets provider, default 10 for unbound/ad-hoc — per-thread-per-slug
  semantics documented honestly, per-slug aggregation deferred to Phase 3;
  `maxTurns` = CLI invocations per thread counted at
  `CliTurnRegistry.turnStarted` per OQ2, in-memory per app run, surviving
  threadClosed so a kill never refills the budget), **budgets snapshot at
  bind** (`HarnessBinding.budgets` — the step-3 reserved field — persisted in
  the userData mirror; write-once covers the snapshot, post-bind SKILL.md
  edits affect the next run only; widening HARNESS_PROTECTED_GLOBS to
  SKILL.md rejected, accepted residual with the tamper channel named;
  backfilled bindings carry NO budgets — legacy threads run under the default
  threshold with no maxTurns enforcement). New breaker contract
  (`agent-circuit-breaker.ts`, types in `agent-breaker-types.ts`): trip
  inputs velocity (3 CONSECUTIVE limiter-exceeded batches, never one) /
  repeated forbidden autoRejects (3 per turn) / headMoved (watcher signal,
  once per turn) / maxTurns breach; trip action = cli-thread hard kill via a
  late-bound spawner.close callback + `cli-agent:breaker-tripped` audit +
  `agent:breaker-tripped` event, EXACTLY ONE kill per episode (per-thread
  latch, reset on the thread's next turn). Negative rules as contract points:
  never trip on watcher-degraded state alone (health feeds only
  `AgentBreakerStatus.signalsDegraded` honesty), never auto-kill on
  `concurrentTurns`-flagged signals (degrade to a tray notice, decision
  `error`; a later unambiguous signal may escalate to the one kill).
  Kill-vs-awaitWriteFinish recorded + tested: post-kill flush-window writes
  become audited-unattributed (zero-linger threadClosed trade). Kill switch =
  the existing hard-kill surfaced on CLI thread headers
  (`agent-breaker-kill-switch.tsx` → `cli-thread:close`); tray gains the
  breaker notice rows (`agent-breaker-notice.tsx`, mount-only insertion in
  ApprovalsTray). §6 gains `agent:breaker-status` + the
  `agent:breaker-tripped` event (appended at the list end). `HarnessSummary`
  gains optional `budgets` (what the next run would snapshot; absent when
  frontmatter is unreadable). Recorded deviations: (1) the OQ8
  workspace-switch visibility graft is EXCLUDED — not ratified by Casey as of
  2026-07-07; the spec marks it severable, and it becomes its own follow-up
  commit after the call; (2) the kill switch lives in the ThreadPanel header
  only (the spec offered ThreadInputBar OR header) — ThreadInputBar is
  untouched, keeping Stop (interrupt) and Kill (hard stop) visually distinct;
  (3) the turn-END headMoved tripwire does not feed the breaker (the spec
  names the watcher's flag-assembly/autoReject sites as the signal seam; at
  turn end the PTY is idle and the audit + flag already record it); (4)
  breaker shared types live in a new `agent-breaker-types.ts` rather than
  git-types.ts (zero collision with the parallel step 5); (5) a notice-latched
  episode stays quiet on further ambiguous signals (no event spam) but
  escalates to the single kill on an unambiguous one.
- **v1.2.5 (2026-07-07, Phase 2 step 5 landing)** — per-agent revert UI +
  list-agent-commits. §2 GitService gains `listAgentCommits(root)` — the single
  git-log trailer walk was factored out of `revertAgent` into a shared reader so
  both enumerate commits (and Machina-Reverts exclusions) identically; groups are
  per exact Machina-Agent value, shas newest first, with the newest commit's
  subject/author-date; non-repo and git failure → [] (list semantics). git-types
  gains `AgentCommits` / `AgentCommitsResult`. §6 gains `git:list-agent-commits`
  (root main-side; null root ⇒ `{ ok:false, reason:'no-workspace' }`, non-repo ⇒
  `'not-a-git-repo'` so the tray renders the honest "nothing to revert from"
  state). Renderer: `RevertAgentSection` mounts in the ApprovalsTray popover
  (OQ5's git-consequences surface), collapsed by default and enumerating only
  when opened; revert sits behind an inline arm→confirm whose copy follows the §4
  containment framing (revert CREATES new commits, deletes no history, and is not
  protection — later agent writes are not blocked). Palette "Revert harness:
  <slug>" entries are gated on a non-empty unreverted-commit list and route
  through the `te:revert-agent` CustomEvent into the tray confirm — the palette
  never one-click reverts. Ids are trailer-enumerated, never registry-checked, so
  commits from a since-deleted harness (or an adapter-identity fallback) stay
  listed and revertable (the step-5 judge graft). Recorded deviations: (1)
  `CommandPalette.tsx` (not in the spec's edit list) fetches the snapshot on
  palette open — same open-refresh pattern as harness summaries; (2) the confirm
  is an inline two-step arm/confirm in the tray section, not a modal dialog (no
  modal-confirm component exists in the app; same discipline as CanvasToolbar's
  destructive clear); (3) `revertAgent`'s failure copy distinguishes
  `revert-conflict` ("nothing was changed — resolve in git directly") from other
  structured reasons.
- **v1.2.4 (2026-07-07, Phase 2 step 7 landing)** — §5 gains
  the harness-linter subsection: `Diagnostic { severity: 'error' | 'warning', code,
  message, file }` (deliberately minimal — severity-taxonomy creep is the named linter
  failure mode), pure content lints in `src/shared/harness-lint.ts`
  (`lintHarness(files) → Diagnostic[]`, renderer-importable: scope superset
  re-validation reusing `validateHarnessScope`, rules.md severity-tag format, `<dir>`
  placeholder leakage, frontmatter name↔slug mismatch, frontmatter parse-failure
  reasons, verify.sh shebang) COMPOSED with main-side fs lints in `harness-service.ts`
  (file presence, verify.sh 0o555 mode drift, handoffs/ presence, symlink-in-ancestry
  realpath equality — **discharges v1.1.5 residual #2**, dated status line added
  there); main never reimplements a shared check. §6 gains `harness:lint` (root
  main-side; no workspace ⇒ `[]`, list semantics) and `harness:list` is widened:
  `HarnessSummary` carries `diagnostics` plus `adapter: HarnessAdapter | null` (null =
  unreadable frontmatter, always accompanied by an error diagnostic) — malformed
  harnesses stop silently vanishing; a symlinked agents dir now LISTS its entries with
  `symlink-ancestry` errors (supersedes v1.1.5's silent `[]` skip — the lint surfaces
  what the skip hid; createHarness's refusal behavior is unchanged). Error severity
  disables run: the palette renders broken harnesses greyed with the first error's
  reason (`PaletteItem.disabledReason`, `aria-disabled`), and `runHarness` re-checks
  defensively before creating a thread. Recorded deviations: (1) `harness-store.ts`
  needed no textual change — diagnostics ride the widened `HarnessSummary` type; (2)
  presence lints use ONE code `file-missing` with the `file` field disambiguating
  (severity: error for SKILL.md/rules.md/scope.json/state.md/verify.sh — all five are
  read by run or are the gate — warning for `handoffs/`), and missing
  rules.md/scope.json/state.md are flagged beyond the spec's enumerated fs lints
  because `harness:run` reads all four files; (3) invalid-slug directories and stray
  files remain skipped (not addressable as harnesses — "malformed harness" means a
  valid-slug directory); (4) `<dir>` placeholder leakage is WARNING severity —
  containment is unaffected (the watcher auto-reject matches the
  `HARNESS_PROTECTED_GLOBS` literals, not scope.json), and the superset check
  independently errors if the protected literals themselves are gone; verify.sh mode
  drift is likewise a warning (defense-in-depth, not a boundary — §5).
  **Post-merge review amendments (2026-07-07, same landing window; Claude adversarial
  lenses + Codex cold read):** (a) `harness:run` — `composeHarnessRun` re-runs the
  lint composition main-side at run time and refuses on any error-severity diagnostic
  (structured `{ ok:false, error }`); the palette disable is a defense-in-depth twin
  against the list-time snapshot, NOT the enforcement boundary — closes the TOCTOU
  where scope.json is tampered after the palette opened. (b) A failed
  symlink-ancestry check now returns ONLY the ancestry error diagnostic with NO
  content read through the link (frontmatter unread ⇒ name falls back to slug,
  adapter null, no content lints) — closes an outside-workspace content leak into
  the palette; supersedes this entry's earlier "listed with errors" behavior, which
  still read through the link for display. (c) Two new error codes, both disabling
  run: `scope-fields` (scope.json missing required scalar goal/acceptance/rollback —
  the unsound `as HarnessScope` cast in the pure lint was also removed) and
  `reserved-slug` (a hand-created adapter-identity directory greys with reason
  instead of erroring at run; reuses `isReservedHarnessSlug`). (d) verify.sh
  mode-drift mask widened `0o777` → `0o7777` so setuid/setgid/sticky drift (e.g.
  `0o4555`) is caught. Diagnostic stays exactly four fields, two severities.
  Recorded residuals (not fixed): file-level symlinks inside a harness dir escape
  the dir-ancestry lint (in-app creation is watcher-auto-rejected; hand-created
  ones are undetected); a dangling agents-dir symlink still yields a silent `[]`;
  the run-time lint reads real fs even when `deps.fs` is injected.
- **v1.2.3 (2026-07-07, Phase 2 step 4 landing)** — two-projection agent
  view: §3 SessionProjection/WorkstationSession CONSUMED (dated status line added
  there) — the thread surface and the raw PTY are two projections of one
  WorkstationSession, flipped from the ThreadPanel header. New renderer
  `cli-session-store` is the SINGLE sessionId authority (seeded from the
  `cli-thread:spawn` response — `agent-transport.start` now keeps the sessionId it
  used to drop; updated by the new `cli-thread:session-changed` event, fired on the
  spawner's spawn-on-demand respawn path; pull-hydrated by the new
  `cli-thread:get-session` invoke). The bridge's `metadata.sessionId` path is
  untouched and must not feed the store. §4 gains the two-projection subsection: the
  **dead-PTY no-respawn rule** as a contract point (agent projections are
  reattach-only at BOTH layers — adapter `projection="agent"` renders a read-only
  dead state and mounts no webview without a session + omits cwd/vaultPath from the
  URL; the guest's `terminal:create` fallback is disabled by the `reattachOnly` URL
  param and reports `session-dead` to the host; the stale-session respawn stays
  correct for plain terminals) and the honest §4 copy that raw-view input is
  attributed to the thread's turn windows (interactive-input residual). §6 gains
  `cli-thread:get-session` + the `cli-thread:session-changed` event (appended at the
  list end per the same rule). Recorded deviations from the step-4 spec: (1) the
  guest-side connect decision was EXTRACTED to
  `src/renderer/terminal-webview/connect-session.ts` (pure, api-injected) rather than
  edited inline in `TerminalApp.tsx` connectSession — the spec's load-bearing
  "no terminal:create at the webview layer" assertion is only behaviorally pinnable
  against a pure function (TerminalApp itself is not unit-mountable; its existing
  source-string tests were updated to pin the delegation); (2) the adapter dead state
  is also shown when a live raw view's PTY exits (`session-exited` in projection
  mode) — a strict reading only required stale-at-mount, but a PTY dying under the
  view is the same dead session; (3) `cli-thread:get-session` returns
  `{ sessionId, live } | null` (liveness from the spawner's existing
  `hasLiveSession` probe) rather than a bare sessionId — the store needs liveness to
  render the dead state without a second channel.
  **Post-merge review amendments (2026-07-07, same landing window):** the built-app
  probe's evidence mechanisms were repaired (PID proof via `lsof -a -d cwd` — the
  PTY shell has an empty argv; replay read via a guest-window-scoped
  `window.__terminalText()` test hook in `TerminalApp.tsx`, xterm's WebGL canvas
  has no text DOM) and executed green; the reattachOnly plumb-through test was
  tightened so a hardcoded `reattachOnly: false` at the `connectToSession` call
  site now fails it. Recorded residuals: `cli-session-store.hydrate` can overwrite
  a fresher session-changed binding with a stale pull snapshot — fails toward the
  dead state, never a respawn; a compare-and-set would remove it. The
  block-integrity test pair interleaves human input only at line boundaries —
  mid-byte-stream echo that splits a JSONL record is an unexercised fidelity limit.
- **v1.2.2 (2026-07-06, Phase 2 step 3 landing)** — §4 gains the attribution-authority
  subsection: `HarnessRunRegistry` (write-once threadId→slug, persisted keyed workspace
  root + threadId under userData `harness-bindings.json`; acknowledged residual: a
  user-level agent could reach userData — same class as trailer forgery, accident
  containment not a boundary), minted only inside the new `harness:run` after main's own
  validation (slug format + the v1.1.5 realpath-equality re-check + all four harness
  files readable — the re-check discharges v1.1.5 residual #1, dated status line added
  there). `resolveRequestedAgentId` (`ipc/cli-thread.ts`) validates every forwarded
  agentId at BOTH spawn and input with degrade-not-fail semantics: malformed / mismatch
  (audits the `boundSlug`) / unbound-thread / registry-error ⇒ adapter identity +
  `cli-agent:attribution-mismatch` (decision `denied`) + `attributionSuspect` — the flag
  taxonomy row flips to LANDED (set at `turnStarted` from the IPC-boundary resolution;
  a degraded resolution also clears any stale in-session slug in the spawner so the
  requested slug is never attributed). Legacy threads get the **one-time
  trust-on-upgrade backfill** with a persistent per-root `backfilledRoots` marker (each
  binding audited `cli-agent:binding-backfill`; re-running per open would re-trust
  tampered frontmatter after every relaunch); zero-match roots still mark. Supersedes
  v1.1.3's frontmatter-persistence-as-attribution-source: `agent_id` is demoted to
  display-only (decode kept for UI titles + transport forwarding, now main-validated).
  Recorded deviations from the step's dossier: (1) renderer run sequence — the renderer
  creates the thread WITHOUT agentId (the createThread-time spawn never forwards an
  unbound agentId), calls `harness:run { slug, threadId }`, persists `agentId = slug`
  via the sanctioned `thread-store.setThreadAgentId` only on ok, and keeps the
  shell-prompt wait + send renderer-side (moving the send into main would re-open the
  Phase-1 step-6 lost-reply failure); on refusal it deletes the just-created thread and
  notifies — net "no thread created", satisfying the realpath-regression test intent;
  (2) `harness:binding` read channel added (§6) — the main-binding-sourced
  harness-identity chip (`HarnessIdentityChip` on CLI thread headers) is impossible
  without a read path; (3) backfill is one-time PER WORKSPACE ROOT, persistently marked
  (above); (4) `git:revert-agent` needed NO code change — validation is trailer
  enumeration, not registry membership (explicit deviation from the item-3 dossier's
  req 4): the existing git-log trailer walk (`no-commits-for-agent` on unknown ids) is
  the authority, so pre-binding history, deleted harnesses, and a wiped userData stay
  revertable; a test pins it; (5) bindings for deleted threads are not
  garbage-collected — harmless orphans (revert validation is trailer-based), accepted
  residual. §6 gains `harness:run` and `harness:binding`.

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
  **Status 2026-07-06 (Phase 2 step 3, v1.2.2):** residual #1 (read/exec-time
  re-check) is DISCHARGED — `composeHarnessRun`
  (`src/main/services/harness-run.ts`) re-runs the realpath-equality check at
  read/compose time before any harness file is read, and the backfill's
  `harnessDirExists` applies the same check; nothing execs verify.sh yet, so
  the read-time check covers the whole current surface. Residual #2 (linter
  flags symlinks in the agents ancestry) remains for step 7.
  **Status 2026-07-07 (Phase 2 step 7, v1.2.4):** residual #2 is DISCHARGED —
  the main-side fs lints flag a non-canonicalizing agents/slug ancestry as an
  error diagnostic (`symlink-ancestry`), so a symlinked harness now surfaces
  greyed-with-reason with run disabled instead of the silent `[]` skip.

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
