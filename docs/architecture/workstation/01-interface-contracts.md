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
the renderer already uses "workspace" for the vault folder _filter_
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
export interface GitStatusEntry {
  readonly path: string
  readonly state: GitFileState
  readonly origPath?: string
}
/** isRepo lets the renderer surface "non-repo = no rollback protection" honestly. */
export interface GitStatusResult {
  readonly isRepo: boolean
  readonly entries: readonly GitStatusEntry[]
}

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
   * v1.2.7 — `onWillRevert(paths)` fires with the union of to-be-touched paths BEFORE
   * any tree change (the IPC layer suppresses the watcher on them and excuses the
   * revert sha on open turn windows), and the final commit is PATHSPEC-LIMITED to
   * those paths so user-staged bystander files are never swept in.
   */
  revertAgent(
    root: string,
    agentId: string,
    onWillRevert?: (paths: readonly string[]) => void
  ): GitOpResult
  /**
   * v1.2.5 — read-only twin of revertAgent's enumeration (the SAME single git-log
   * trailer walk, factored into a shared reader): every unreverted agent-attributed
   * commit grouped by exact Machina-Agent trailer value; shas named in any
   * Machina-Reverts trailer are excluded, so the list refreshes past a revert.
   * Non-repo → [] (nothing to enumerate). v1.2.7: git-log FAILURE → null — a failed
   * walk is a structured error at the IPC layer ('git-failed'), never a false empty.
   */
  listAgentCommits(root: string): readonly AgentCommits[] | null
  /**
   * Reject flow. Tracked → `git restore --source=HEAD`; untracked → the INJECTED
   * removeFile callback (v1.1.1: required third parameter; the IPC layer binds
   * `shell.trashItem` so deletion stays recoverable — no non-recoverable default exists).
   * Fails closed: an ls-files failure returns git-failed rather than trashing tracked files.
   */
  discard(
    root: string,
    paths: readonly string[],
    removeFile: (absPath: string) => Promise<void>
  ): Promise<GitOpResult>
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
  CLI-agent _presence_ wire types for the external-process session listener (Move 8).
  `session-types.ts` types workstation terminal sessions and the adapter seam.
- **`formatInvocation(prompt, opts incl. model?)`**: pure, trusts its input — the model
  flag is emitted whenever `opts.model` is set. Validation lives at the IPC boundary
  (`resolveRequestedModel` in `src/main/ipc/cli-thread.ts`, backed by the shared
  `resolveModelPick`); see the v1.2 changelog entry for the full trust rule.
- **`raw` semantics (OQ3, resolved by the step-8 contract)**: the whole command line
  comes from a single-line template string carrying the literal `{prompt}` placeholder;
  every occurrence must be unquoted/unescaped in one hook-observable simple command, and
  the prompt is `singleQuote`-escaped into it. No parser, no resume, no models. Ad-hoc raw
  remains a plain PTY with structured input disabled: the renderer
  cannot nominate a command. A bound raw harness is the only structured-send path. Main
  reads and validates that harness's frontmatter during `harness:run`, snapshots adapter +
  `invocationTemplate` into the write-once `HarnessBinding`, and serves the snapshot to
  the CLI input path only when root, thread, slug, and raw identity still agree. Missing,
  malformed, legacy, or corrupt-mirror snapshots expose no raw-send readiness and execute
  nothing.
  The spawner formats the exact command through `ADAPTERS.raw`, registers that byte string
  with the adapter-aware bridge **before** opening a turn or writing PTY input, then sends
  it. A preflight/registration or missing-session queue refusal opens/leaves no turn and
  writes no bytes. The bridge admits
  only the byte-exact expected shell command; unrelated human commands neither emit an
  agent event nor consume the expectation. Once admitted, the same raw block id survives
  running, completion, cancellation, and PTY-death finalization, with `onMessage` before
  `onTurnComplete` exactly once.
- **`permissionHooks` (OQ1, recorded)**: reserved optional capability field — the seam
  for adapter-native pre-write enforcement, deferred to a dedicated follow-on phase.
  Phase 2 never sets or reads it (§4).
- **Gemini nuance, restated**: the heuristic parser still exists in
  `cli-agent-parsers.ts`; "absent `parseEvent` = raw projection" is the _bridge_
  contract, not a claim about that file. Adapters without `parseEvent` (gemini, raw) get
  byte-for-byte plain PTY passthrough — the legacy `toolCallParser` path.
- **Identity mapping, superseded**: `AGENT_IDENTITIES` gained `'cli-raw'` (appended), so
  `CLI_AGENT_IDENTITIES` now maps 1:1 onto `AdapterId` _including_ `raw`;
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
is whether the write gets _blessed into history_ (commit with trailers) or _reverted_.
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
  `artifacts/`, `embeddings/`). Watched: everything else, including dotfiles, `.env`,
  `.gitignore` itself, and `<TE_DIR>/agents/**`. `.gitignore` is NOT honored — an agent
  write to an ignored `.env` must not be invisible (git can't diff/commit it, but the
  queue shows it). Self-writes suppressed via a `DocumentManager.hasPendingWrite` seam so
  user autosaves during a turn aren't misattributed (timing race accepted + documented).
- **Non-repo workspaces** (codex spawns with `--skip-git-repo-check`): the gate is
  visibility + audit only — approve acknowledges, reject is disabled, item carries the
  "no rollback" flag. Never render the queue as protection there.
- **Unattributed writes** (outside any turn window) are not queued; they get an audit
  entry (`cli-agent:unattributed-write`) so escapes are logged, not silent.
