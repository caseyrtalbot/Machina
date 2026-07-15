/**
 * Native-hold queue mirror (Phase 3 step 2, contracts §4 v1.3.1).
 *
 * Surfaces the native agent's pending tool approvals (tool_pending_approval
 * holds) as approval-queue gate-confirm rows, so unattended/unfocused native
 * ops reach the same tray + OS-notification path as CLI and MCP writes.
 *
 * Single resolution authority: the approvals map in context.ts. Resolving
 * from the TRAY drives the queue waiter → decideApproval (exactly once — the
 * map deletes the resolver before invoking it); resolving from the CHAT DIFF
 * CARD (or a run abort) settles the hold first and the hold-settled listener
 * releases the mirror row here. Either order leaves zero rows and exactly
 * one decision.
 *
 * The mirror row has NO auto-deny timer (enqueueGateHold): a native hold has
 * no timeout of its own — the run-abort path (clearApproval in the agent's
 * finally block) bounds its life, and a mirror timer would race the chat
 * card's decision.
 */
import type { AgentNativeApprovalPreview } from '@shared/ipc-channels'
import type { HitlDecision } from '../hitl-gate'
import type { GateHoldOpts } from '../approval-queue'

/** The ApprovalQueue slice the mirror consumes (injected for tests). */
export interface HoldQueue {
  enqueueGateHold(opts: GateHoldOpts, onDecision: (decision: HitlDecision) => void): string
  removeGateHold(id: string, accepted: boolean): boolean
}

/** toolUseId → queue item id for every live mirrored hold. */
const holdItemIds = new Map<string, string>()

/** Cap the tray diff preview: queue items travel over IPC on every list. */
const PREVIEW_MAX_CHARS = 4_000

function truncate(text: string): string {
  if (text.length <= PREVIEW_MAX_CHARS) return text
  return `${text.slice(0, PREVIEW_MAX_CHARS)}\n[preview truncated]`
}

/** Copy gate: honest hold descriptions — awaiting confirmation, never "blocked". */
function holdOpts(threadId: string, pending: AgentNativeApprovalPreview): GateHoldOpts {
  if (pending.approvalKind === 'write_note') {
    return {
      tool: 'write_note',
      path: pending.preview.path,
      description: pending.preview.created
        ? 'Native agent wants to create this note — awaiting your confirmation'
        : 'Native agent wants to overwrite this note — awaiting your confirmation',
      contentPreview: truncate(pending.preview.content),
      threadId
    }
  }
  return {
    tool: 'edit_note',
    path: pending.preview.path,
    description: 'Native agent wants to edit this note — awaiting your confirmation',
    contentPreview: truncate(`- ${pending.preview.find}\n+ ${pending.preview.replace}`),
    threadId
  }
}

/**
 * Mirror a just-emitted hold as a queue row. `decide` is context.ts's
 * decideApproval — the single authority; the queue waiter routes through it
 * so a tray resolution and a chat-card resolution are the same operation.
 */
export function mirrorNativeHold(
  queue: HoldQueue,
  toolUseId: string,
  threadId: string,
  pending: AgentNativeApprovalPreview,
  decide: (toolUseId: string, accept: boolean, rejectReason?: string) => void
): void {
  if (holdItemIds.has(toolUseId)) return
  const id = queue.enqueueGateHold(holdOpts(threadId, pending), (decision) =>
    decide(toolUseId, decision.allowed, decision.allowed ? undefined : decision.reason)
  )
  holdItemIds.set(toolUseId, id)
}

/**
 * The hold settled (any surface). Remove the mirror row; a no-op when the
 * tray resolution already removed it (removeGateHold refuses unknown ids).
 */
export function releaseNativeHold(queue: HoldQueue, toolUseId: string, accepted: boolean): void {
  const id = holdItemIds.get(toolUseId)
  if (id === undefined) return
  holdItemIds.delete(toolUseId)
  queue.removeGateHold(id, accepted)
}

/** Test seam: the mirror map is module state; tests reset it between cases. */
export function resetNativeHoldMirror(): void {
  holdItemIds.clear()
}
