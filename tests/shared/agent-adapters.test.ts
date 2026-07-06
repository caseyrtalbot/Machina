import { describe, expect, it } from 'vitest'
import {
  ADAPTERS,
  identityForAdapter,
  resolveModelPick,
  MODEL_PICK_RE,
  SAFE_AGENT_SESSION_ID_RE,
  singleQuote
} from '@shared/agent-adapters'
import type { AgentAdapter, CliInvocationOptions } from '@shared/session-types'
import { AGENT_IDENTITIES, isAgentIdentity } from '@shared/agent-identity'
import { getAgentSpec, RAW_AGENT_SPEC, CLI_AGENTS } from '@shared/cli-agents'
import { identityForAdapter as identityForAdapterReExport } from '@shared/harness-types'

const PROMPT = 'summarize the vault'
const P = `'summarize the vault'` // singleQuote(PROMPT)
const RESUME_ID = '206caf50-df65-4a64-adf2-0749f4637bf7'

describe('golden invocation table (byte-exact regression harness)', () => {
  // The seven NO-MODEL strings are current production behavior
  // (cli-thread-spawner.ts formatCliInvocation) and MUST stay byte-identical.
  const noModel: ReadonlyArray<[string, CliInvocationOptions, string]> = [
    ['claude fresh', {}, `claude --print --verbose --output-format stream-json ${P}`],
    [
      'claude resume',
      { resumeSessionId: RESUME_ID },
      `claude --print --verbose --output-format stream-json --resume ${RESUME_ID} ${P}`
    ],
    [
      'claude continue',
      { continueConversation: true },
      `claude --print --verbose --output-format stream-json --continue ${P}`
    ]
  ]
  for (const [name, opts, expected] of noModel) {
    it(`no-model ${name}`, () => {
      expect(ADAPTERS.claude.formatInvocation(PROMPT, opts)).toBe(expected)
    })
  }

  it('no-model codex fresh', () => {
    expect(ADAPTERS.codex.formatInvocation(PROMPT, {})).toBe(
      `codex exec --json --skip-git-repo-check ${P}`
    )
  })
  it('no-model codex resume', () => {
    expect(ADAPTERS.codex.formatInvocation(PROMPT, { resumeSessionId: RESUME_ID })).toBe(
      `codex exec resume --json --skip-git-repo-check ${RESUME_ID} ${P}`
    )
  })
  it('no-model codex continue', () => {
    expect(ADAPTERS.codex.formatInvocation(PROMPT, { continueConversation: true })).toBe(
      `codex exec resume --json --skip-git-repo-check --last ${P}`
    )
  })
  it('no-model gemini (fresh; resume/continue are ignored — gemini has neither)', () => {
    expect(ADAPTERS.gemini.formatInvocation(PROMPT, {})).toBe(`gemini -p ${P}`)
    expect(ADAPTERS.gemini.formatInvocation(PROMPT, { resumeSessionId: RESUME_ID })).toBe(
      `gemini -p ${P}`
    )
    expect(ADAPTERS.gemini.formatInvocation(PROMPT, { continueConversation: true })).toBe(
      `gemini -p ${P}`
    )
  })

  // Model-flag placement, exactly as spike-verified (2026-07-06).
  it('claude model flag lands on the base flags before --resume/--continue', () => {
    const base = `claude --print --verbose --output-format stream-json --model sonnet`
    expect(ADAPTERS.claude.formatInvocation(PROMPT, { model: 'sonnet' })).toBe(`${base} ${P}`)
    expect(
      ADAPTERS.claude.formatInvocation(PROMPT, { model: 'sonnet', resumeSessionId: RESUME_ID })
    ).toBe(`${base} --resume ${RESUME_ID} ${P}`)
    expect(
      ADAPTERS.claude.formatInvocation(PROMPT, { model: 'sonnet', continueConversation: true })
    ).toBe(`${base} --continue ${P}`)
  })

  it('codex -m lands after --json --skip-git-repo-check, before the resume id', () => {
    expect(ADAPTERS.codex.formatInvocation(PROMPT, { model: 'gpt-5.5' })).toBe(
      `codex exec --json --skip-git-repo-check -m gpt-5.5 ${P}`
    )
    expect(
      ADAPTERS.codex.formatInvocation(PROMPT, { model: 'gpt-5.5', resumeSessionId: RESUME_ID })
    ).toBe(`codex exec resume --json --skip-git-repo-check -m gpt-5.5 ${RESUME_ID} ${P}`)
    expect(
      ADAPTERS.codex.formatInvocation(PROMPT, { model: 'gpt-5.5', continueConversation: true })
    ).toBe(`codex exec resume --json --skip-git-repo-check -m gpt-5.5 --last ${P}`)
  })

  it('gemini -m lands before -p (code path exists even though the roster is empty)', () => {
    expect(ADAPTERS.gemini.formatInvocation(PROMPT, { model: 'gemini-2.5-pro' })).toBe(
      `gemini -m gemini-2.5-pro -p ${P}`
    )
  })

  // Every post-first-turn send in production sets BOTH fields together
  // (cli-thread-spawner.ts sendUserMessage: bridge-captured resumeSessionId +
  // turnsSent → continueConversation). Resume-by-id MUST win: '--continue' /
  // 'resume --last' would silently lose exact-session pinning (cross-talk
  // with other CLI runs in the same cwd — the reason resumeSessionId exists).
  it('claude: resume-by-id wins over continueConversation when both are set', () => {
    const both: CliInvocationOptions = { resumeSessionId: RESUME_ID, continueConversation: true }
    expect(ADAPTERS.claude.formatInvocation(PROMPT, both)).toBe(
      `claude --print --verbose --output-format stream-json --resume ${RESUME_ID} ${P}`
    )
    expect(ADAPTERS.claude.formatInvocation(PROMPT, { ...both, model: 'sonnet' })).toBe(
      `claude --print --verbose --output-format stream-json --model sonnet --resume ${RESUME_ID} ${P}`
    )
  })

  it('codex: resume-by-id wins over continueConversation when both are set (no --last)', () => {
    const both: CliInvocationOptions = { resumeSessionId: RESUME_ID, continueConversation: true }
    expect(ADAPTERS.codex.formatInvocation(PROMPT, both)).toBe(
      `codex exec resume --json --skip-git-repo-check ${RESUME_ID} ${P}`
    )
    expect(ADAPTERS.codex.formatInvocation(PROMPT, { ...both, model: 'gpt-5.5' })).toBe(
      `codex exec resume --json --skip-git-repo-check -m gpt-5.5 ${RESUME_ID} ${P}`
    )
  })

  it('an unsafe resume id is dropped, falling back to fresh/continue', () => {
    const bad = { resumeSessionId: `x; rm -rf /` }
    expect(SAFE_AGENT_SESSION_ID_RE.test(bad.resumeSessionId)).toBe(false)
    expect(ADAPTERS.claude.formatInvocation(PROMPT, bad)).toBe(
      `claude --print --verbose --output-format stream-json ${P}`
    )
    expect(ADAPTERS.codex.formatInvocation(PROMPT, { ...bad, continueConversation: true })).toBe(
      `codex exec resume --json --skip-git-repo-check --last ${P}`
    )
  })

  it('the prompt is POSIX single-quote escaped', () => {
    expect(singleQuote(`don't`)).toBe(`'don'\\''t'`)
    expect(ADAPTERS.gemini.formatInvocation(`don't`, {})).toBe(`gemini -p 'don'\\''t'`)
  })
})