- **Gate reuse**: the queue implements `HitlGate` (`hitl-gate.ts:22`), so native-agent and
  MCP writes can converge on it later. `WriteRateLimiter` runs per thread →
  `highVelocity` flag.
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

### Global queue scope: multi-root visibility + persistence (Phase 3 step 1, v1.3.0)

The queue scope contract, rewritten. The queue is **genuinely global**: items survive
workspace switches (NO path clears the queue on switch — `initApprovalsForRoot` no longer
calls `clear()`, and the method itself is gone) and survive app restarts via a disk
mirror. "Global" = **visibility across roots, never cross-root resolution**: `resolve()`
refuses when the item's capturedRoot does not match the active workspace
(`'workspace-changed'`). That refusal is the unweakened v1.1.1 workspace-binding
invariant, restated verbatim as this rewrite's floor; it is checked BEFORE the
stale-diff recompute, exactly as before.

- **`PendingChange.capturedRoot?: string | null`** — the workspace root the item was
  captured against (`null` = captured with no workspace open). Populated on every item,
  cli-change AND gate-confirm, and delivered through the existing `approvals:list` /
  `approvals:changed` surfaces. Display + persistence data only; enforcement stays the
  queue's private root map, written from the same value in the same statement.
- **Capture binds to the CAPTURING root, not the flush-time active root** —
  `recordWrites` takes the watcher's own root (`RecordWritesOpts.capturedRoot`, the
  same discipline as `autoReject`'s `expectedRoot`): during a workspace switch the old
  watcher can flush a batch after the active root already flipped, and stamping
  `getRoot()` then would bind old-root paths to the new root with a diff recomputed
  against the wrong tree — a resolvable wrong-root item, the exact hazard the retired
  clear-on-init used to mask. `autoReject`'s failed-discard visibility fallback binds
  to its entry root for the same reason (discard is awaited; the switch can complete
  mid-await). Coalescing is root-guarded: a batch whose root differs from an existing
  item's capturedRoot is refused with an `approvals:record-refused` audit entry
  (`'captured-root-mismatch'`) — an item's capturedRoot is never silently rebound and
  paths never union across trees. Turn ids are run-unique (`t<seq>-<random run tag>`,
  `CliTurnRegistry`) so a rehydrated item's `pc_<turnId>` id can never collide with a
  new run's turn — the guard above stays defense in depth, not the primary fence.
- **Persistence** (`<userData>/approval-queue.json`, `{ version: 1, items }`,
  HarnessRunRegistry file pattern: versioned shape, atomic serialized persist chain,
  degrade-not-fail load): **cli-change items only**. On the first
  `initApprovalsForRoot` of an app run, the mirror rehydrates once; every restored item
  is re-validated against a fresh diff of ITS capturedRoot via the same stale-diff
  machinery `resolve()` uses. Drift while the app was closed drops the item with an
  `approvals:rehydrate-drop` audit entry (`'stale-diff'` | `'no-captured-root'` |
  `'diff-failed'` | `'gate-confirm-never-rehydrated'` | `'malformed'`) — never
  silently kept or resolved. A fresh diff carrying the §2 `[diff unavailable]` marker
  counts as `'diff-failed'`: GitService.diff stringifies failures rather than
  throwing, and two identical markers are a failed verification, not a match (the
  shared `isDiffUnavailable` predicate in `git-types.ts` pins detector to builder).
  Conservative by design: dropping loses convenience, never data (the writes remain on
  disk). Whole-file corruption (or a missing mirror — the normal first run) degrades
  to an empty load; per-ITEM decode failures are surfaced as drop diagnostics and
  audited (below).
- **Gate-confirm items are NEVER serialized** — they hold live Promise waiters; a
  rehydrated confirm is an unanswerable zombie row and resurrects the stale-click
  hazard the 30s remove-on-timeout exists to kill. One smuggled in via a tampered
  mirror is dropped at mirror DECODE — the production load path refuses the kind
  before the queue sees it — and `ipc/git.ts` audits each decode-level drop with the
  same `approvals:rehydrate-drop` tool (`{ at: 'mirror-decode' }`, reason
  `'gate-confirm-never-rehydrated'`; undecodable entries audit `'malformed'`). The
  queue-side `rehydrate()` refusal remains as defense in depth for callers that
  bypass the mirror.
- **Gate-confirm root-binding** — `enqueueGateConfirm` records the same captured root
  as cli-change items (previously it recorded none); answering a confirm from a
  different workspace refuses `'workspace-changed'` with item and waiter retained. The
  remove-on-timeout still bounds a cross-root confirm's life. (Behavior delta, recorded:
  a pending confirm now survives a workspace switch for up to its 30s timeout, where the
  retired `clear()` denied it instantly on switch.)
- **Tray affordance (OQ-A option (a))** — foreign-root items (capturedRoot ≠ active
  root, mirrored renderer-side by `isForeignRoot` in `approvals-store.ts` against the
  `workspace:current` root) display a root label and a "Switch to <root> to resolve"
  action that routes through the ONE full-switch path (`te:open-vault` →
  `workspace.open()`); Approve/Reject are not offered on foreign items. No new IPC was
  minted — the existing `workspace:open` invoke suffices. Copy stays inside the §4
  framing: the writes are already on disk; nothing is phrased as blocked.

### Notifications + converged confirm surfaces (Phase 3 step 2, v1.3.1)

The "with notifications" half of the queue line, plus convergence of both non-CLI
approval surfaces onto the queue — ONE review surface.

