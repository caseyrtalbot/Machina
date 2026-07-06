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
import { AuditLogger } from '../services/audit-logger'
import {
  commitApproved,
  diff,
  discard,
  isGitRepo,
  revertAgent,
  status
} from '../services/git-service'
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

/**
 * Lazy singleton so step 3 (gate parity) can wire the watcher/registry to the
 * same queue the IPC handlers serve. The one AuditLogger lives under
 * `userData/audit` — outside any workspace watch root, so audit writes never
 * self-trigger the agent write watcher.
 */
export function getApprovalQueue(): ApprovalQueue {
  if (approvalQueue === null) {
    const audit = new AuditLogger(join(app.getPath('userData'), 'audit'))
    approvalQueue = new ApprovalQueue({
      git: {
        isRepo: isGitRepo,
        diff,
        commitApproved,
        // Recoverable deletion: untracked rejects go to the OS trash, not rm.
        discard: (root, paths) => discard(root, paths, (absPath) => shell.trashItem(absPath))
      },
      audit,
      getRoot: currentRoot,
      notify: broadcastApprovalsChanged
    })
  }
  return approvalQueue
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
