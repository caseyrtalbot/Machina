import Anthropic from '@anthropic-ai/sdk'
import { resolveAnthropicKey } from './anthropic-key'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import type { AgentNativeEventBody } from '@shared/ipc-channels'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TOKENS = 4096

interface RunOptions {
  readonly vaultPath: string
  readonly threadId: string
  readonly model: string
  readonly systemPrompt: string
  readonly userMessage: string
  readonly historyMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
}

const inflight = new Map<string, AbortController>()

function emit(runId: string, threadId: string, body: AgentNativeEventBody): void {
  const window = getMainWindow()
  if (!window) return
  typedSend(window, 'agent-native:event', { runId, threadId, ...body })
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

export async function runMachinaNative(opts: RunOptions): Promise<string> {
  const key = await resolveAnthropicKey()
  if (!key) throw new Error('AUTH: no Anthropic API key configured')
  const client = new Anthropic({ apiKey: key })

  const runId = newRunId()
  const abort = new AbortController()
  inflight.set(runId, abort)
  const timeout = setTimeout(() => abort.abort(), DEFAULT_TIMEOUT_MS)

  const messages: Anthropic.MessageParam[] = [
    ...opts.historyMessages.map((m) => ({ role: m.role, content: m.content }) as const),
    { role: 'user' as const, content: opts.userMessage }
  ]

  void (async () => {
    try {
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
          messages
        },
        { signal: abort.signal }
      )

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          emit(runId, opts.threadId, { kind: 'text', text: event.delta.text })
        }
      }
      emit(runId, opts.threadId, { kind: 'message_end' })
    } catch (err) {
      emit(runId, opts.threadId, classifyError(err, abort.signal.aborted))
    } finally {
      clearTimeout(timeout)
      inflight.delete(runId)
    }
  })()

  return runId
}

export function abortMachinaNative(runId: string): void {
  inflight.get(runId)?.abort()
}
