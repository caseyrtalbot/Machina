/**
 * Agent adapter registry (workstation contracts §3, Phase 2 step 1).
 *
 * Pure and renderer-importable (like `cli-agents.ts`): no Electron/Node
 * imports. Absorbs the per-adapter invocation switch previously at
 * `cli-thread-spawner.ts:63-96` (resume logic, `singleQuote`,
 * `SAFE_AGENT_SESSION_ID_RE`) plus the new model flag, and the structured
 * stream extractors from `cli-agent-thread-bridge.ts:267-313`. The spawner
 * and the bridge both dispatch through this registry; the originals are
 * deleted (contracts v1.2).
 *
 * Model rosters are SPIKE-VERIFIED ONLY (run 2026-07-06 against the
 * installed CLIs: claude 2.1.201, codex-cli 0.142.5, gemini 0.27.0). An id
 * may be listed only if a real invocation succeeded on this machine.
 */
import type {
  AdapterId,
  AgentAdapter,
  AgentStreamEvent,
  CliInvocationOptions
} from './session-types'
import type { AgentIdentity } from './agent-identity'
import type { ToolCall } from './cli-agents'
import { DEFAULT_NATIVE_MODEL } from './machina-native-tools'

/** Conservative shape for an id that is safe to interpolate into a shell line. */
export const SAFE_AGENT_SESSION_ID_RE = /^[0-9a-zA-Z-]{8,64}$/

/** POSIX single-quote escape: wrap in '...' and replace embedded ' with '\''. */
export function singleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// -- Model-flag trust rule (step 1, binding) ---------------------------------

/** Conservative charset for a model id that is safe on a shell line. */
export const MODEL_PICK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export type ModelPickResolution =
  | { readonly kind: 'default' }
  | { readonly kind: 'explicit'; readonly model: string }
  | { readonly kind: 'invalid'; readonly requested: string }

/**
 * The single home of the model-flag trust rule: a flag is emitted ONLY for
 * an explicit pick that passes BOTH membership in `adapter.models` AND the
 * conservative charset regex. Absent, unknown, or the persisted
 * `DEFAULT_NATIVE_MODEL` filler (every pre-step-1 CLI thread carries it) ⇒
 * `default` — no flag, adapter default. `invalid` means an explicit-but-
 * unverifiable pick: the caller emits no flag AND records an audit note.
 * Called at the IPC boundary; `formatInvocation` itself trusts its input.
 */
export function resolveModelPick(
  adapter: AgentAdapter,
  requested: string | undefined
): ModelPickResolution {
  if (requested === undefined || requested === DEFAULT_NATIVE_MODEL) return { kind: 'default' }
  if ((adapter.models ?? []).includes(requested) && MODEL_PICK_RE.test(requested)) {
    return { kind: 'explicit', model: requested }
  }
  return { kind: 'invalid', requested }
}

// -- Invocation formatting ----------------------------------------------------

function safeResumeId(opts: CliInvocationOptions): string | null {
  return opts.resumeSessionId !== undefined && SAFE_AGENT_SESSION_ID_RE.test(opts.resumeSessionId)
    ? opts.resumeSessionId
    : null
}

function formatClaudeInvocation(prompt: string, opts: CliInvocationOptions): string {
  const quoted = singleQuote(prompt)
  // --verbose is mandatory: `claude --print --output-format stream-json`
  // exits with an error without it. The model flag lands on the base flags
  // BEFORE --resume/--continue — spike-verified placement (model + resume
  // coexist; aliases like 'sonnet'/'haiku' accepted).
  const model = opts.model !== undefined ? ` --model ${opts.model}` : ''
  const base = `claude --print --verbose --output-format stream-json${model}`
  const resumeId = safeResumeId(opts)
  if (resumeId !== null) return `${base} --resume ${resumeId} ${quoted}`
  if (opts.continueConversation === true) return `${base} --continue ${quoted}`
  return `${base} ${quoted}`
}

function formatCodexInvocation(prompt: string, opts: CliInvocationOptions): string {
  const quoted = singleQuote(prompt)
  // --skip-git-repo-check: vaults are not guaranteed to be git repos and
  // codex exec refuses to run outside one otherwise. `-m` is accepted by
  // BOTH `codex exec` and `codex exec resume` and lands after the flags,
  // before the resume id — spike-verified placement.
  const model = opts.model !== undefined ? ` -m ${opts.model}` : ''
  const flags = `--json --skip-git-repo-check${model}`
  const resumeId = safeResumeId(opts)
  if (resumeId !== null) return `codex exec resume ${flags} ${resumeId} ${quoted}`
  if (opts.continueConversation === true) return `codex exec resume ${flags} --last ${quoted}`
  return `codex exec ${flags} ${quoted}`
}

function formatGeminiInvocation(prompt: string, opts: CliInvocationOptions): string {
  const quoted = singleQuote(prompt)
  // `-m` parse-verified from --help only (no gemini auth on the dev machine,
  // so no id could be real-run verified). The roster is empty, so in
  // practice `resolveModelPick` never yields an explicit model and this
  // branch is never taken in production — it exists and is unit-tested so
  // the placement is already correct when a roster lands.
  const model = opts.model !== undefined ? ` -m ${opts.model}` : ''
  return `gemini${model} -p ${quoted}`
}

/**
 * raw (OQ3): the whole command line comes from a single-line template
 * carrying the literal `{prompt}` placeholder; the prompt is single-quote-
 * escaped into every occurrence. No resume, no models, no parser. A missing,
 * multiline, or placeholder-less template is a caller bug — thrown here,
 * surfaced as a structured error upstream.
 */