- **Notification honesty rule** — the `ApprovalsTray.tsx:4-7` header rule extends to
  every OS surface: notification copy never phrases the queue as write-blocking.
  Queued cli-changes are "already on disk, awaiting your review"; gate confirms are
  "awaiting confirmation" — never "blocked"/"prevented". Pinned by a copy-lint test
  over every notifier string (`approvals-notifier.test.ts`).
- **Attention policy (recorded product decision — do not re-litigate):**

  | class                            | notifies                                                                                                       |
  | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
  | interactive-session queue item   | only while the window is unfocused                                                                               |
  | loop-context queue item          | ALWAYS (class reserved now; the signal arrives with the step-6 scheduler via `ApprovalsAddedItem.loopContext`)   |
  | breaker trip                     | ALWAYS                                                                                                           |
  | watcher-health `down` transition | ALWAYS (transitions only, not every failed retry in a down window)                                               |
  | maxSpendUsd / disarm             | ALWAYS (reserved; events arrive steps 6–7)                                                                       |
  | mirror-persist failure           | ALWAYS, once per failure streak (the step-1 "swallowed persist failures" residual, closed)                       |

  The dock badge always reflects the pending count regardless of focus. Clicking a
  notification focuses the window and opens the tray (`approvals:open-tray`).
  Delivery is best-effort: a notification failure never fails the queue mutation or
  health transition that triggered it.
- **Delta notify** — `ApprovalQueueDeps.notify` fires with `(pending, added)`; the
  added-items delta is computed at the queue's single mutation choke point
  (`notifyChanged`), so notifications fire once per genuinely-new item and NEVER on
  resolves, flag merges, or coalesces into an existing turn item. Rehydrated items
  count as new to the app run (deliberate: a relaunch re-surfaces pending reviews).
- **Converged-surface rule** — MCP write confirms and native-agent tool holds both
  resolve THROUGH the queue; neither owns a divergent modal surface:
  - MCP: `mcp-lifecycle` builds `QueueHitlGate` over the queue via the late-bound
    `setMcpApprovalQueueProvider` seam (wired in `registerGitIpc`, the
    setGateHealthProbe pattern), replacing `TimeoutHitlGate(ElectronHitlGate)`. The
    gate keeps the 30s fail-closed remove-on-timeout (OQ-B, decided) — the queue owns
    the timeout, no wrapper. Fail-closed floor: an unwired provider DENIES (pinned
    test) — broken wiring degrades to denial, never to a divergent dialog.
  - Native: `tool_pending_approval` holds mirror to gate-confirm rows
    (`enqueueGateHold` — NO auto-deny timer; the hold's own surface bounds its life,
    run abort included). **Single resolution authority:** the context.ts approvals
    map — the resolver is deleted before it is invoked, so resolving from either
    surface (tray row or chat diff card) lands exactly once (double-resolve pinned
    in both orders); a hold settled on the native surface releases its row with one
    `approvals:hold-released` audit entry. Mirror rows are gate-confirm kind: never
    serialized (pinned invariant unchanged).

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
  watcher-only rebuild that never clears the queue — a crash recovery that cleared it
  would silently drop captured-but-unreviewed writes. (v1.3.0: this rule now holds on
  EVERY path — `ApprovalQueue.clear()` is removed and nothing clears the queue;
  root-binding on workspace switch is enforced per item at `resolve()`, not by a
  clear-on-init. See "Global queue scope" above.)
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

| Flag                  | Meaning                                          | Set where                                                         |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `degradedAttribution` | shell hooks absent; PTY-alive window attribution | `CliTurnRegistry.windowState` per match                           |
| `gateDegraded`        | turn opened while watcher state ∉ {watching}     | `turnStarted` via the gate-health probe                           |
| `attributionSuspect`  | agentId failed main-side binding validation      | `turnStarted`, from the IPC-boundary resolution (v1.2.2 — LANDED) |

### Attribution authority (Phase 2 step 3, v1.2.2)

Frontmatter-persisted `agent_id` was renderer/disk-supplied end-to-end, and
`<TE_DIR>/threads` is watcher-ignored by design — a one-line frontmatter edit silently
reassigned every future commit trailer and corrupted `revertAgent` scope. Main is now the
binding authority:

- **HarnessRunRegistry** (`src/main/services/harness-run-registry.ts`): a **write-once
  threadId→slug+adapter binding** (plus budgets and raw invocation when applicable),
  persisted under userData (`harness-bindings.json`, atomic
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
  into BOTH `cli-thread:spawn` and `cli-thread:input`): every request loads the main binding.
  An absent agentId on a truly unbound thread is the clean ad-hoc case; on a modern binding,
  main recovers the authoritative slug/template when identity matches and blocks when it
  does not. A forwarded agentId that
  is malformed, mismatches the thread's binding, arrives on an unbound thread, or cannot
  be resolved because the registry itself threw (reason `registry-error`)
  degrades to adapter identity + a `cli-agent:attribution-mismatch` audit entry
  (decision `denied`; mismatch includes the `boundSlug`) + the turn tagged
  `attributionSuspect` — flowing `turnStarted` → `ActiveTurnMatch` →
  `PendingChangeFlags` → tray chip exactly as `gateDegraded` does. Those legacy/slug
  attribution failures do not block the underlying ad-hoc turn. A positively known
  binding-adapter mismatch is different: it is refused before PTY input, because allowing
  it would execute a different CLI under a harness contract and can strand the bridge.
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
  it. Post-binding, forged slugs can no longer _enter_ trailers via Machina's own path;
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

