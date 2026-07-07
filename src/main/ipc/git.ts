/**
 * Git substrate + approval queue IPC (workstation contracts §2/§4/§6, v1.1).
 *
 * None of these channels take a `root`: main resolves it from
 * `WorkspaceService.current()` so the renderer can never point git at an
 * arbitrary path. Before a workspace is open, handlers return structured
 * errors / safe empty results — nothing throws across the boundary.
 */
import { app, shell } from 'electron'
import { join } from 'path'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { getWorkspaceService } from '../services/workspace-service'
import { ApprovalQueue } from '../services/approval-queue'
import { AgentWriteWatcher } from '../services/agent-write-watcher'
import { AuditLogger } from '../services/audit-logger'
import {
  getCliTurnRegistry,
  isAgentHeadMove,
  setGateHealthProbe
} from '../services/cli-turn-registry'
import {
  getAgentCircuitBreaker,
  setBreakerSignalHealthProbe
} from '../services/agent-circuit-breaker'
import { getHarnessRunRegistry } from '../services/harness-run-registry'
import {
  commitApproved,
  commitsBetween,
  diff,
  discard,
  headSha,
  ignoredUntracked,
  isGitRepo,
  listAgentCommits,
  revertAgent,
  status
} from '../services/git-service'
import { getDocumentManager } from './documents'
import type { GitOpResult, WatcherHealth, WatcherState } from '@shared/git-types'

const NO_WORKSPACE: GitOpResult = { ok: false, reason: 'no-workspace' }
/** A newer restart/switch owns the watcher; the caller's attempt is moot. */
const WATCHER_SUPERSEDED: GitOpResult = { ok: false, reason: 'watcher-restart-superseded' }

function currentRoot(): string | null {
  return getWorkspaceService().current()?.root ?? null
}

function broadcastApprovalsChanged(pending: number): void {
  const window = getMainWindow()
  if (window) typedSend(window, 'approvals:changed', { pending })
}

let approvalQueue: ApprovalQueue | null = null
let auditLogger: AuditLogger | null = null
let agentWriteWatcher: AgentWriteWatcher | null = null

/**
 * The one AuditLogger, shared by the queue and the agent write watcher. It
 * lives under `userData/audit` — outside any workspace watch root, so audit
 * writes never self-trigger the watcher.
 */
function getAuditLogger(): AuditLogger {
  if (auditLogger === null) {
    auditLogger = new AuditLogger(join(app.getPath('userData'), 'audit'))
  }
  return auditLogger
}

/**
 * Lazy singleton so step 3 (gate parity) can wire the watcher/registry to the
 * same queue the IPC handlers serve.
 */
export function getApprovalQueue(): ApprovalQueue {
  if (approvalQueue === null) {
    const audit = getAuditLogger()
    approvalQueue = new ApprovalQueue({
      git: {
        isRepo: isGitRepo,
        diff,
        commitApproved: (root, opts) => {
          const result = commitApproved(root, opts)
          // Record the queue's own commit sha against the thread's turn. The
          // tripwire baseline stays immutable — rebaselining would erase
          // evidence of an agent commit made BEFORE this approval — and the
          // rev-list walk in isAgentHeadMove excuses exactly these shas.
          if (result.ok && result.sha !== undefined) {
            getCliTurnRegistry().noteQueueCommit(opts.threadId, result.sha)
          }
          return result
        },
        // Recoverable deletion: untracked rejects go to the OS trash, not rm.
        // The watcher must not see the gate's own revert as a fresh agent
        // write — suppress the paths before touching the tree.
        discard: (root, paths) => {
          agentWriteWatcher?.suppress(paths)
          return discard(root, paths, (absPath) => shell.trashItem(absPath))
        },
        ignoredUntracked
      },
      audit,
      getRoot: currentRoot,
      notify: broadcastApprovalsChanged
    })
  }
  return approvalQueue
}

/**
 * End-of-turn half of the headMoved tripwire (contracts §4: HEAD captured at
 * turn start vs turn END). The watcher only compares on write batches, so an
 * agent whose LAST action is `git commit` would otherwise escape — commits
 * touch only `.git/**`, which the watcher prunes. Called from the bridge's
 * onTurnComplete wiring with the turn `turnEnded` just closed.
 */