function formatRawInvocation(prompt: string, opts: CliInvocationOptions): string {
  const template = opts.invocationTemplate
  if (template === undefined) {
    throw new Error('raw adapter requires opts.invocationTemplate (workstation OQ3)')
  }
  if (/[\r\n]/.test(template)) {
    throw new Error('raw invocation template must be a single line')
  }
  if (!template.includes('{prompt}')) {
    throw new Error(`raw invocation template is missing the '{prompt}' placeholder`)
  }
  return template.split('{prompt}').join(singleQuote(prompt))
}

// -- Structured stream parsing (ported from cli-agent-thread-bridge.ts) -------

const TOOL_PREVIEW_MAX = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function previewOf(value: unknown): string {
  try {
    const json = JSON.stringify(value) ?? ''
    return json.length > TOOL_PREVIEW_MAX ? json.slice(0, TOOL_PREVIEW_MAX) : json
  } catch {
    return ''
  }
}

/** One trimmed output line → parsed JSON record, or null when not one. */
function parseJsonRecordLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  return isRecord(parsed) ? parsed : null
}

/** One line of `claude --print --verbose --output-format stream-json`. */
function parseClaudeEvent(line: string): AgentStreamEvent | null {
  const obj = parseJsonRecordLine(line)
  if (obj === null) return null
  const agentSessionId = typeof obj.session_id === 'string' ? obj.session_id : null
  const texts: string[] = []
  const tools: ToolCall[] = []
  let resultText: string | null = null
  if (obj.type === 'assistant' && isRecord(obj.message) && Array.isArray(obj.message.content)) {
    for (const part of obj.message.content) {
      if (!isRecord(part)) continue
      if (part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text)
      } else if (part.type === 'tool_use' && typeof part.name === 'string') {
        tools.push({ name: part.name, inputPreview: previewOf(part.input) })
      }
    }
  } else if (obj.type === 'result' && typeof obj.result === 'string') {
    resultText = obj.result
  }
  return { agentSessionId, texts, tools, resultText }
}

const EMPTY_EVENT: AgentStreamEvent = {
  agentSessionId: null,
  texts: [],
  tools: [],
  resultText: null
}

/** One line of `codex exec --json` (experimental JSONL event stream). */
function parseCodexEvent(line: string): AgentStreamEvent | null {
  const obj = parseJsonRecordLine(line)
  if (obj === null) return null
  if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
    return { agentSessionId: obj.thread_id, texts: [], tools: [], resultText: null }
  }
  if (obj.type === 'item.completed' && isRecord(obj.item)) {
    const item = obj.item
    const itemType =
      typeof item.type === 'string'
        ? item.type
        : typeof item.item_type === 'string'
          ? item.item_type
          : null
    if (itemType === 'agent_message' && typeof item.text === 'string') {
      return { agentSessionId: null, texts: [item.text], tools: [], resultText: null }
    }
    if (itemType !== null && itemType !== 'agent_message' && itemType !== 'reasoning') {
      return {
        agentSessionId: null,
        texts: [],
        tools: [{ name: itemType, inputPreview: previewOf(item) }],
        resultText: null
      }
    }
  }
  // A parsed JSON record with nothing to extract is still a structured
  // event (non-null): consumers use non-null-ness as "saw structured output".
  return EMPTY_EVENT
}

// -- Registry ------------------------------------------------------------------

// Spike-verified 2026-07-06: `--model sonnet` and `--model haiku --resume <id>`
// real-run verified; help documents the 'fable'/'opus'/'sonnet' aliases.
const CLAUDE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const

// Spike-verified 2026-07-06: `-m gpt-5.5` and `-m gpt-5.4` real-run verified
// in both `codex exec` and `codex exec resume`. `gpt-5.5-codex` was REJECTED
// by the API (400 with a ChatGPT account) — deliberately not listed.
const CODEX_MODELS = ['gpt-5.5', 'gpt-5.4'] as const

// gemini: `-m` parses (from --help) but the dev machine has no gemini auth,
// so no model id could be real-run verified — ships empty (the picker offers
// nothing, the flag is never emitted). Contracts v1.2 records this.
const GEMINI_MODELS = [] as const

export const ADAPTERS: Record<AdapterId, AgentAdapter> = {
  claude: {
    id: 'claude',
    formatInvocation: formatClaudeInvocation,
    parseEvent: parseClaudeEvent,
    models: CLAUDE_MODELS
  },
  codex: {
    id: 'codex',
    formatInvocation: formatCodexInvocation,
    parseEvent: parseCodexEvent,
    models: CODEX_MODELS
  },
  gemini: {
    id: 'gemini',
    formatInvocation: formatGeminiInvocation,
    // No parseEvent: raw PTY projection (the bridge contract; a heuristic
    // parser exists in cli-agent-parsers.ts but the bridge never used it as
    // structured output).
    models: GEMINI_MODELS
  },
  raw: {
    id: 'raw',
    formatInvocation: formatRawInvocation
    // No parseEvent, no models, no resume: unknown CLIs work day one as a
    // plain PTY (PLAN Q8).
  }
}

/**
 * Map an adapter onto the thread-spawner identity that runs it. Re-based on
 * `AdapterId` in step 1; `harness-types.ts` re-exports it so harness
 * consumers keep one import surface (`HARNESS_ADAPTERS` stays CLI-only
 * until step 8).
 */
export function identityForAdapter(adapter: AdapterId): AgentIdentity {
  switch (adapter) {
    case 'claude':
      return 'cli-claude'
    case 'codex':
      return 'cli-codex'
    case 'gemini':
      return 'cli-gemini'
    case 'raw':
      return 'cli-raw'
  }
}