The exact frontmatter keys are `name`, `description`, `adapter`, `permissionMode`,
`budgets`, and (raw only) `invocationTemplate`. Raw harnesses require a non-empty,
single-line invocation template containing a standalone literal `{prompt}` command word;
structured adapters forbid the field. The raw grammar rejects controls, DEL/C1 bytes,
lone UTF-16 surrogates, arithmetic/subscript contexts, unstable spacing/escapes,
interactive history expansion, unquoted literal arguments after the executable, and
compound shell syntax. The final executable is escaped so normal and slash-path aliases
cannot rewrite the observed command; same-named shell functions remain an explicit
shell-resolution caveat. The hand-rolled parser rejects duplicate/unknown keys and invalid
budget values. Generated frontmatter is parsed back and compared field-for-field before
creation, so multiline, comment-truncating, or injection-shaped user strings are rejected
rather than escaped into a different meaning.

`scope.json`: `{ goal, allowedGlobs, forbiddenGlobs, acceptance, rollback }` — the
curriculum 14.36 shape. The final `forbiddenGlobs` always contains
`HARNESS_PROTECTED_GLOBS` (verify.sh + rules.md under **both** `.machina/` and
`.machina-dev/` — TE_DIR flips per runtime, the on-disk contract must not). A template-only
request refuses a template missing any protected glob; it never silently repairs a broken
built-in. Presence of an `overrides` object — including `{}` — instead selects the
constructive path: shared draft assembly unions the protected globs into the effective
scope and then validates the final result. `AgentWriteWatcher` auto-rejects (and audits)
any pending change touching `verify.sh` regardless of contract — reachable only because
§4's watcher explicitly include-lists `<TE_DIR>/agents/**`. `verify.sh` also ships mode
`0o555` (defense-in-depth, not a boundary — a same-user shell can chmod it back).

**Corrections (adversarial pass):** the "indexed by knowledge capability, zero extra
wiring" claim was false — vault-watcher ignores the whole TE_DIR subtree, so `state.md`
never reaches the index. Phase 1 repo memory is **prompt-composition only** (state.md is
read and injected into the agent prompt); indexing is deferred, with un-ignoring the
agents subtree as the future path. `scope.json` is advisory in Phase 1: nothing on the CLI
write path enforces globs — the watcher's auto-reject and the queue are the only teeth,
and UI copy must not imply more.

### Template gallery + blank builder (Phase 2 step 8, v1.2.8)

OQ7 is **RESOLVED by Casey 2026-07-09** with one frozen, shared registry in this exact
order. Category and audience are contract metadata used by the gallery filters, not
free-form display strings:

| Category     | Template                 | Audience                                         | Adapter / setup              | Purpose                                                                        |
| ------------ | ------------------------ | ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| Guided       | `idea-to-spec`           | non-engineer, low-code-user                      | claude                       | Turns a plain-language product idea into one buildable requirements brief.     |
| Guided       | `docs-maintainer`        | non-engineer, low-code-user, seasoned-programmer | claude                       | Reconciles one documentation gap against current repository evidence.          |
| Guided       | `automation-builder`     | low-code-user, seasoned-programmer               | codex                        | Builds one transparent shell or Make automation with a short runbook.          |
| Architecture | `architecture-mapper`    | systems-thinker, architect, seasoned-programmer  | claude                       | Maps one current system slice with evidence-linked boundaries and flows.       |
| Architecture | `boundary-auditor`       | systems-thinker, architect, seasoned-programmer  | codex                        | Performs a read-only boundary review and writes severity-ranked findings.      |
| Architecture | `migration-planner`      | systems-thinker, architect                       | claude                       | Designs one phased migration with compatibility, rollback, and evidence gates. |
| Engineering  | `bug-reproducer`         | seasoned-programmer                              | codex                        | Captures one minimal failing test for a reported defect without fixing it.     |
| Engineering  | `test-fixer`             | seasoned-programmer                              | claude                       | Runs the test suite, fixes the first failure, stops.                           |
| Engineering  | `vertical-slice-builder` | seasoned-programmer                              | codex                        | Implements one acceptance-tested feature slice without unrelated refactoring.  |
| Bridge       | `raw-tool-runner`        | seasoned-programmer, platform-builder            | raw / configuration required | Runs an explicitly configured unknown agent CLI through the raw PTY adapter.   |

The first nine entries are definition-complete creation candidates; one-click creation
only installs the role. Every run requires a dedicated task brief: trimmed non-empty text,
no NUL, at most 4,000 characters. Renderer validation happens before thread creation and
main repeats it before loading a binding mirror or reading harness files. The validated
brief is delimited in the prompt and cannot override rules or scope. `raw-tool-runner`
deliberately carries no fabricated executable command: its card opens the builder and
requires an invocation template, an operator-authored concrete scope rather than the
template's configuration sentinel, and a verifier. The blank builder and configurable-
card builder are reached from the visible thread-sidebar **New Agent** button or the
`New agent…` command-palette shortcut; both open the same gallery. They expose role text,
adapter, budgets, skill body, rules, scope, verifier, and raw
invocation when applicable. `permissionMode` is visible but immutable at
`'queue-all-writes'`.

Static `lintHarness` success proves contract shape only. Executable verifier fixtures prove
the roster's artifact presence and structure, staged/unstaged/untracked handling, stale
boundary-report rejection, and wrong-failure paths. Engineering gates prefer a Make `test`
target, then detect npm/pnpm/yarn/bun, Cargo, Go, or pytest/uv roots. npm/pnpm/yarn require
an explicit non-empty test script; missing pytest and other setup/discovery failures are
classified as infrastructure. Unsupported/missing runners fail closed and direct the
operator to a configured blank harness. The bug reproducer refuses simultaneous
product/dependency edits, targets exactly the changed test file where a safe runner exists,
rejects unrelated-suite/setup/load/build/hook failures as non-evidence, checks the working
tree again after execution, and kills timed-out child/grandchild process trees.

