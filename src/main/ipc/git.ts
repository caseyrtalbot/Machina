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
import { getCliTurnRegistry, isAgentHeadMove } from '../services/cli-turn-registry'
import {
  commitApproved,
  commitsBetween,
  diff,
  discard,
  headSha,
  ignoredUntracked,
  isGitRepo,
  revertAgent,
  status
} from '../services/git-service'
import { getDocumentManager } from './documents'
import type { GitOpResult } from '@shared/git-types'

const NO_WORKSPACE: GitOpResult = { ok: false, reason: 'no-workspace' }

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
/**
 * Disarm the approvals surface immediately. Called FIRST in
 * reconfigureForVault: WorkspaceService flips the active workspace before the
 * ready callbacks run, and the old watcher must not route batches (worst
 * case: a destructive autoReject discard) while getRoot() already resolves
 * to the new root. The gate is down until initApprovalsForRoot rebinds it —
 * same coverage as a plain app start.
 */
export async function stopApprovals(): Promise<void> {
  await agentWriteWatcher?.stop()
}

export async function initApprovalsForRoot(root: string): Promise<void> {
  await agentWriteWatcher?.stop()
  getApprovalQueue().clear()
  agentWriteWatcher = new AgentWriteWatcher({
    root,
    registry: getCliTurnRegistry(),
    queue: getApprovalQueue(),
    audit: getAuditLogger(),
    // Self-write suppression: user autosaves during a turn must not be
    // misattributed to the agent (timing race accepted per contracts §4).
    isSelfWrite: (absPath) => getDocumentManager().hasPendingWrite(absPath),
    headSha,
    commitsBetween
  })
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
    return revertAgent(root, args.agentId)
  })

  typedHandle('approvals:list', async () => {
    return [...getApprovalQueue().list()]
  })

  typedHandle('approvals:resolve', async (args) => {
    return getApprovalQueue().resolve(args.id, args.approve, args.message)
  })
}