describe('model-flag trust rule (resolveModelPick)', () => {
  it('absent model resolves to the adapter default (no flag)', () => {
    expect(resolveModelPick(ADAPTERS.claude, undefined)).toEqual({ kind: 'default' })
  })

  it('the persisted DEFAULT_NATIVE_MODEL filler resolves to default, never invalid', () => {
    // Every pre-step-1 CLI thread carries 'claude-sonnet-4-6' as filler.
    expect(resolveModelPick(ADAPTERS.claude, 'claude-sonnet-4-6')).toEqual({ kind: 'default' })
    expect(resolveModelPick(ADAPTERS.codex, 'claude-sonnet-4-6')).toEqual({ kind: 'default' })
  })

  it('an explicit roster member resolves to explicit', () => {
    expect(resolveModelPick(ADAPTERS.claude, 'sonnet')).toEqual({
      kind: 'explicit',
      model: 'sonnet'
    })
    expect(resolveModelPick(ADAPTERS.claude, 'haiku')).toEqual({ kind: 'explicit', model: 'haiku' })
    expect(resolveModelPick(ADAPTERS.codex, 'gpt-5.5')).toEqual({
      kind: 'explicit',
      model: 'gpt-5.5'
    })
    expect(resolveModelPick(ADAPTERS.codex, 'gpt-5.4')).toEqual({
      kind: 'explicit',
      model: 'gpt-5.4'
    })
  })

  it('a cross-adapter or unknown pick is invalid (no flag + audit note upstream)', () => {
    // A codex thread must never emit -m claude-sonnet-4-6 nor claude aliases.
    expect(resolveModelPick(ADAPTERS.codex, 'sonnet')).toEqual({
      kind: 'invalid',
      requested: 'sonnet'
    })
    expect(resolveModelPick(ADAPTERS.claude, 'gpt-5.5')).toEqual({
      kind: 'invalid',
      requested: 'gpt-5.5'
    })
    // gpt-5.5-codex was real-run REJECTED by the API — must not be offered.
    expect(resolveModelPick(ADAPTERS.codex, 'gpt-5.5-codex')).toEqual({
      kind: 'invalid',
      requested: 'gpt-5.5-codex'
    })
  })

  it('gemini (empty roster) and raw (no models) never resolve an explicit model', () => {
    expect(ADAPTERS.gemini.models).toEqual([])
    expect(ADAPTERS.raw.models).toBeUndefined()
    expect(resolveModelPick(ADAPTERS.gemini, 'gemini-2.5-pro')).toEqual({
      kind: 'invalid',
      requested: 'gemini-2.5-pro'
    })
    expect(resolveModelPick(ADAPTERS.raw, 'anything')).toEqual({
      kind: 'invalid',
      requested: 'anything'
    })
  })

  it('membership alone is not enough: the charset regex is a second gate', () => {
    const shady: AgentAdapter = {
      id: 'claude',
      formatInvocation: () => '',
      models: ['bad;model']
    }
    expect(MODEL_PICK_RE.test('bad;model')).toBe(false)
    expect(resolveModelPick(shady, 'bad;model')).toEqual({
      kind: 'invalid',
      requested: 'bad;model'
    })
  })
})