The creation wire shape is concrete and closed:

```ts
interface HarnessOverrides {
  description?: string
  adapter?: HarnessAdapter
  budgets?: HarnessBudgets
  invocationTemplate?: string
  skillBody?: string
  rules?: string
  scope?: HarnessScope
  verifyCommand?: string
  initialState?: string
}

type BlankHarnessOverrides =
  | {
      description: string
      adapter: 'raw'
      budgets: HarnessBudgets
      invocationTemplate: string
      skillBody: string
      rules: string
      scope: HarnessScope
      verifyCommand: string
      initialState?: string
    }
  | {
      description: string
      adapter: Exclude<HarnessAdapter, 'raw'>
      budgets: HarnessBudgets
      invocationTemplate?: never
      skillBody: string
      rules: string
      scope: HarnessScope
      verifyCommand: string
      initialState?: string
    }

type HarnessCreateRequest =
  | { template: string; slug: string; overrides?: HarnessOverrides }
  | { template?: undefined; slug: string; overrides: BlankHarnessOverrides }

interface HarnessRunRequest {
  slug: string
  threadId: string
  taskBrief: string
}
```

Request and override objects reject unknown keys at runtime. For a template request, every
present override replaces that template field atomically; `budgets` and `scope` are whole
field replacements, never deep merges. An absent field inherits. A blank request supplies
all required fields in `BlankHarnessOverrides`. A configuration-required template must
explicitly override `invocationTemplate`, `scope`, and `verifyCommand`. Effective budgets
must be finite integers: `maxTurns` is 1–100 and `maxWritesPerMinute` is 1–120.
Present-but-null or wrong-type fields are invalid; presence never silently means inherit.

`buildHarnessDraft(request, harnessDir)` is the one pure assembly function. It validates
the closed request, slug, complete effective fields, adapter/frontmatter rules, budgets,
scope, verifier command, and every candidate file; replaces every `<dir>` occurrence with
the materialized harness directory; wraps one non-empty, single-line `verifyCommand` in
`verify.sh`; rejects pipelines, command lists, background jobs, and command substitution
or POSIX `!` negation that could invert/mask an earlier red exit (required gates may use
`&&`); requires raw `{prompt}` placeholders to be standalone and unquoted/unescaped in one
hook-stable simple command; requires literal raw arguments to be quoted; validates the
final PTY command after prompt substitution; round-trips the generated frontmatter; and
runs the shared
content linter. The renderer uses that function only to preview the exact request and
disable create on errors. IPC sends the request, **not** a renderer-materialized draft.
Main rebuilds the candidate from the request, then writes only beneath the authoritative
active workspace; it trusts no renderer-provided file bytes. No directory is created until
all pure checks pass;
non-overwrite, canonical-path equality, write ordering, `verify.sh`-last mode `0o555`, and
bounded partial cleanup remain main-owned.

The two protected-scope paths are intentional. `overrides !== undefined`, including `{}`,
constructively unions `HARNESS_PROTECTED_GLOBS` before final validation; a caller that
omits them still receives a compliant scope. A template-only request has no constructive
signal, so a mutated built-in missing a protected glob is refused with nothing written.
This is creation-time contract integrity, not a wider security claim: `scope.json` remains
advisory at runtime, and CLI writes remain post-persistence containment by the watcher,
queue, and breaker.

Run creation preserves the same authority split. Main validates and normalizes the
operator task before filesystem or binding work, then performs one inspection that rejects
symlink/non-regular required entries and returns both diagnostics and the exact bytes used
for prompt composition. It records a write-once `HarnessBinding` containing slug,
authoritative adapter, budget snapshot, and raw-only invocation snapshot. A same-slug
re-record never refreshes those snapshots; valid data persists in the userData mirror,
while legacy/corrupt adapter or invocation data degrades without harness attribution or
raw-send readiness. The renderer cannot supply or replace them on `cli-thread:input`. A
harness launch also targets its first prompt explicitly: the task dialog supplies
`taskBrief`; `runHarness` creates the thread, asks main to compose/bind the run, verifies
main's returned adapter matches the created PTY, associates the agent, waits for the shell
prompt, then calls `appendUserMessage(prompt, threadId)`. Non-cancelling IPC timeouts
return `indeterminate`, keep late settlements attached, replay Stop onto a late native run
id, and keep sending blocked until a main-originated completion/refusal settles the turn.
Thread delete/close tombstones stop late native/CLI work from resurrecting the thread;
workspace-generation checks prevent workspace A creates/saves from landing under
workspace B while preserving the Phase-1 no-auto-kill-on-switch decision. Changing the
selected thread during that wait cannot retarget transport or persistence; ordinary
interactive sends may continue to omit the explicit id and follow the active thread. The
main binding read exposes only slug, authoritative adapter, and raw-send readiness, never
the invocation template. `HarnessSummary.scope` is the parsed effective on-disk contract
for launch copy;
template defaults are never substituted for an installed override, and the UI must call
the scope advisory rather than an enforced sandbox.

### Harness linter (Phase 2 step 7, v1.2.4)

Everything create-time validation cannot see is the linter's job: it re-validates an
on-disk scope after hand edits, rejects empty core contract content and an unusable
verifier, reports verify.sh mode/presence drift, and prevents malformed harnesses from
vanishing from the palette silently.

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
  does not feed the breaker — the turn is over and the PTY idle). NOTICE
  class since v1.2.7 (negative rule 3): never a kill on its own — the
  episode escalates only on a later kill-class signal;