export function checkHeadMovedAtTurnEnd(turn: {
  readonly turnId: string
  readonly threadId: string
  readonly agentId: string
  readonly cwd: string
  readonly headShaAtStart: string | null
  readonly queueCommitShas: readonly string[]
}): void {
  const headNow = headSha(turn.cwd)
  if (!isAgentHeadMove(turn, headNow, commitsBetween)) return
  getAuditLogger().log({
    ts: new Date().toISOString(),
    tool: 'cli-agent:head-moved',
    args: {
      turnId: turn.turnId,
      threadId: turn.threadId,
      agentId: turn.agentId,
      headShaAtStart: turn.headShaAtStart,
      headShaNow: headNow,
      at: 'turn-end'
    },
    affectedPaths: [],
    decision: 'error',
    error: 'git HEAD moved during agent turn'
  })
  // Merge the flag into the turn's item when one exists; a turn that ONLY
  // self-committed has no item, and the audit entry above is its record.
  getApprovalQueue().flagExisting(turn.turnId, { headMoved: true })
}

/**
 * (Re)bind the approvals surface to a workspace root (workstation step 3):
 * stop the old agent write watcher, clear the queue (items are
 * workspace-root-bound — resolving them against a new root is forbidden by
 * contract), and start a fresh watcher at `root`. Called from
 * reconfigureForVault on every workspace open.
 */
// ── Watcher health + restart with backoff (step 2, contracts §4 v1.2.1) ────

/** Backoff before automatic restarts; the last delay repeats up to the cap. */
const WATCHER_RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const
/** Failed automatic restarts before down-until-manual (tray Retry resets). */
const WATCHER_RETRY_CAP = 5

let watcherHealth: WatcherHealth = {
  state: 'stopped',
  since: new Date().toISOString(),
  attempts: 0
}
/** Root the watcher is (or should be) bound to — restartWatcher's target. */
let watcherRoot: string | null = null
/**
 * Guards in-flight restarts against overlap (contracts §4 v1.2.1).
 * cancelWatcherRetry only clears a PENDING timer — a restart already awaiting
 * stop()/start() keeps running through a workspace switch or manual Retry.
 * Unguarded, the loser of that race rebinds a watcher to the dead old root
 * (orphaning the live new one) or flips a recovered 'watching' state back to
 * 'down' up to 30s later. Bumped by stopApprovals, initApprovalsForRoot, and
 * every restartWatcher entry; an in-flight restart revalidates after each
 * await and aborts when superseded.
 */
let watcherGeneration = 0
let watcherRetryTimer: ReturnType<typeof setTimeout> | null = null
/** Failed restarts in the current backoff cycle; reset on recovery/manual retry. */
let watcherRetryAttempts = 0
/** When the current coverage gap opened — the recovery audit entry's evidence. */
let watcherDownSince: string | null = null

export function getWatcherHealth(): WatcherHealth {
  return watcherHealth
}

function setWatcherHealth(state: WatcherState, reason?: string): void {
  watcherHealth = {
    state,
    since: new Date().toISOString(),
    attempts: watcherRetryAttempts,
    ...(reason === undefined ? {} : { reason })
  }
  const window = getMainWindow()
  if (window) typedSend(window, 'approvals:watcher-health', watcherHealth)
}

function cancelWatcherRetry(): void {
  if (watcherRetryTimer !== null) {
    clearTimeout(watcherRetryTimer)
    watcherRetryTimer = null
  }
}

function scheduleWatcherRetry(): void {
  if (watcherRetryTimer !== null || watcherRoot === null) return
  if (watcherRetryAttempts >= WATCHER_RETRY_CAP) return // down until manual Retry
  const delay =
    WATCHER_RETRY_DELAYS_MS[Math.min(watcherRetryAttempts, WATCHER_RETRY_DELAYS_MS.length - 1)]
  watcherRetryTimer = setTimeout(() => {
    watcherRetryTimer = null
    void restartWatcher()
  }, delay)
}

/**
 * The gate is down but the workspace stays live (OQ6: visibly degrade, never
 * block). Broadcasts the state and arms the backoff restart. Exported for
 * main/index.ts's init-failure catch.
 */
export function markApprovalsWatcherDown(reason: string): void {
  if (watcherDownSince === null) watcherDownSince = new Date().toISOString()
  setWatcherHealth('down', reason)
  scheduleWatcherRetry()
}

/**
 * Reset the backoff cycle and, when a coverage gap just closed, write the §4
 * recovery audit entry: escapes are logged, never silent — writes landing
 * while the watcher was down were captured by NOTHING, and this entry is the
 * durable record of that window.
 */
