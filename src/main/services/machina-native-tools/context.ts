import path from 'node:path'
import type { ToolErrorCode } from '@shared/thread-types'
import type { AgentNativeApprovalPreview, DockAction } from '@shared/ipc-channels'
import type { DockTab } from '@shared/dock-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { PathGuardError, type AuditEntry } from '@shared/agent-types'
import { PathGuard } from '../path-guard'
import type { WriteRateLimiter } from '../hitl-gate'
import type { VaultQueryFacade } from '../vault-query-facade'

interface ApprovalDecision {
  readonly accept: boolean
  readonly rejectReason?: string
}

const approvals = new Map<string, (decision: ApprovalDecision) => void>()

/**
 * Hold-settled seam (Phase 3 step 2, contracts §4 v1.3.1 native mirror).
 * The approvals map above is the SINGLE resolution authority for native
 * tool holds — a resolver exists exactly once and is deleted before it is
 * invoked, so a decision lands exactly once no matter which surface (chat
 * diff card, approvals tray, run abort) settles it. This listener fires
 * AFTER a hold settles so the queue mirror can drop its gate-confirm row;
 * it never resolves anything itself.
 */
let holdSettledListener: ((toolUseId: string, accepted: boolean) => void) | null = null

export function setHoldSettledListener(
  listener: ((toolUseId: string, accepted: boolean) => void) | null
): void {
  holdSettledListener = listener
}

export function decideApproval(toolUseId: string, accept: boolean, rejectReason?: string): void {
  const resolver = approvals.get(toolUseId)
  if (!resolver) return
  approvals.delete(toolUseId)
  resolver({ accept, rejectReason })
  holdSettledListener?.(toolUseId, accept)
}

// Resolve any pending approval as rejected and drop it from the map. Call this
// when a run aborts or errors out so the awaiting tool returns instead of
// leaking a zombie entry forever.
export function clearApproval(toolUseId: string, reason = 'run aborted'): void {
  const resolver = approvals.get(toolUseId)
  if (!resolver) return
  approvals.delete(toolUseId)
  resolver({ accept: false, rejectReason: reason })
  holdSettledListener?.(toolUseId, false)
}

export function awaitApproval(toolUseId: string): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    approvals.set(toolUseId, resolve)
  })
}

export interface ToolContext {
  readonly vaultPath: string
  /** Safe, audited vault access shared with the MCP lane (one facade instance
   * per open vault, built in McpLifecycle.createForVault). Note reads/writes
   * route through it so the in-app native lane leaves the same audit trail and
   * Spotlighting envelope the headless MCP path already produces. Required: a
   * vault is always open when an agent runs. */
  readonly facade: VaultQueryFacade
  readonly autoAccept: boolean
  readonly toolUseId?: string
  readonly emitPending?: (toolUseId: string, preview: AgentNativeApprovalPreview) => void
  /** Snapshot of the active thread's dock tabs at run-start. Used by close_dock_tab
   * to translate kind→index when the agent does not specify an explicit index. */
  readonly dockTabsSnapshot?: readonly DockTab[]
  /** Drive the renderer's surface dock from the agent. */
  readonly emitDockAction?: (action: DockAction) => void
  /** Push canvas mutations to the renderer's in-memory store after an
   * agent tool writes the canvas file directly. Without this bridge,
   * the renderer's debounced autosave would later overwrite the disk
   * with stale in-memory state, silently dropping the agent's write.
   * The renderer applies the plan only when canvasPath matches the
   * currently loaded canvas. */
  readonly dispatchCanvasPlan?: (plan: CanvasMutationPlan, canvasPath: string) => void
  /** Aborted when the agent run is cancelled. Long-running tools (search_vault,
   * pin_to_canvas) check or wire this to short-circuit instead of running to
   * completion after the user has already pressed Stop. */
  readonly signal?: AbortSignal
  /** Append-only audit sink for security-relevant writes. Injected per run by
   * the native agent runner so in-app writes leave the same NDJSON trail the
   * headless MCP path already produces. Absent in unit calls that don't assert it. */
  readonly audit?: { readonly log: (entry: AuditEntry) => void }
  /** Sliding-window write-velocity tracker shared across a run's writes. Under
   * autoAccept, an exceeded limiter forces a one-off human checkpoint on the
   * next write so a looping agent can't write unboundedly without review. */
  readonly rateLimiter?: WriteRateLimiter
}

export type NativeToolResult =
  | { ok: true; output: unknown; pendingUserApproval?: boolean }
  | { ok: false; error: { code: ToolErrorCode; message: string; hint?: string } }

type ResolveResult =
  | { ok: true; abs: string }
  | { ok: false; error: { code: ToolErrorCode; message: string } }

// Resolve a caller-supplied path against the vault root and enforce the vault
// boundary via the canonical PathGuard (symlink resolution + deny list +
// null-byte check). We path.resolve against the vault FIRST so an absolute rel
// (e.g. /etc/passwd) still escapes and is caught — matching the old safeJoin
// semantics — whereas handing a relative rel straight to PathGuard would
// resolve it against process.cwd() instead of the vault.
export function resolveInVault(vault: string, rel: string): ResolveResult {
  try {
    const abs = path.resolve(vault, rel)
    return { ok: true, abs: new PathGuard(vault).assertWithinVault(abs) }
  } catch (err) {
    if (err instanceof PathGuardError) {
      return { ok: false, error: { code: 'PATH_OUT_OF_VAULT', message: err.message } }
    }
    throw err
  }
}
