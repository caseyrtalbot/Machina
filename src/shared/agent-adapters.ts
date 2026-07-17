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

export type RawInvocationTemplateValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string }

const RAW_PROMPT_PLACEHOLDER = '{prompt}'

interface TerminalControlCharacter {
  readonly index: number
  readonly codePoint: number
}

interface LoneSurrogate {
  readonly index: number
  readonly codeUnit: number
  readonly kind: 'high' | 'low'
}

const RAW_UNQUOTED_ATOM_RE = /^[A-Za-z0-9_./:@%+=,-]$/
const RAW_BARE_EXECUTABLE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@%+:,-]*$/
const RAW_PATH_EXECUTABLE_RE = /^[A-Za-z0-9_./][A-Za-z0-9_./@%+:,-]*$/

function findLoneSurrogate(value: string): LoneSurrogate | null {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1
        continue
      }
      return { index, codeUnit, kind: 'high' }
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return { index, codeUnit, kind: 'low' }
    }
  }
  return null
}

function describeLoneSurrogate(surrogate: LoneSurrogate): string {
  const code = surrogate.codeUnit.toString(16).toUpperCase().padStart(4, '0')
  return `lone ${surrogate.kind} surrogate U+${code} at index ${surrogate.index}`
}

/**
 * PTYs apply line editing before the shell sees a command. C0 bytes, DEL, and
 * C1 controls can erase or rewrite the bytes the bridge registered (Ctrl-U is
 * the concrete regression), so they cannot appear literally in a template.
 * The final formatted command may contain LF only because the harness prompt
 * is intentionally a POSIX single-quoted, multi-line argument.
 */
function findTerminalControl(
  value: string,
  allowLineFeed: boolean
): TerminalControlCharacter | null {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    if (isControl && !(allowLineFeed && codePoint === 0x0a)) {
      return { index, codePoint }
    }
  }
  return null
}

function terminalControlName(codePoint: number): string {
  const named: Readonly<Record<number, string>> = {
    0x00: 'NUL',
    0x07: 'BEL',
    0x08: 'BS',
    0x09: 'TAB',
    0x0a: 'LF',
    0x0b: 'VT',
    0x0c: 'FF',
    0x0d: 'CR',
    0x1b: 'ESC',
    0x7f: 'DEL'
  }
  const known = named[codePoint]
  if (known !== undefined) return known
  if (codePoint >= 0x01 && codePoint <= 0x1a) {
    return `Ctrl-${String.fromCharCode(0x40 + codePoint)}`
  }
  if (codePoint === 0x1c) return 'Ctrl-\\'
  if (codePoint === 0x1d) return 'Ctrl-]'
  if (codePoint === 0x1e) return 'Ctrl-^'
  if (codePoint === 0x1f) return 'Ctrl-_'
  return 'C1 control'
}

function describeTerminalControl(control: TerminalControlCharacter): string {
  const code = control.codePoint.toString(16).toUpperCase().padStart(4, '0')
  return `${terminalControlName(control.codePoint)} (U+${code}) at index ${control.index}`
}

/**
 * Conservatively admit one hook-stable shell command. Quotes are allowed for
 * ordinary literal arguments, but every prompt placeholder must occur in the
 * unquoted shell context so `singleQuote(prompt)` remains shell syntax rather
 * than literal quote bytes inside a surrounding quote. Compound commands are
 * refused because Bash's DEBUG hook reports only their first simple command,
 * breaking the bridge's byte-exact correlation.
 */
