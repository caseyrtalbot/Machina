/**
 * QueueHitlGate (workstation step 3, contracts §4 "gate reuse").
 *
 * A `HitlGate` implementation backed by the approval queue, proving the
 * convergence seam: native-agent and MCP write confirmations can ride the
 * same queue UI as CLI-agent changes. `enqueueGateConfirm` owns the whole
 * lifecycle — a 'gate-confirm' PendingChange appears in the tray, the user's
 * approvals:resolve answers it, and a timeout auto-denies AND removes the
 * item (a stale confirm must never catch a late click).
 *
 * Deliberately NOT wired over the MCP TimeoutHitlGate in production this
 * step — that convergence is a deferred residual (02-phase-1-specs.md).
 */
import { GATE_CONFIRM_TIMEOUT_MS } from './approval-queue'
import type { HitlConfirmOpts, HitlDecision, HitlGate } from './hitl-gate'

export interface QueueGateBackend {
  enqueueGateConfirm(opts: HitlConfirmOpts, timeoutMs?: number): Promise<HitlDecision>
}

export class QueueHitlGate implements HitlGate {
  constructor(
    private readonly queue: QueueGateBackend,
    private readonly timeoutMs: number = GATE_CONFIRM_TIMEOUT_MS
  ) {}

  confirm(opts: HitlConfirmOpts): Promise<HitlDecision> {
    return this.queue.enqueueGateConfirm(opts, this.timeoutMs)
  }
}
