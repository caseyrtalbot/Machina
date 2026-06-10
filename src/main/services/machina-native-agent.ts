import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { resolveAnthropicKey } from './anthropic-key'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { NATIVE_TOOLS } from '@shared/machina-native-tools'
import { TE_DIR } from '@shared/constants'
import { callTool, clearApproval } from './machina-native-tools'
import { getDocumentManager } from '../ipc/documents'
import { AuditLogger } from './audit-logger'
import { WriteRateLimiter } from './hitl-gate'
import type { AgentNativeEventBody, DockAction } from '@shared/ipc-channels'
import type { DockTab } from '@shared/dock-types'
import type { ToolResult } from '@shared/thread-types'

const DEFAULT_TIMEOUT_MS = 60_000
// Streaming throughout, so the SDK-HTTP-timeout ceiling doesn't apply; 64K is
// the output ceiling of the Sonnet/Haiku options in NATIVE_MODEL_OPTIONS.
// (Was 4096, which truncated long syntheses mid-note.)
const MAX_TOKENS = 64_000
const MAX_TOOL_ITERATIONS = 8

/**
 * Default system prompt for the in-app native agent. Owned by the main
 * process (2.2); the renderer no longer ships a prompt over IPC. A vault can
 * override it wholesale via `<vault>/${TE_DIR}/agent-prompt.md`.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Machina, the in-app agent for the user's Markdown vault in the Machina app (infinite canvas + terminal + knowledge graph).

Vault structure:
- The vault is a folder of Markdown notes. All paths you use are relative to the vault root (e.g. "ideas/spark.md").
- Frontmatter (YAML between --- fences) may carry id, title, tags, created/modified, and relationship arrays (connections, cluster, tension). Preserve existing frontmatter when editing.
- App-internal state lives under "${TE_DIR}/" — never write there with note tools.

Conventions:
- Wikilinks: [[Note Title]] links notes by title; prefer wikilinks over bare paths inside note bodies. Links and shared tags are how the knowledge graph forms — when you create a note, link it to the notes that motivated it.
- Canvases: canvasId "default" is the user's visible canvas. To show an existing vault note on the canvas, pin it by path (card.path) — never retype its content. Use card.content only for free-form synthesis cards.

Tool selection:
- list_vault / search_vault to discover; read_note to inspect. search_vault is a literal, case-sensitive substring match — not regex.
- read before write: read_note a file before write_note or edit_note so you never clobber content you have not seen. Prefer edit_note (surgical find/replace) over write_note for existing files; the find string must be unique.
- Writes show the user a diff for approval unless the thread is in auto-accept mode. A rejected write is a signal to stop and ask, not retry.
- Dock tools (open_dock_tab / close_dock_tab) drive the user's workspace — use them only when the user asks to see something.

Style: concise and grounded. Cite the notes you used by wikilink. Never invent vault content — if a note doesn't exist, say so.`

interface RunOptions {
  readonly vaultPath: string
  readonly threadId: string
  readonly model: string
  readonly userMessage: string
  readonly historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  readonly autoAccept?: boolean
  readonly dockTabsSnapshot?: ReadonlyArray<DockTab>
}

interface InflightRun {
  readonly controller: AbortController
  /** Set by abortMachinaNative so a user Stop settles quietly (message_end)
   *  instead of rendering as an SDK_TIMEOUT error. */
  userAborted: boolean
}

const inflight = new Map<string, InflightRun>()

function emit(runId: string, threadId: string, body: AgentNativeEventBody): void {
  const window = getMainWindow()
  if (!window) return
  typedSend(window, 'agent-native:event', { runId, threadId, ...body })
}

function emitDockAction(threadId: string, action: DockAction): void {
  const window = getMainWindow()
  if (!window) return
  typedSend(window, 'agent-native:dock-action', { threadId, ...action })
}

function newRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function classifyError(err: unknown, aborted: boolean): AgentNativeEventBody {
  if (aborted) return { kind: 'error', code: 'SDK_TIMEOUT', message: 'request timed out' }
  if (err instanceof Anthropic.AuthenticationError) {
    return { kind: 'error', code: 'AUTH', message: err.message }
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { kind: 'error', code: 'RATE_LIMIT', message: err.message }
  }
  if (err instanceof Anthropic.APIError) {
    return { kind: 'error', code: 'IO_TRANSIENT', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'error', code: 'IO_FATAL', message }
}

/**
 * Resolve the system prompt for a vault: `${TE_DIR}/agent-prompt.md` wins when
 * present and non-empty; otherwise the built-in default. Exported for tests.
 */
export async function resolveSystemPrompt(vaultPath: string): Promise<string> {
  try {
    const override = await readFile(join(vaultPath, TE_DIR, 'agent-prompt.md'), 'utf8')
    if (override.trim().length > 0) return override
  } catch {
    // No override file — use the default.
  }
  return DEFAULT_SYSTEM_PROMPT
}

export async function runMachinaNative(opts: RunOptions): Promise<string> {
  const key = await resolveAnthropicKey()
  if (!key) throw new Error('AUTH: no Anthropic API key configured')
  const client = new Anthropic({ apiKey: key })
  const systemPrompt = await resolveSystemPrompt(opts.vaultPath)

  const runId = newRunId()
  const abort = new AbortController()
  const run: InflightRun = { controller: abort, userAborted: false }
  inflight.set(runId, run)
  let timeout: NodeJS.Timeout = setTimeout(() => abort.abort(), DEFAULT_TIMEOUT_MS)
  function resetTimeout(): void {
    clearTimeout(timeout)
    timeout = setTimeout(() => abort.abort(), DEFAULT_TIMEOUT_MS)
  }

  let messages: Anthropic.MessageParam[] = [
    ...opts.historyMessages.map((m) => ({ role: m.role, content: m.content }) as const),
    { role: 'user' as const, content: opts.userMessage }
  ]

  // Track every toolUseId we hand to callTool so we can drop any pending
  // approval entry if this run aborts or errors out before the user decides.
  const emittedToolUseIds = new Set<string>()

  // Mutable mirror of the renderer's dock tabs. Updated when the agent calls
  // open_dock_tab / close_dock_tab so subsequent calls in the same run can
  // resolve a kind to the right index without an extra round-trip.
  let dockTabs: DockTab[] = opts.dockTabsSnapshot ? [...opts.dockTabsSnapshot] : []

  // One audit sink + write-velocity tracker per run. The in-app native agent
  // previously left no audit trail and, under autoAccept, no write checkpoint.
  // Audit logs go outside the vault, next to the MCP path's, at app userData/audit.
  // Scope note: unlike the MCP path's per-vault WriteRateLimiter (mcp-lifecycle),
  // this one is per-run, so it guards against a single runaway turn emitting many
  // writes — NOT cross-turn velocity. That's the intended threat here; a burst
  // spread thin across many turns is not what autoAccept loops produce.
  const audit = new AuditLogger(join(app.getPath('userData'), 'audit'))
  const rateLimiter = new WriteRateLimiter()

  void (async () => {
    try {
      // True when the loop exits by exhausting MAX_TOOL_ITERATIONS while the
      // model still wanted tools — surfaced as a visible notice, not silence.
      let iterationsExhausted = true
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        resetTimeout()
        const stream = client.messages.stream(
          {
            model: opts.model,
            max_tokens: MAX_TOKENS,
            system: [
              {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' }
              }
            ],
            tools: NATIVE_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: {
                type: 'object' as const,
                properties: { ...t.input_schema.properties },
                required: [...t.input_schema.required]
              }
            })),
            messages
          },
          { signal: abort.signal }
        )

        for await (const event of stream) {
          // Each delta proves liveness — reset the inactivity timer so a
          // response that streams for >60s isn't killed mid-generation.
          resetTimeout()
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            emit(runId, opts.threadId, { kind: 'text', text: event.delta.text })
          }
        }

        const final = await stream.finalMessage()
        messages = [...messages, { role: 'assistant', content: final.content }]

        const toolUses = final.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        )
        if (toolUses.length === 0) {
          iterationsExhausted = false
          break
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          const input = (tu.input ?? {}) as Record<string, unknown>

          // Approval-gated tools: emit pending immediately so the renderer
          // can render the diff card *before* callTool blocks on the user.
          // Pause the SDK timeout while we wait on the human.
          clearTimeout(timeout)
          emittedToolUseIds.add(tu.id)
          const { result: res, call } = await callTool(tu.name, input, {
            vaultPath: opts.vaultPath,
            autoAccept: opts.autoAccept ?? false,
            toolUseId: tu.id,
            emitPending: (toolUseId, preview) =>
              emit(runId, opts.threadId, { kind: 'tool_pending_approval', toolUseId, ...preview }),
            dockTabsSnapshot: dockTabs,
            emitDockAction: (action) => {
              if (action.action === 'open') dockTabs = [...dockTabs, action.tab]
              else if (action.action === 'close')
                dockTabs = dockTabs.filter((_, i) => i !== action.index)
              emitDockAction(opts.threadId, action)
            },
            dispatchCanvasPlan: (plan, canvasPath) => {
              const window = getMainWindow()
              if (window) typedSend(window, 'canvas:agent-plan-accepted', { plan, canvasPath })
            },
            signal: abort.signal,
            audit,
            rateLimiter,
            documentManager: getDocumentManager()
          })
          emittedToolUseIds.delete(tu.id)
          // Restart the timeout for the next SDK iteration.
          resetTimeout()

          if (call) {
            const result: ToolResult = res.ok
              ? { id: tu.id, ok: true, output: res.output }
              : { id: tu.id, ok: false, error: res.error }
            emit(runId, opts.threadId, { kind: 'tool_call_persisted', call, result })
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: res.ok
              ? JSON.stringify(res.output)
              : `${res.error.code}: ${res.error.message}`,
            is_error: !res.ok
          })
        }
        messages = [...messages, { role: 'user', content: toolResults }]
      }
      if (iterationsExhausted) {
        // Previously the run just stopped silently mid-task.
        emit(runId, opts.threadId, {
          kind: 'text',
          text: `\n\n[Stopped: reached the ${MAX_TOOL_ITERATIONS}-tool-call limit for one turn. Send a follow-up message to continue.]`
        })
      }
      emit(runId, opts.threadId, { kind: 'message_end' })
    } catch (err) {
      if (run.userAborted) {
        // User pressed Stop: finalize the partial text quietly.
        emit(runId, opts.threadId, { kind: 'message_end' })
      } else {
        emit(runId, opts.threadId, classifyError(err, abort.signal.aborted))
      }
    } finally {
      clearTimeout(timeout)
      inflight.delete(runId)
      // Drop any approval the user never resolved before we exited.
      for (const id of emittedToolUseIds) {
        clearApproval(id, abort.signal.aborted ? 'run aborted' : 'run ended')
      }
      emittedToolUseIds.clear()
    }
  })()

  return runId
}

export function abortMachinaNative(runId: string): void {
  const run = inflight.get(runId)
  if (!run) return
  run.userAborted = true
  run.controller.abort()
}