function noteWatcherRecovered(): void {
  const gapStartedAt = watcherDownSince
  watcherRetryAttempts = 0
  if (gapStartedAt === null) return
  watcherDownSince = null
  getAuditLogger().log({
    ts: new Date().toISOString(),
    tool: 'approvals:watcher-recovered',
    args: { gapStartedAt, gapEndedAt: new Date().toISOString() },
    affectedPaths: [],
    decision: 'error',
    error:
      'agent-write watcher was down during this window; agent writes in the gap were not captured for review'
  })
}

function buildWatcher(root: string): AgentWriteWatcher {
  const watcher: AgentWriteWatcher = new AgentWriteWatcher({
    root,
    registry: getCliTurnRegistry(),
    queue: getApprovalQueue(),
    audit: getAuditLogger(),
    // Self-write suppression: user autosaves during a turn must not be
    // misattributed to the agent (timing race accepted per contracts §4).
    isSelfWrite: (absPath) => getDocumentManager().hasPendingWrite(absPath),
    headSha,
    commitsBetween,
    // Step 6 (contracts §5 v1.2.6): per-thread limiter threshold from the
    // bound harness's bind-time budgets snapshot. In-memory registry read —
    // initApprovalsForRoot loads the mirror before the watcher starts and
    // the turn-start listener (ipc/cli-thread.ts) re-guarantees it on every
    // turn open (v1.2.7); an unloaded/unbound thread reads undefined and
    // the watcher applies the default.
    getWriteBudget: (threadId) =>
      getHarnessRunRegistry().get(root, threadId)?.budgets?.maxWritesPerMinute,
    // Step 6: escalation port — velocity / forbidden / headMoved signals
    // flow to the circuit breaker (kill + audit + event on trip).
    breaker: getAgentCircuitBreaker(),
    onHealthChange: (state, reason) => {
      // A superseded instance (replaced by a newer restart or workspace
      // switch) must not steer the shared health state — its late 'stopped'/
      // 'watching'/'down' emissions would clobber the live watcher's truth.
      if (agentWriteWatcher !== watcher) return
      if (state === 'down') {
        // Post-ready watcher death — coverage untrustworthy; restart w/ backoff.
        markApprovalsWatcherDown(reason ?? 'watcher error')
        return
      }
      if (state === 'watching') noteWatcherRecovered()
      setWatcherHealth(state, reason)
    }
  })
  return watcher
}

/**
 * Watcher-only rebuild against the SAME root (contracts §4 v1.2.1). The queue
 * is deliberately untouched: clear-on-init is load-bearing for workspace
 * switches (initApprovalsForRoot) and must NEVER run here — a crash recovery
 * that cleared the queue would silently drop captured-but-unreviewed writes.
 */
export async function restartWatcher(): Promise<GitOpResult> {
  const root = watcherRoot
  if (root === null) return NO_WORKSPACE
  const generation = ++watcherGeneration
  cancelWatcherRetry()
  const superseded = (): boolean => generation !== watcherGeneration || watcherRoot !== root
  await agentWriteWatcher?.stop()
  // A workspace switch or newer restart overtook us mid-stop: building here
  // would rebind to a dead root and orphan the live watcher. Abort.
  if (superseded()) return WATCHER_SUPERSEDED
  const next = buildWatcher(root)
  agentWriteWatcher = next
  try {
    await next.start()
  } catch (err) {
    // Superseded mid-start (the winner's stop() strips 'ready', so this
    // rejection can land up to readyTimeout AFTER the winner recovered):
    // report nothing — the current generation owns health/backoff now.
    if (superseded()) return WATCHER_SUPERSEDED
    watcherRetryAttempts += 1
    markApprovalsWatcherDown(err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'watcher-start-failed' }
  }
  if (superseded()) {
    // Started successfully but no longer current: retire it (no live orphan).
    // Its health emissions are already inert via the buildWatcher guard.
    await next.stop()
    return WATCHER_SUPERSEDED
  }
  return { ok: true }
}

/**
 * Disarm the approvals surface immediately. Called FIRST in
 * reconfigureForVault: WorkspaceService flips the active workspace before the
 * ready callbacks run, and the old watcher must not route batches (worst
 * case: a destructive autoReject discard) while getRoot() already resolves
 * to the new root. The gate is down until initApprovalsForRoot rebinds it —
 * same coverage as a plain app start.
 *
 * Cancels any pending backoff retry FIRST (contracts §4 v1.2.1 risk note): a
 * timer surviving this call would rearm a restart against a dead root.
 */