- **max-turns** = invocation count exceeded the bound budget (surfaced by
  `CliTurnRegistry.onTurnStarted` → `checkMaxTurnsOnTurnStarted` in
  ipc/cli-thread.ts, deferred past the in-flight send; since v1.2.7 the
  listener awaits `ensureRootReady` so the budget lookup never reads an
  unloaded mirror).

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
healthy agents — and health is never a SUPPRESSOR either: threshold-reaching
signals still trip while degraded (v1.2.7 companion pin). (2) It NEVER
auto-kills on signals from writes flagged `concurrentTurns` — ambiguous
attribution could kill the wrong agent; the trip degrades to a tray notice
(`action: 'notice'`, audited decision `error`, kill left manual); a later
unambiguous signal may escalate to the one kill. (3) It NEVER kills on a
bare headMoved signal (v1.2.7, orchestrator decision): the user's own
`git commit`/`pull`/`checkout` during a writing turn is indistinguishable
from agent git activity, so headMoved joins the notice-latch class — notice

- audit + tray row on the first signal, escalation to the single kill only
  on a later unambiguous kill-class signal in the same episode. The watcher's
  head-moved audit entry and the queue's `headMoved` flag are unchanged.

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
'harness:create':        { request: HarnessCreateRequest // v1.2.8 — template + atomic overrides OR complete blank request; main rebuilds the draft
                           response: { ok: true; root: string } | { ok: false; error: string } } // Result-style: duplicate/invalid slug are expected failures
'harness:list':          { request: void; response: HarnessSummary[] }
'harness:run':           { request: HarnessRunRequest // v1.2.8 — required validated task + main-side composition; records the write-once binding
                           response: { ok: true; prompt: string; adapter: HarnessAdapter } | { ok: false; error: string } }
'harness:binding':       { request: { threadId: string }; response: { slug: string; adapter: HarnessAdapter | null; rawInvocationReady: boolean } | null } // v1.2.8 — authority/readiness only; never exposes the raw command
'approvals:list':        { request: void; response: PendingChange[] }
'approvals:resolve':     { request: { id: string; approve: boolean; message?: string }; response: GitOpResult }
'approvals:watcher-status': { request: void; response: WatcherHealth } // v1.2.1 — pull mirror for late subscribers
'approvals:watcher-retry':  { request: void; response: GitOpResult }  // v1.2.1 — manual restart; resets the backoff cap
'harness:lint':          { request: { slug: string }; response: Diagnostic[] } // v1.2.4 — on-demand re-lint; no workspace ⇒ [] (list semantics). harness:list summaries carry the same diagnostics (+ adapter widened to HarnessAdapter | null)
// IpcEvents
'approvals:changed':     { pending: number; added: ApprovalsAddedItem[] } // v1.3.1 — item delta (added ids + agent/root labels), computed at the queue's mutation choke point; empty on resolves so notifiers fire once per genuinely-new item
'approvals:watcher-health': WatcherHealth // v1.2.1 — health transitions (tray badge/banner, thread chip)
'cli-thread:get-session': { request: { threadId: string }; response: { sessionId: string; live: boolean } | null } // v1.2.3 — pull mirror of the spawner binding (invoke, not an event; appended per the parallel-session rule)
// IpcEvents (v1.2.3)
'cli-thread:session-changed': { threadId: string; sessionId: string } // v1.2.3 — spawn-on-demand respawn rebinding; feeds cli-session-store
'git:list-agent-commits': { request: void; response: AgentCommitsResult } // v1.2.5 — read path for the revert UI; null root ⇒ { ok:false, reason:'no-workspace' }, non-repo ⇒ 'not-a-git-repo' (the tray renders the honest "nothing to revert from" state, never a false empty); v1.2.7 — git-log failure ⇒ 'git-failed' (a failure is never rendered as the empty state either)
'agent:breaker-status':  { request: void; response: AgentBreakerStatus } // v1.2.6 — pull mirror of tripped breakers + signalsDegraded (tray notice rows, kill-switch chip)
// IpcEvents (v1.2.6)
'agent:breaker-tripped': BreakerTripEvent // v1.2.6 — trip broadcast: action 'killed' (containment applied) or 'notice' (concurrentTurns ambiguity, kill left manual)
// IpcEvents (v1.3.1)
'approvals:open-tray':   Record<string, never> // v1.3.1 — OS-notification click-to-focus landing: main focuses the window then fires this so the tray popover opens
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

| Phase 1 step               | Contracts consumed                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 Workspace generalization | §1 (+ `vault.*`→`workspace.*` MCP aliases, audit §2)                                             |
| 2 Git substrate            | §2 full GitService + ApprovalQueue + §6 git/approvals channels (queue empty until step 3)        |
| 3 Gate parity              | §4 (CliTurnRegistry, AgentWriteWatcher, QueueHitlGate, tray) + §2 per-turn snapshot in `input()` |
| 4 Dock IDE shell           | §3 projection (existing seam only; independent of 2–3, may land in parallel after 1)             |
| 5 Retire snapshot          | §2/§4 never-regress rule — evidence gate (G1–G8), no new interface                               |
| 6 test-fixer template      | §5 folder schema + §6 harness channels + agentId(slug) → turn registry → trailers                |

Implementation detail per step: `02-phase-1-specs.md`.

## 8. Contract changelog

