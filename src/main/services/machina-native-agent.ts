import Anthropic from '@anthropic-ai/sdk'
import { resolveAnthropicKey } from './anthropic-key'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { NATIVE_TOOLS_V0 } from '@shared/machina-native-tools'
import { callTool, clearApproval } from './machina-native-tools'
import type { AgentNativeEventBody, DockAction } from '@shared/ipc-channels'
import type { DockTab } from '@shared/dock-types'
import type { ToolCall, ToolResult } from '@shared/thread-types'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TOKENS = 4096
const MAX_TOOL_ITERATIONS = 8

interface RunOptions {
  readonly vaultPath: string
  readonly threadId: string
  readonly model: string
  readonly systemPrompt: string
  readonly userMessage: string
  readonly historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  readonly autoAccept?: boolean
  readonly dockTabsSnapshot?: ReadonlyArray<DockTab>
}

const inflight = new Map<string, AbortController>()

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

function asToolCall(name: string, id: string, input: Record<string, unknown>): ToolCall | null {
  if (name === 'read_note' && typeof input.path === 'string') {
    return { id, kind: 'read_note', args: { path: input.path } }
  }
  if (name === 'list_vault') {
    const raw = input.globs
    const globs =
      Array.isArray(raw) && raw.every((g): g is string => typeof g === 'string')
        ? (raw as string[])
        : undefined
    return { id, kind: 'list_vault', args: globs ? { globs } : {} }
  }
  if (
    name === 'write_note' &&
    typeof input.path === 'string' &&
    typeof input.content === 'string'
  ) {
    return { id, kind: 'write_note', args: { path: input.path, content: input.content } }
  }
  if (
    name === 'edit_note' &&
    typeof input.path === 'string' &&
    typeof input.find === 'string' &&
    typeof input.replace === 'string'
  ) {
    return {
      id,
      kind: 'edit_note',
      args: { path: input.path, find: input.find, replace: input.replace }
    }
  }
  if (name === 'search_vault' && typeof input.query === 'string') {
    const rawPaths = input.paths
    const paths =
      Array.isArray(rawPaths) && rawPaths.every((p): p is string => typeof p === 'string')
        ? (rawPaths as string[])
        : undefined
    return {
      id,
      kind: 'search_vault',
      args: paths ? { query: input.query, paths } : { query: input.query }
    }
  }
  if (name === 'read_canvas' && typeof input.canvasId === 'string') {
    return { id, kind: 'read_canvas', args: { canvasId: input.canvasId } }
  }
  if (
    name === 'pin_to_canvas' &&
    typeof input.canvasId === 'string' &&
    input.card &&
    typeof input.card === 'object'
  ) {
    const c = input.card as Record<string, unknown>
    if (typeof c.title === 'string') {
      const content = typeof c.content === 'string' ? c.content : undefined
      const rawPos = c.position
      let position: { x: number; y: number } | undefined
      if (rawPos && typeof rawPos === 'object') {
        const pos = rawPos as Record<string, unknown>
        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
          position = { x: pos.x, y: pos.y }
        }
      }
      const rawRefs = c.refs
      const refs =
        Array.isArray(rawRefs) && rawRefs.every((r): r is string => typeof r === 'string')
          ? (rawRefs as string[])
          : undefined
      return {
        id,
        kind: 'pin_to_canvas',
        args: {
          canvasId: input.canvasId,
          card: {
            title: c.title,
            ...(content !== undefined ? { content } : {}),
            ...(position ? { position } : {}),
            ...(refs ? { refs } : {})
          }
        }
      }
    }
  }
  return null
}

export async function runMachinaNative(opts: RunOptions): Promise<string> {
  const key = await resolveAnthropicKey()
  if (!key) throw new Error('AUTH: no Anthropic API key configured')
  const client = new Anthropic({ apiKey: key })

  const runId = newRunId()
  const abort = new AbortController()
  inflight.set(runId, abort)
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

  void (async () => {
    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        resetTimeout()
        const stream = client.messages.stream(
          {
            model: opts.model,
            max_tokens: MAX_TOKENS,
            system: [
              {
                type: 'text',
                text: opts.systemPrompt,
                cache_control: { type: 'ephemeral' }
              }
            ],
            tools: NATIVE_TOOLS_V0.map((t) => ({
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
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            emit(runId, opts.threadId, { kind: 'text', text: event.delta.text })
          }
        }

        const final = await stream.finalMessage()
        messages = [...messages, { role: 'assistant', content: final.content }]

        const toolUses = final.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        )
        if (toolUses.length === 0) break

        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          const input = (tu.input ?? {}) as Record<string, unknown>
          const call = asToolCall(tu.name, tu.id, input)

          // Approval-gated tools: emit pending immediately so the renderer
          // can render the diff card *before* callTool blocks on the user.
          // Pause the SDK timeout while we wait on the human.
          clearTimeout(timeout)
          emittedToolUseIds.add(tu.id)
          const res = await callTool(tu.name, input, {
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
            signal: abort.signal
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
      emit(runId, opts.threadId, { kind: 'message_end' })
    } catch (err) {
      emit(runId, opts.threadId, classifyError(err, abort.signal.aborted))
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
  inflight.get(runId)?.abort()
}