function validateRawTemplateShellShape(template: string): string | null {
  let quote: 'single' | 'double' | null = null
  let placeholders = 0
  const firstWordBoundary = template.indexOf(' ')

  for (let i = 0; i < template.length; i += 1) {
    if (template.startsWith(RAW_PROMPT_PLACEHOLDER, i)) {
      if (quote !== null) return 'raw prompt placeholder must be unquoted and unescaped'
      const before = i === 0 ? null : template[i - 1]
      const afterIndex = i + RAW_PROMPT_PLACEHOLDER.length
      const after = afterIndex === template.length ? null : template[afterIndex]
      if ((before !== null && before !== ' ') || (after !== null && after !== ' ')) {
        return 'raw prompt placeholder must be a standalone command word'
      }
      placeholders += 1
      i += RAW_PROMPT_PLACEHOLDER.length - 1
      continue
    }

    const char = template[i]
    if (quote === 'single') {
      if (char === "'") {
        quote = null
        const after = i + 1 === template.length ? null : template[i + 1]
        if (after !== null && after !== ' ') {
          return 'raw invocation template literal arguments must be wholly quoted'
        }
      }
      continue
    }
    if (quote === 'double') {
      if (char === '"') {
        quote = null
        const after = i + 1 === template.length ? null : template[i + 1]
        if (after !== null && after !== ' ') {
          return 'raw invocation template literal arguments must be wholly quoted'
        }
      } else if (char === '$' || char === '`' || char === '\\' || char === '!') {
        return 'raw invocation template quoted arguments must contain literal text only'
      }
      continue
    }

    if (char === "'") {
      if (firstWordBoundary !== -1 && i > firstWordBoundary && template[i - 1] !== ' ') {
        return 'raw invocation template literal arguments must be wholly quoted'
      }
      quote = 'single'
      continue
    }
    if (char === '"') {
      if (firstWordBoundary !== -1 && i > firstWordBoundary && template[i - 1] !== ' ') {
        return 'raw invocation template literal arguments must be wholly quoted'
      }
      quote = 'double'
      continue
    }
    if (char === '\\') {
      if (template.startsWith(RAW_PROMPT_PLACEHOLDER, i + 1)) {
        return 'raw prompt placeholder must be unquoted and unescaped'
      }
      return 'raw invocation template must not use unquoted shell escapes'
    }
    if (char === ' ') {
      if (i === 0 || i === template.length - 1 || template[i - 1] === ' ') {
        return 'raw invocation template must use exactly one unquoted space between command words'
      }
      continue
    }
    if (firstWordBoundary !== -1 && i > firstWordBoundary) {
      return 'raw invocation template literal arguments must be quoted to prevent shell alias expansion'
    }
    if (!RAW_UNQUOTED_ATOM_RE.test(char)) {
      return 'raw invocation template contains unsupported unquoted shell syntax'
    }
  }

  if (quote !== null) return 'raw invocation template has unbalanced quoting'
  if (placeholders === 0) {
    return `raw invocation template is missing the '${RAW_PROMPT_PLACEHOLDER}' placeholder`
  }
  const firstSpace = template.indexOf(' ')
  const executable = firstSpace === -1 ? template : template.slice(0, firstSpace)
  if (
    executable.length === 0 ||
    (executable.includes('/')
      ? !RAW_PATH_EXECUTABLE_RE.test(executable)
      : !RAW_BARE_EXECUTABLE_RE.test(executable))
  ) {
    return 'raw invocation template must name an unquoted executable first'
  }
  return null
}

function validateRawPtyCommandShellShape(command: string): string | null {
  const firstSpace = command.indexOf(' ')
  const executable = firstSpace === -1 ? command : command.slice(0, firstSpace)
  const escapedExecutable = executable.startsWith('\\') ? executable.slice(1) : ''
  const stableExecutable =
    escapedExecutable.length > 0 &&
    (escapedExecutable.includes('/')
      ? RAW_PATH_EXECUTABLE_RE.test(escapedExecutable)
      : RAW_BARE_EXECUTABLE_RE.test(escapedExecutable))
  if (!stableExecutable) {
    return 'raw PTY command executable must be alias-stable with one leading escape'
  }

  let quote: 'single' | 'double' | null = null
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (quote === 'single') {
      if (char === "'") quote = null
      continue
    }
    if (quote === 'double') {
      if (char === '"') {
        quote = null
      } else if (char === '$' || char === '`' || char === '\\' || char === '!') {
        return 'raw PTY command quoted arguments must contain literal text only'
      }
      continue
    }

    if (char === "'") {
      quote = 'single'
      continue
    }
    if (char === '"') {
      quote = 'double'
      continue
    }
    if (char === '\\') {
      if (i === 0) continue
      // `singleQuote` represents an apostrophe as the hook-stable `\'\\''`
      // sequence: close quote, escaped apostrophe, reopen quote.
      if (command[i - 1] === "'" && command[i + 1] === "'" && command[i + 2] === "'") {
        i += 1
        continue
      }
      return 'raw PTY command contains an unsupported unquoted shell escape'
    }
    if (char === ' ') {
      if (i === 0 || i === command.length - 1 || command[i - 1] === ' ') {
        return 'raw PTY command must use exactly one unquoted space between command words'
      }
      continue
    }
    if (char === '\n') return 'raw PTY command line feeds must remain inside a quoted argument'
    if (firstSpace !== -1 && i > firstSpace) {
      return 'raw PTY command literal arguments must remain quoted'
    }
    if (!RAW_UNQUOTED_ATOM_RE.test(char)) {
      return 'raw PTY command contains unsupported unquoted shell syntax'
    }
  }
  if (quote !== null) return 'raw PTY command has unbalanced quoting'
  return null
}

function stabilizeRawExecutable(command: string): string {
  return `\\${command}`
}

/**
 * Validate the executable template used by the raw adapter (OQ3).
 *
 * Draft creation, frontmatter parsing, lint, and final formatting all call
 * this function so the raw-command contract cannot drift between boundaries.
 * The command itself is intentionally user-authored; prompt bytes are quoted
 * separately by `formatRawInvocation`.
 */