export async function stopApprovals(): Promise<void> {
  watcherGeneration += 1 // abort any in-flight restart at its next check
  cancelWatcherRetry()
  watcherRoot = null
  watcherRetryAttempts = 0
  watcherDownSince = null
  await agentWriteWatcher?.stop()
  if (watcherHealth.state !== 'stopped') setWatcherHealth('stopped')
}

export async function initApprovalsForRoot(root: string): Promise<void> {
  watcherGeneration += 1 // abort any in-flight restart at its next check
  cancelWatcherRetry()
  watcherRoot = root
  watcherRetryAttempts = 0
  watcherDownSince = null
  await agentWriteWatcher?.stop()
  getApprovalQueue().clear()
  // v1.2.7: the watcher's getWriteBudget provider reads the bindings mirror
  // SYNCHRONOUSLY — load it (and run the root's one-time backfill) before
  // any batch can route, so bound threads never fall back to the default
  // threshold on a fresh launch. Degrade-not-fail: a throwing registry
  // leaves budget reads unbound; it must never block workspace init.
  await getHarnessRunRegistry()
    .ensureRootReady(root)
    .catch(() => undefined)
  agentWriteWatcher = buildWatcher(root)
  await agentWriteWatcher.start()
}

export function registerGitIpc(): void {
  typedHandle('git:status', async () => {
    const root = currentRoot()
    if (root === null) return { isRepo: false, entries: [] }
    return { isRepo: isGitRepo(root), entries: status(root) }
  })

  typedHandle('git:diff', async (args) => {
    const root = currentRoot()
    if (root === null) return ''
    return diff(root, args.paths)
  })

  typedHandle('git:commit-approved', async (args) => {
    const root = currentRoot()
    if (root === null) return NO_WORKSPACE
    return commitApproved(root, args)
  })

  typedHandle('git:revert-agent', async (args) => {
    const root = currentRoot()
    if (root === null) return NO_WORKSPACE
    // A tray revert during a LIVE turn must not read as agent activity
    // (v1.2.7): suppress the watcher's echo of the gate's own writes BEFORE
    // the tree changes (the discard wrapper's pattern)…
    const result = revertAgent(root, args.agentId, (paths) => {
      agentWriteWatcher?.suppress(paths)
    })
    // …and excuse the revert commit sha on every open turn window (the
    // noteQueueCommit pattern, root-scoped) so the headMoved tripwire never
    // blames a healthy agent for the user's revert.
    if (result.ok && result.sha !== undefined) {
      getCliTurnRegistry().noteGateCommitForRoot(root, result.sha)
    }
    return result
  })

  // Read path for the per-agent revert UI (step 5, contracts §2/§6 v1.2.5).
  // Non-repo is a structured reason (not an empty list) so the tray renders
  // the honest "nothing to revert from" state instead of a false empty.
  // v1.2.7 extends the rule to git FAILURES: a failed log walk is a
  // structured 'git-failed', never "no unreverted agent commits".
  typedHandle('git:list-agent-commits', async () => {
    const root = currentRoot()
    if (root === null) return { ok: false as const, reason: 'no-workspace' }
    if (!isGitRepo(root)) return { ok: false as const, reason: 'not-a-git-repo' }
    const agents = listAgentCommits(root)
    if (agents === null) return { ok: false as const, reason: 'git-failed' }
    return { ok: true as const, agents }
  })

  typedHandle('approvals:list', async () => {
    return [...getApprovalQueue().list()]
  })

  typedHandle('approvals:resolve', async (args) => {
    return getApprovalQueue().resolve(args.id, args.approve, args.message)
  })

  typedHandle('approvals:watcher-status', async () => {
    return getWatcherHealth()
  })

  typedHandle('approvals:watcher-retry', async () => {
    // Manual Retry is the down-until-manual escape hatch: reset the cap.
    watcherRetryAttempts = 0
    return restartWatcher()
  })

  // Turn-start policy (contracts §4 v1.2.1, OQ6): turns opened while the
  // watcher is not 'watching' are tagged gateDegraded — visibly degrade,
  // never block. Late-bound probe: a direct import from cli-turn-registry
  // back into this module would be a cycle.
  setGateHealthProbe(() => watcherHealth.state === 'watching')

  // Breaker signal-source honesty (step 6, contracts §5 v1.2.6): when the
  // watcher is not watching, the breaker's velocity/forbidden/headMoved
  // sources have no coverage — status reports signalsDegraded instead of
  // pretending. Health is NEVER a trip input (a dead watcher must not kill
  // healthy agents). Same late-bound pattern as setGateHealthProbe.
  setBreakerSignalHealthProbe(() => watcherHealth.state === 'watching')
}
