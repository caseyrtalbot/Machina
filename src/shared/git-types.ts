/**
 * Git substrate shared types (workstation contracts §2/§4, v1.1).
 *
 * Shapes shared between the main-process GitService / ApprovalQueue and the
 * renderer approvals tray. The service implementation lives in
 * `src/main/services/git-service.ts`.
 */

/** Porcelain-derived file state; untracked (`??`) maps to 'added'. */
export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed'

export interface GitStatusEntry {
  readonly path: string
  readonly state: GitFileState
  /** Present for 'renamed' entries: the pre-rename path. */
  readonly origPath?: string
}

/** isRepo lets the renderer surface "non-repo = no rollback protection" honestly. */
export interface GitStatusResult {
  readonly isRepo: boolean
  readonly entries: readonly GitStatusEntry[]
}

export interface CommitApprovedOpts {
  /** Harness slug, or adapter id for ad-hoc threads; SAFE_ID_RE-validated. */
  readonly agentId: string
  readonly threadId: string
  /** Staged exactly via `git add -- <paths>`; never `add -A`. */
  readonly paths: readonly string[]
  /** First line only; trailers appended by the service. */
  readonly message: string
}

export type GitOpResult =
  | { readonly ok: true; readonly sha?: string }
  | { readonly ok: false; readonly reason: string }

export interface PendingChangeFlags {
  /** WriteRateLimiter per thread. */
  readonly highVelocity: boolean
  /** Agent ran git itself during the turn. */
  readonly headMoved: boolean
  /** >1 turn window matched — ambiguous attribution. */
  readonly concurrentTurns: boolean
  /** Shell hooks absent; PTY-alive fallback window. */
  readonly degradedAttribution: boolean
  /** Touched a HARNESS_PROTECTED_GLOBS path. */
  readonly forbidden: boolean
}

export interface PendingChange {
  /** One per turn: pc_<turnId>, updated as writes land. */
  readonly id: string
  readonly kind: 'cli-change' | 'gate-confirm'
  readonly threadId: string
  readonly agentId: string
  readonly paths: readonly string[]
  /** Snapshot at capture — the review artifact and stale-check baseline. */
  readonly diff: string
  readonly capturedAt: string
  /** False in non-repo workspaces. */
  readonly revertible: boolean
  readonly flags: PendingChangeFlags
  readonly description?: string
}

/** Commit-trailer keys used for agent attribution (survive rebase, no ref pollution). */
export const TRAILER_AGENT = 'Machina-Agent'
export const TRAILER_SESSION = 'Machina-Session'
/**
 * Carried by revert commits INSTEAD of Machina-Agent so reverts are never
 * re-enumerated. Value: space-separated shas of the reverted commits, so a
 * later revertAgent excludes already-reverted commits.
 */
export const TRAILER_REVERTS = 'Machina-Reverts'
/** A commit-message first line starting with this prefix is neutralized (forgery guard). */
export const MACHINA_TRAILER_PREFIX = 'Machina-'

/** Blocks trailer forgery / format injection in agentId and threadId. */
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