export function validateRawInvocationTemplate(template: unknown): RawInvocationTemplateValidation {
  if (typeof template !== 'string' || template.length === 0) {
    return { ok: false, error: 'raw invocationTemplate is required' }
  }
  const surrogate = findLoneSurrogate(template)
  if (surrogate !== null) {
    return {
      ok: false,
      error: `raw invocation template must contain well-formed Unicode (${describeLoneSurrogate(surrogate)})`
    }
  }
  const control = findTerminalControl(template, false)
  if (control !== null) {
    const detail = describeTerminalControl(control)
    if (control.codePoint === 0x0a || control.codePoint === 0x0d) {
      return { ok: false, error: `raw invocation template must be a single line (${detail})` }
    }
    return {
      ok: false,
      error: `raw invocation template must not contain terminal control characters (${detail})`
    }
  }
  const shellError = validateRawTemplateShellShape(template)
  if (shellError !== null) return { ok: false, error: shellError }
  return { ok: true, value: template }
}

/**
 * Defense at the last pre-PTY boundary. Template validation catches unsafe
 * source syntax; this second check also catches controls or malformed Unicode
 * introduced by operator/harness prompt bytes after placeholder substitution,
 * and refuses command bytes a shell hook can normalize. LF is the sole control
 * exception because the prompt is one quoted multi-line shell argument. The
 * carriage return that submits the command is appended later by the spawner
 * and is deliberately not part of the registered command.
 */
export function validateRawPtyCommand(command: unknown): RawInvocationTemplateValidation {
  if (typeof command !== 'string' || command.length === 0) {
    return { ok: false, error: 'raw PTY command is required' }
  }
  const surrogate = findLoneSurrogate(command)
  if (surrogate !== null) {
    return {
      ok: false,
      error: `raw PTY command must contain well-formed Unicode (${describeLoneSurrogate(surrogate)})`
    }
  }
  const control = findTerminalControl(command, true)
  if (control !== null) {
    return {
      ok: false,
      error: `raw PTY command must not contain terminal control characters (${describeTerminalControl(control)})`
    }
  }
  const shellError = validateRawPtyCommandShellShape(command)
  if (shellError !== null) return { ok: false, error: shellError }
  return { ok: true, value: command }
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
 * malformed, terminal-control-bearing, or placeholder-less template is a
 * caller bug — thrown here and surfaced as a structured error upstream. The
 * final command is checked again after prompt substitution.
 */
function formatRawInvocation(prompt: string, opts: CliInvocationOptions): string {
  const validated = validateRawInvocationTemplate(opts.invocationTemplate)
  if (!validated.ok) throw new Error(validated.error)
  const command = stabilizeRawExecutable(
    validated.value.split('{prompt}').join(singleQuote(prompt))
  )
  const ptySafe = validateRawPtyCommand(command)
  if (!ptySafe.ok) throw new Error(ptySafe.error)
  return ptySafe.value
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
  let costUsd: number | null = null
  if (obj.type === 'assistant' && isRecord(obj.message) && Array.isArray(obj.message.content)) {
    for (const part of obj.message.content) {
      if (!isRecord(part)) continue
      if (part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text)
      } else if (part.type === 'tool_use' && typeof part.name === 'string') {
        tools.push({ name: part.name, inputPreview: previewOf(part.input) })
      }
    }
  } else if (obj.type === 'result') {
    if (typeof obj.result === 'string') resultText = obj.result
    // Spike-verified 2026-07-17 (claude 2.1.205): the terminal result record
    // carries `total_cost_usd` on success AND error subtypes —
    // error_during_execution / error_max_turns records carry cost but no
    // string `result` field, so the cost read must not gate on the text
    // field (a consistently-erroring loop burns real spend every firing).
    // `modelUsage.<id>.costUSD` repeats the same value under an
    // environment-specific key — deliberately not parsed.
    if (typeof obj.total_cost_usd === 'number' && Number.isFinite(obj.total_cost_usd)) {
      costUsd = obj.total_cost_usd
    }
  }
  return { agentSessionId, texts, tools, resultText, costUsd }
}

const EMPTY_EVENT: AgentStreamEvent = {
  agentSessionId: null,
  texts: [],
  tools: [],
  resultText: null,
  costUsd: null
}

/** One line of `codex exec --json` (experimental JSONL event stream). */
function parseCodexEvent(line: string): AgentStreamEvent | null {
  const obj = parseJsonRecordLine(line)
  if (obj === null) return null
  if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
    return { agentSessionId: obj.thread_id, texts: [], tools: [], resultText: null, costUsd: null }
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
      return {
        agentSessionId: null,
        texts: [item.text],
        tools: [],
        resultText: null,
        costUsd: null
      }
    }
    if (itemType !== null && itemType !== 'agent_message' && itemType !== 'reasoning') {
      return {
        agentSessionId: null,
        texts: [],
        tools: [{ name: itemType, inputPreview: previewOf(item) }],
        resultText: null,
        costUsd: null
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