- **v1.3.1 (2026-07-14, Phase 3 step 2 landed)** —
  notifications + propose-surface convergence. §4 gains the "Notifications +
  converged confirm surfaces" subsection: the notification honesty rule (the
  `ApprovalsTray.tsx:4-7` header rule extended to OS surfaces, pinned by a copy-lint
  test), the recorded attention-policy table (interactive queue items notify only
  unfocused; loop-context [reserved for step 6 via `ApprovalsAddedItem.loopContext`],
  breaker trips, watcher-down transitions, spend/disarm [reserved], and
  mirror-persist failures ALWAYS notify; dock badge always tracks the pending count;
  click focuses + opens the tray), and the converged-surface rule — MCP confirms ride
  `QueueHitlGate` over the queue (late-bound `setMcpApprovalQueueProvider` seam, 30s
  fail-closed kept per OQ-B, unwired-provider denies) and native
  `tool_pending_approval` holds mirror to gate-confirm rows (`enqueueGateHold`, no
  auto-deny timer; single resolution authority = the context.ts approvals map;
  double-resolve pinned in both orders; `approvals:hold-released` audit on
  native-side settlement; never serialized, invariant unchanged). §6:
  `approvals:changed` payload gains the `added` item delta (computed at the queue's
  single mutation choke point — empty on resolves); new `approvals:open-tray` event
  (appended). The step-1 swallowed-mirror-persist-failure residual is closed via the
  persistence-degraded notification class.