describe('raw adapter semantics', () => {
  it('has no parseEvent, no models, no resume behavior', () => {
    expect(ADAPTERS.raw.parseEvent).toBeUndefined()
    expect(ADAPTERS.raw.models).toBeUndefined()
  })

  it('single-quotes the prompt into every {prompt} occurrence of the template', () => {
    expect(
      ADAPTERS.raw.formatInvocation(`don't stop`, { invocationTemplate: 'mycli --ask {prompt}' })
    ).toBe(`mycli --ask 'don'\\''t stop'`)
    expect(
      ADAPTERS.raw.formatInvocation('x', { invocationTemplate: 'a {prompt} b {prompt}' })
    ).toBe(`a 'x' b 'x'`)
  })

  it('rejects a missing template', () => {
    expect(() => ADAPTERS.raw.formatInvocation(PROMPT, {})).toThrow(/invocationTemplate/)
  })

  it('rejects a multiline template', () => {
    expect(() =>
      ADAPTERS.raw.formatInvocation(PROMPT, { invocationTemplate: 'mycli {prompt}\nrm -rf /' })
    ).toThrow(/single line/)
  })

  it('rejects a template without the {prompt} placeholder', () => {
    expect(() =>
      ADAPTERS.raw.formatInvocation(PROMPT, { invocationTemplate: 'mycli --version' })
    ).toThrow(/\{prompt\}/)
  })
})

