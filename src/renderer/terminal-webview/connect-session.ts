/**
 * Session-connect decision for the terminal webview guest (extracted from
 * TerminalApp's connectSession in workstation Phase 2 step 4 so the
 * no-respawn rule is behaviorally testable).
 *
 * Order: reconnect to a surviving PTY when a sessionId is given; otherwise
 * fall through to terminal:create at `cwd` — UNLESS `reattachOnly` is set
 * (agent projections, contracts §4): then a failed reconnect is a DEAD
 * session, `create` is never called, and the caller reports the dead state
 * to the host. A fresh unattributed shell in the thread's cwd would be a
 * containment hole; the create fallback stays correct for plain terminals.
 */

export interface ConnectSessionApi {
  reconnect(args: {
    sessionId: string
    cols: number
    rows: number
  }): Promise<{ scrollback: string; meta?: Record<string, string> } | null>
  create(args: {
    cwd: string
    cols: number
    rows: number
    label?: string
    vaultPath?: string
  }): Promise<string>
}

export interface ConnectSessionParams {
  readonly sessionId: string | null
  /** Agent projection: never create — a failed reconnect is 'dead'. */
  readonly reattachOnly: boolean
  readonly cwd: string | null
  readonly label: string | null
  readonly vaultPath: string | null
  readonly cols: number
  readonly rows: number
}

export type ConnectSessionOutcome =
  | { readonly kind: 'reconnected'; readonly sessionId: string; readonly scrollback: string }
  | { readonly kind: 'created'; readonly sessionId: string }
  | { readonly kind: 'dead'; readonly sessionId: string | null }

export async function connectToSession(
  params: ConnectSessionParams,
  api: ConnectSessionApi
): Promise<ConnectSessionOutcome> {
  const { sessionId, reattachOnly, cwd, label, vaultPath, cols, rows } = params

  // Reconnect path: try to reattach to a surviving session.
  if (sessionId) {
    const result = await api.reconnect({ sessionId, cols, rows })
    if (result) {
      return { kind: 'reconnected', sessionId, scrollback: result.scrollback }
    }
  }

  // Reattach-only (agent projection): the PTY is gone — report dead, never
  // spawn a replacement shell (the load-bearing no-respawn branch).
  if (reattachOnly) {
    return { kind: 'dead', sessionId }
  }

  // Create path: spawn a new session at the actual terminal dimensions.
  const newSessionId = await api.create({
    cwd: cwd || '/',
    cols,
    rows,
    label: label ?? undefined,
    vaultPath: vaultPath ?? undefined
  })
  return { kind: 'created', sessionId: newSessionId }
}