- **v1.3.0 (2026-07-14, Phase 3 step 1 landed)** —
  the structural bump: §4 queue scope contract rewritten (new subsection; the v1.2.1
  restart-preserves-queue bullet reconciled in place — its "clear-on-init stays
  load-bearing" clause was superseded). The approval
  queue is genuinely global — ONE queue, multi-root: `initApprovalsForRoot` no longer
  clears it on workspace switch (`ApprovalQueue.clear()` removed outright: zero callers
  remained and its denial copy contradicted the multi-root contract), and cli-change
  items persist to `<userData>/approval-queue.json` (versioned shape, atomic persist
  chain, degrade-not-fail load) with one-shot rehydrate-revalidate per app run — each
  restored item re-diffed against its own capturedRoot; any drift/unverifiability drops
  it with an `approvals:rehydrate-drop` audit entry, never a silent keep or resolve. The
  resolution invariant is deliberately UNWEAKENED and its evidence lands in this same
  commit (safety-invariant gate): visibility is cross-root, resolution never is —
  `resolve()` still refuses `'workspace-changed'` on a capturedRoot mismatch, now for
  gate-confirm items too (`enqueueGateConfirm` gains the same captured-root discipline;
  item + waiter retained on refusal, 30s remove-on-timeout still bounds a cross-root
  confirm). Gate-confirm items are NEVER serialized (live Promise waiters; a rehydrated
  confirm is an unanswerable zombie row) — mandatory in this commit, not a refinement.
  `PendingChange` gains `capturedRoot?: string | null` (display/persistence data;
  enforcement stays main-side). Tray: root labels + the OQ-A option (a) "switch to
  workspace X to resolve" affordance on foreign-root items via the one full-switch path
  (`te:open-vault` → `workspace.open()`); Approve/Reject withheld there; no new IPC
  minted (§6 unchanged). Copy honesty preserved throughout — queued for review, never
  blocked. **Pre-landing adversarial-review hardening (same commit):** (a) capture
  binds to the CAPTURING root — `recordWrites` takes the watcher's own root and
  `autoReject`'s failed-discard fallback binds to its entry root, so a batch flushing
  after a workspace switch (or a discard rejecting mid-switch) can never mint an item
  whose capturedRoot names the new root over old-root paths; cross-root coalescing is
  refused + audited (`approvals:record-refused`, `'captured-root-mismatch'`). (b)
  Turn ids are run-unique (`t<seq>-<random run tag>`) so a rehydrated `pc_<turnId>`
  can never collide with — and be silently rebound by — a new run's turn. (c)
  Decode-level mirror drops are audited through `ipc/git.ts` (`approvals:rehydrate-
  drop`, `{ at: 'mirror-decode' }`, reasons `'gate-confirm-never-rehydrated'` /
  `'malformed'`); the earlier claim that the smuggled-confirm audit happened inside
  `rehydrate()` was unreachable in the production pipeline. (d) A fresh rehydrate
  diff carrying the §2 `[diff unavailable]` marker counts as `'diff-failed'` (marker
  equality is not verification); the marker prefix + `isDiffUnavailable` predicate
  moved to shared `git-types.ts` so builder and detector cannot drift.
- **v1.2.8 (2026-07-10, Phase 2 step 8 landed)** —
  OQ7 RESOLVED by Casey with the exact ten-template registry across Guided,
  Architecture, Engineering, and Bridge plus the six audience tags recorded in §5;
  `raw-tool-runner` is the sole configuration-required card and never fabricates an
  executable. §5/§6 define the closed `HarnessCreateRequest` union, complete blank
  request, field-atomic overrides, hard budget bounds, raw-vs-structured frontmatter
  rules, exact parse/serialize round-trip, and the intentional protected-scope split:
  overrides-present (even `{}`) constructively unions protected globs, while a
  template-only mutation refuses with nothing written. Renderer preview and main creation
  share the pure draft builder, but IPC carries only the request and main authoritatively
  rebuilds all file bytes. One main inspection rejects redirected required entries and
  supplies the exact lint/prompt/binding snapshot. Adapter and raw invocation are main-read
  and snapshotted in the write-once binding; identity mismatch fails closed. Raw templates
  require standalone unquoted placeholders in one hook-stable simple command, reject
  controls/surrogates/alias-prone literal args, and validate the final PTY command. The
  adapter-aware bridge admits only the registered byte-exact command, PTY queue refusal
  rolls the marker and turn back, and one block identity survives every terminal state.
  Ad-hoc raw remains structured-input-disabled; bound raw harnesses are the sole structured
  raw-send path. Every run requires a main-revalidated, bounded task brief; the prompt
  delimits it below rules/scope authority, and harness launch explicitly targets its created
  thread after the shell-prompt wait. The launch surface reads effective on-disk scope from
  `HarnessSummary`, never catalog defaults. Runtime scope remains advisory and write
  containment remains post-persistence. Non-cancelling dispatch timeouts are
  indeterminate; late settlements remain attached, Stop is replayed when possible, and
  workspace switches fence stale state without auto-killing PTYs. Executable verifier
  fixtures cover artifact, symlink, wrong-failure semantics, exact bug-reproducer
  targeting, post-run dirty guards, and process-tree timeout cleanup. Automated gates are
  green as of 2026-07-10 (`npm run check`, build, full E2E, targeted visible-gallery E2E,
  audit recorded). Casey accepted the previously pending timed/visual gate by direct
  landing instruction on 2026-07-10.
- **v1.2.7 (2026-07-07, post-merge review hardening — Phase 2 steps 5+6)** —
  fixes from the adversarial review of `24d53e1`, applied as one hardening
  pass (two fix agents: git surface + breaker seam).
  **Breaker/§5:** (1) headMoved DEGRADED from kill to the notice-latch class
  (**ORCHESTRATOR DECISION**, recorded as such): a bare unexcused HEAD move
  during a writing turn is indistinguishable from the user's own
  `git commit`/`pull`/`checkout`, so it now produces notice + audit + tray
  row on the first signal and the episode escalates to its single kill only
  on a later unambiguous kill-class signal (velocity/forbidden/max-turns) —
  negative rule 3; "exactly one kill per episode" holds; the step-3
  head-moved audit entry and queue flag are unchanged; named negative test:
  single window, unexcused HEAD move, NO kill. (2) Budget enforcement no
  longer disengages on an unloaded bindings mirror: the turn-start listener
  awaits `HarnessRunRegistry.ensureRootReady(cwd)` before the budget lookup
  on EVERY turn open (still deferred past the in-flight send; registry
  errors degrade to unbound — never a blocked turn), and
  `initApprovalsForRoot` loads the mirror before the watcher starts so the
  synchronous `getWriteBudget` reads are covered too. (3) Test hardening:
  the maxTurns wiring is pinned BEHAVIORALLY through the real
  `registerCliThreadIpc` registration path against a real persisted mirror
  (deleting the `setTurnStartedListener` registration now fails the suite —
  mutation-verified), and the degraded-health rule gains its companion
  positive (threshold signals with an unhealthy probe still trip; health is
  honesty, never a suppressor — mutation-verified).
  **Git surface/§2/§6:** (4) `revertAgent` gains `onWillRevert(paths)` —
  fired with the union of to-be-touched paths BEFORE any tree change — and
  the `git:revert-agent` handler uses it to suppress the watcher's echo of
  the gate's own revert writes and excuses the revert commit sha on every
  open turn window via `CliTurnRegistry.noteGateCommitForRoot` (a
  root-scoped `noteQueueCommit`), so a tray revert during a live turn never
  trips the head-moved channel against a healthy agent. (5) `revertAgent`'s
  final commit is PATHSPEC-LIMITED to the reverted paths (commitApproved
  discipline): user-staged bystander files stay staged and untouched;
  `--allow-empty --only` keeps the net-zero and zero-paths marker-commit
  cases without sweeping the index (a bare `--` would). (6)
  `listAgentCommits` returns null on a failed git-log walk and
  `git:list-agent-commits` surfaces it as `{ ok:false, reason:'git-failed' }`
  — the v1.2.5 "never a false empty" rule now covers git failures, with
  honest RevertAgentSection copy. (7) `readTrailerLog` is injection-hardened:
  the Machina-Reverts field precedes the agent field (a `\x1f` smuggled into
  a trailer value can only push content AWAY from the exclusion set),
  exclusion-set tokens must be full 40-hex shas, and listed agent ids must
  pass SAFE_ID_RE (closing the listed-but-unrevertable asymmetry); the
  `%s`-last subject rejoin is now test-pinned. (8) **Turn attribution is
  PATH identity, not string identity** (§4 `CliTurnRegistry`): `isInside`
  realpath-canonicalizes both sides (memoized) before comparing. The
  watcher roots at the canonical workspace path (WorkspaceService
  realpaths: `/var/...` → `/private/var/...` on macOS), but the per-turn
  cwd arrives from the caller verbatim — a symlink-aliased cwd silently
  detached every turn window from the watcher root, routing ALL agent
  writes to "outside any turn window": no queue capture, no
  velocity/forbidden signals, no breaker coverage (root cause of the
  velocity-breaker e2e failure, diagnosed from the audit log). Same rule on
  `noteGateCommitForRoot`, so revert-sha excusal reaches alias-cwd windows.
  `e2e/agent-breaker.spec.ts` deliberately keeps its un-realpathed tmpdir
  root as the regression probe. **E2E probe fix (recorded):**
  `e2e/agent-breaker.spec.ts`'s dead-PTY polls coerced the post-kill null
  session to "alive" (`?.live ?? true`) and could never observe a kill —
  probe defect, not product: `spawner.close` unbinds the session, so
  get-session null IS the dead state; the predicates now treat it as such.
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
  installed-binary check and opens a plain PTY. Ad-hoc raw keeps the honest
  no-structured-view copy with sending disabled; v1.2.8 adds a distinct bound-harness
  route whose main-owned invocation snapshot is required before a structured raw send
  (OQ3).

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