describe('parseEvent parity with the bridge extractors', () => {
  // Fixtures mirror src/main/services/__tests__/cli-agent-thread-bridge.test.ts
  // (shapes verified against claude 2.1.170 and codex CLI on 2026-06-10).
  const CLAUDE_SESSION = '206caf50-df65-4a64-adf2-0749f4637bf7'
  const parseClaude = ADAPTERS.claude.parseEvent!
  const parseCodex = ADAPTERS.codex.parseEvent!

  it('claude: init line yields the session id and nothing else', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/v',
      session_id: CLAUDE_SESSION
    })
    expect(parseClaude(line)).toEqual({
      agentSessionId: CLAUDE_SESSION,
      texts: [],
      tools: [],
      resultText: null
    })
  })

  it('claude: assistant text content becomes texts', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] },
      session_id: CLAUDE_SESSION
    })
    const event = parseClaude(line)
    expect(event?.texts).toEqual(['Hello.'])
    expect(event?.agentSessionId).toBe(CLAUDE_SESSION)
    expect(event?.tools).toEqual([])
    expect(event?.resultText).toBeNull()
  })

  it('claude: tool_use content becomes a tool with an input preview', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.ts' } }]
      },
      session_id: CLAUDE_SESSION
    })
    const event = parseClaude(line)
    expect(event?.tools).toEqual([{ name: 'Read', inputPreview: '{"file_path":"/a.ts"}' }])
    expect(event?.texts).toEqual([])
  })

  it('claude: the terminal result line lands in resultText (fallback slot)', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Final answer.',
      session_id: CLAUDE_SESSION
    })
    const event = parseClaude(line)
    expect(event?.resultText).toBe('Final answer.')
    expect(event?.texts).toEqual([])
  })

  it('claude: non-JSON and non-record lines are null (not structured)', () => {
    expect(parseClaude('Reading additional input from stdin...')).toBeNull()
    expect(parseClaude('{not json}')).toBeNull()
    expect(parseClaude('[1,2,3]')).toBeNull()
    expect(parseClaude('  { "type": "system", "session_id": "abc" }  ')).not.toBeNull()
  })

  const CODEX_THREAD = '019eb1da-decb-7052-a145-1ac71e4bc80b'

  it('codex: thread.started yields the agent session id', () => {
    const line = JSON.stringify({ type: 'thread.started', thread_id: CODEX_THREAD })
    expect(parseCodex(line)).toEqual({
      agentSessionId: CODEX_THREAD,
      texts: [],
      tools: [],
      resultText: null
    })
  })

  it('codex: item.completed agent_message yields text', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_2', type: 'agent_message', text: 'ok' }
    })
    expect(parseCodex(line)?.texts).toEqual(['ok'])
  })

  it('codex: non-message items become tools; reasoning is dropped', () => {
    const exec = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'command_execution', command: 'ls -la' }
    })
    const event = parseCodex(exec)
    expect(event?.tools.map((t) => t.name)).toEqual(['command_execution'])
    const reasoning = JSON.stringify({
      type: 'item.completed',
      item: { id: 'i', type: 'reasoning' }
    })
    expect(parseCodex(reasoning)).toEqual({
      agentSessionId: null,
      texts: [],
      tools: [],
      resultText: null
    })
  })

  it('codex: item_type is accepted as the item.completed discriminant fallback', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'i', item_type: 'agent_message', text: 'via item_type' }
    })
    expect(parseCodex(line)?.texts).toEqual(['via item_type'])
  })

  it('codex: unmatched JSON records are non-null empty events (structured-seen signal); non-JSON is null', () => {
    const turn = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1 } })
    expect(parseCodex(turn)).toEqual({
      agentSessionId: null,
      texts: [],
      tools: [],
      resultText: null
    })
    expect(
      parseCodex('2026-06-10T14:08:01.334563Z ERROR codex_memories_write::phase2: no changes')
    ).toBeNull()
  })

  it('gemini has no parseEvent (raw PTY projection — the bridge contract)', () => {
    expect(ADAPTERS.gemini.parseEvent).toBeUndefined()
  })
})

describe('identityForAdapter (re-based on AdapterId)', () => {
  it('maps every adapter, including raw', () => {
    expect(identityForAdapter('claude')).toBe('cli-claude')
    expect(identityForAdapter('codex')).toBe('cli-codex')
    expect(identityForAdapter('gemini')).toBe('cli-gemini')
    expect(identityForAdapter('raw')).toBe('cli-raw')
  })

  it('stays available as a harness-types re-export', () => {
    expect(identityForAdapterReExport).toBe(identityForAdapter)
  })
})

describe('cli-raw identity and raw agent spec', () => {
  it('AGENT_IDENTITIES gains cli-raw appended at the end', () => {
    expect(AGENT_IDENTITIES[AGENT_IDENTITIES.length - 1]).toBe('cli-raw')
    expect(isAgentIdentity('cli-raw')).toBe(true)
  })

  it('raw spec is always available and kept out of the probeable CLI_AGENTS', () => {
    expect(RAW_AGENT_SPEC.alwaysAvailable).toBe(true)
    expect(CLI_AGENTS.map((a) => a.id)).not.toContain('raw')
    expect(getAgentSpec('raw')).toBe(RAW_AGENT_SPEC)
  })
})
