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
outside `.machina/` or an existing `.machina/` vault config; `coding` when the root
contains `.git/` or a recognized manifest (`package.json`, `Cargo.toml`, `pyproject.toml`,
`go.mod`). Both may be true; the knowledge capability toggle (Q5/Q13) reads this.

Migration: `vault:init` delegates to `WorkspaceService.open` and stays as an alias for one
release; `lastVaultPath` config key is renamed `lastWorkspacePath` with a one-time read
fallback (3 production sites, audit §2). PathGuard's API is untouched — only its
construction moves.

## 2. Git service (main process)

`src/main/services/vault-git.ts` grows into `git-service.ts`, keeping its style:
`execFileSync` with `GIT_TIMEOUT_MS`, structured no-op results, never throws across the
service boundary, `.machina/no-auto-commit` opt-out respected.

```ts
// src/main/services/git-service.ts
export interface CommitApprovedOpts {
  readonly agentId: string // harness slug, or adapter id for ad-hoc threads
  readonly threadId: string
  readonly paths: readonly string[] // staged exactly; never `git add -A`
  readonly message: string // first line; trailers appended by the service
}

export type GitOpResult =
  | { readonly ok: true; readonly sha?: string }
  | { readonly ok: false; readonly reason: string }

export interface GitService {
  isRepo(root: string): boolean
  status(root: string): readonly { path: string; state: 'modified' | 'added' | 'deleted' }[]
  /** Unified diff for the given paths against HEAD (unstaged included). */
  diff(root: string, paths?: readonly string[]): string
  commitApproved(root: string, opts: CommitApprovedOpts): GitOpResult
  /** Revert every commit carrying the trailer, newest first, as one revert commit. */
  revertAgent(root: string, agentId: string): GitOpResult
  /** Restore paths to HEAD (reject flow). Tracked files only; new files are deleted. */
  discard(root: string, paths: readonly string[]): GitOpResult
}
```

**Attribution is by commit trailers, not refs** — this is what the plan's "tagged commits"
resolves to:

```
fix: correct off-by-one in retry loop

Machina-Agent: test-fixer
Machina-Session: th_9f2c41aa
```

Trailers survive rebase, `git log --grep='^Machina-Agent: test-fixer'` enumerates one
agent's commits for `revertAgent`, and the tag/branch namespaces stay clean.
`commitPreAgentSnapshot` (vault-git.ts:32) is unchanged and remains wired at spawn until
Phase 1 step 5 retires it. Interim hardening (cheap, before step 4): also call it per turn
in `CliThreadSpawner.sendUserMessage` to close the PTY-lifetime granularity gap found in
audit §3.

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
  /** Generalizes formatCliInvocation (cli-thread-spawner.ts:64-97) per adapter. */
  formatInvocation(prompt: string, opts: CliInvocationOptions): string
  /** Structured-event parser; absent = raw PTY projection only (gemini today). */
  parseEvent?(line: string): AgentStreamEvent | null
  readonly models?: readonly string[]
}
```

The adapter registry is a `Record<AdapterId, AgentAdapter>` in main; the existing
`formatCliInvocation` switch and the `cli-agent-thread-bridge` parser move behind it with
behavior identical for the three known CLIs. `CLI_AGENT_IDENTITIES` maps 1:1 onto
`AdapterId` minus `raw`.

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

## 4. Gate parity for CLI agents (the load-bearing contract)

CLI children write to disk directly (audit §3); in-process interception is impossible.
Parity is **post-hoc, before persistence is blessed**:

```
CLI turn in flight (bridge knows in-flight per thread)
  → AgentWriteWatcher attributes workspace-root fs events to that thread
  → PendingChange { threadId, agentId, paths, diff (GitService.diff) }
  → approval queue (renderer)
      approve → GitService.commitApproved (trailers) → AuditLogger entry
      reject  → GitService.discard(paths)            → AuditLogger entry
