/**
 * Workstation session + adapter shared types (workstation contracts §3,
 * Phase 2 step 1).
 *
 * NAME-COLLISION WARNING: `src/shared/cli-agent-session-types.ts` is a
 * different, unrelated module — it carries the CLI-agent *presence* wire
 * types for the Move 8 session listener (which external `claude`/`codex`
 * processes are running on this machine). This module types workstation
 * terminal sessions and the agent-adapter registry seam. Nothing here
 * relates to that file.
 *
 * Everything here is pure and dependency-free: importable from the renderer,
 * the main process, and Web Workers alike.
 */
import type { SessionId } from './types'
import type { ToolCall } from './cli-agents'

/** Back-ends an agent session can run through. `raw` = unknown agent CLI (PLAN Q8). */
export type AdapterId = 'claude' | 'codex' | 'gemini' | 'raw'

export interface WorkstationSession {
  readonly id: SessionId // existing branded type
  readonly cwd: string
  /** null = plain terminal; 'raw' = unknown agent CLI run as plain PTY (Q8). */
  readonly adapterId: AdapterId | null
  readonly threadId?: string // bound thread for adapter sessions
}

/**
 * Options for one non-interactive CLI invocation. Generalizes the shape
 * previously local to `cli-thread-spawner.ts` with the step-1 additions
 * (`model`, `invocationTemplate`).
 */
export interface CliInvocationOptions {
  /**
   * Agent-native session id captured from a previous turn's structured
   * output (claude `session_id` / codex `thread_id`). When set (and shaped
   * like `SAFE_AGENT_SESSION_ID_RE`), the invocation resumes that exact
   * conversation — immune to other CLI runs in the same cwd.
   */
  readonly resumeSessionId?: string
  /**
   * True when a prior turn was already sent for this thread. Degraded
   * fallback when no session id was captured: claude `--continue` / codex
   * `resume --last` pick the most recent conversation in the cwd.
   */
  readonly continueConversation?: boolean
  /**
   * Explicit model pick. TRUSTED AS-IS by `formatInvocation` (it is pure);
   * validation — membership in `adapter.models` plus the conservative
   * charset check — happens at the IPC boundary via `resolveModelPick`
   * before this field is ever populated. Absent ⇒ the adapter's own default
   * (no flag emitted).
   */
  readonly model?: string
  /**
   * `raw` adapter only (OQ3): single-line command template containing the
   * literal `{prompt}` placeholder; the prompt is single-quote-escaped into
   * it. Multiline or `{prompt}`-less templates are rejected. In step 1
   * ad-hoc raw threads have no template source — harness-supplied templates
   * arrive in step 8.
   */
  readonly invocationTemplate?: string
}

/**
 * One structured event parsed from a single line of an agent CLI's
 * machine-readable output stream (claude `--output-format stream-json`,
 * codex `exec --json`). A non-null event with empty fields still counts as
 * "structured output seen" for the bridge's degraded-mode switch.
 */
export interface AgentStreamEvent {
  /** Agent-native session id (claude `session_id` / codex `thread_id`). */
  readonly agentSessionId: string | null
  /** Assistant text segments carried by this event, in order. */
  readonly texts: readonly string[]
  /** Tool events carried by this line, in order. */
  readonly tools: readonly ToolCall[]
  /**
   * claude's terminal `result` line repeats the final text — consumers use
   * it only when no assistant event produced text (defensive fallback).
   */
  readonly resultText: string | null
}

export interface AgentAdapter {
  readonly id: AdapterId
  /**
   * Absorbs formatCliInvocation (was cli-thread-spawner.ts:63-96). opts carries
   * resume/continue state, an optional pre-validated `model`, and — raw only —
   * the `invocationTemplate` (OQ3).
   */
  formatInvocation(prompt: string, opts: CliInvocationOptions): string
  /**
   * Structured-event parser; absent = raw PTY projection only (gemini
   * today). Nuance: a heuristic gemini parser exists in
   * `cli-agent-parsers.ts` — "absent parseEvent = raw projection" is the
   * *bridge* contract, not a claim about that file.
   */
  parseEvent?(line: string): AgentStreamEvent | null
  /**
   * Spike-verified model ids/aliases the picker may offer. Absent (raw) =
   * the adapter has no model concept; empty (gemini) = flag parses but no
   * id could be real-run verified on the dev machine.
   */
  readonly models?: readonly string[]
  /**
   * RESERVED — OQ1 deferral seam, recorded at step 1. When an adapter can
   * enforce pre-write permission hooks natively (only Claude Code documents
   * such a mechanism today), a future phase sets this to describe the hook
   * surface. Phase 2 never sets or reads it; write containment stays
   * post-persistence via the approvals queue.
   */
  readonly permissionHooks?: 'adapter-native'
}

/** Projection is not a new subsystem — it names the existing seam (contracts §3). */
export interface SessionProjection {
  readonly sessionId: SessionId
  readonly surface: 'dock' | 'canvas'
}