```

```ts
// src/main/services/agent-write-watcher.ts
export interface PendingChange {
  readonly id: string
  readonly threadId: string
  readonly agentId: string
  readonly paths: readonly string[]
  readonly capturedAt: string
}
```

Contract points:

- **Attribution window**: fs events are attributed to a thread only while its invocation is
  in flight (`CliAgentThreadBridge` already tracks this per thread). Concurrent user edits
  during an agent turn are a known ambiguity — the diff review surface shows them and the
  human decides; no heuristics.
- **Watcher reuse**: same chokidar + batching pattern as `vault-watcher.ts`; ignores
  `.git/` and honors `gitignore-filter.ts`.
- **Gate reuse**: the queue is a `HitlGate` implementation (`QueueHitlGate implements
  HitlGate`, `hitl-gate.ts:22`), so the native agent and MCP writes can converge on the
  same queue UI later without a second approval model. `WriteRateLimiter` runs per thread
  to flag high-velocity turns in the queue exactly as it flags MCP writes today.
- **Scope limits, stated honestly**: post-hoc watching sees only the workspace root.
  Out-of-root writes by a CLI child are invisible to Machina and remain at the user's OS
  trust level — unchanged from today, documented in the queue UI. Adapter-native hooks
  (Claude Code `--permission-prompt-tool` routed into `HitlGate`) are the Phase 2+ upgrade
  that closes this per adapter.
- **Never-regress rule**: `commitPreAgentSnapshot` stays wired until approve/reject +
  `revertAgent` are proven on a real repo (Phase 1 step 5 exit evidence).

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
curriculum 14.36 shape. `forbiddenGlobs` always contains `.machina/agents/*/verify.sh` and
`.machina/agents/*/rules.md`; the harness generator refuses to emit a contract without
them, and `AgentWriteWatcher` auto-rejects (and audits) any pending change touching
`verify.sh` regardless of contract.

## 6. IPC channels (names reserved; registration follows the 4-step pattern)

New namespaces `workspace`, `git`, `approvals`, `harness` in `IpcChannels`/`IpcEvents`:

```ts
'workspace:open':        { request: { path: string }; response: Workspace }
'workspace:current':     { request: void; response: Workspace | null }
'git:status':            { request: void; response: GitStatusEntry[] }
'git:diff':              { request: { paths?: string[] }; response: string }
'git:commit-approved':   { request: CommitApprovedOpts; response: GitOpResult }
'git:revert-agent':      { request: { agentId: string }; response: GitOpResult }
'harness:create':        { request: { template: string; slug: string }; response: { root: string } }
'harness:list':          { request: void; response: HarnessSummary[] }
'approvals:list':        { request: void; response: PendingChange[] }
'approvals:resolve':     { request: { id: string; approve: boolean }; response: GitOpResult }
// IpcEvents
'approvals:changed':     { pending: number }
```

Git channels take no `root` — main resolves it from `WorkspaceService.current()`, so the
renderer can never point git at an arbitrary path.

**Sequencing constraint** (audit §5): `src/shared/ipc-channels.ts`, `src/preload/index.ts`,
and `src/main/index.ts` are owned by production-grade-plan item 1.9 during its Wave 1. The
channel registrations above land after 1.9, or rebase over it.

## 7. Phase 1 step ↔ contract map

| Phase 1 step | Contracts consumed |
| --- | --- |
| 1 Workspace generalization | §1 (+ `vault.*`→`workspace.*` MCP aliases, audit §2) |
| 2 Gate parity | §4 (watcher, queue, audit) + §2 interim per-turn snapshot |
| 3 Dock IDE shell | §3 projection (existing seam only) |
| 4 Commit-per-approval | §2 (`commitApproved`, trailers) + §6 git/approvals channels |
| 5 Retire snapshot | §2 never-regress rule — evidence gate, no new interface |
| 6 test-fixer template | §5 folder schema + §6 harness channels |
