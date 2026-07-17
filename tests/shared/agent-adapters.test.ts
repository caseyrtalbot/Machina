import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  ADAPTERS,
  identityForAdapter,
  resolveModelPick,
  MODEL_PICK_RE,
  SAFE_AGENT_SESSION_ID_RE,
  singleQuote,
  validateRawInvocationTemplate,
  validateRawPtyCommand
} from '@shared/agent-adapters'
import type { AgentAdapter, CliInvocationOptions } from '@shared/session-types'
import { AGENT_IDENTITIES, isAgentIdentity } from '@shared/agent-identity'
import { createBlockDetector } from '@shared/engine/block-detector'
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
      ADAPTERS.raw.formatInvocation(`don't stop`, { invocationTemplate: "mycli '--ask' {prompt}" })
    ).toBe(`\\mycli '--ask' 'don'\\''t stop'`)
    expect(
      ADAPTERS.raw.formatInvocation('x', { invocationTemplate: "a {prompt} 'b' {prompt}" })
    ).toBe(`\\a 'x' 'b' 'x'`)
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
      ADAPTERS.raw.formatInvocation(PROMPT, { invocationTemplate: "mycli '--version'" })
    ).toThrow(/\{prompt\}/)
  })

  it('uses one shared structural validator, including NUL rejection', () => {
    expect(validateRawInvocationTemplate('mycli {prompt}')).toEqual({
      ok: true,
      value: 'mycli {prompt}'
    })
    expect(validateRawInvocationTemplate(undefined)).toMatchObject({ ok: false })
    expect(validateRawInvocationTemplate('mycli {prompt}\0tail')).toMatchObject({
      ok: false,
      error: expect.stringContaining('NUL')
    })
  })

  it('rejects every C0, DEL, and C1 terminal control in a raw template', () => {
    const controls = [
      ...Array.from({ length: 0x20 }, (_, codePoint) => codePoint),
      ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset)
    ]
    for (const codePoint of controls) {
      const invocationTemplate = `mycli ${String.fromCharCode(codePoint)}{prompt}`
      expect(
        validateRawInvocationTemplate(invocationTemplate),
        `expected U+${codePoint.toString(16).padStart(4, '0')} to be refused`
      ).toMatchObject({ ok: false })
      if (codePoint !== 0x0a) {
        expect(
          validateRawPtyCommand(`\\mycli '${String.fromCharCode(codePoint)}'`),
          `expected final PTY command U+${codePoint.toString(16).padStart(4, '0')} to be refused`
        ).toMatchObject({ ok: false })
      }
    }
  })

  it.each([
    ['Ctrl-U', '\x15', 'Ctrl-U', 'U+0015'],
    ['ESC', '\x1b', 'ESC', 'U+001B'],
    ['DEL', '\x7f', 'DEL', 'U+007F'],
    ['C1 CSI', '\u009b', 'C1 control', 'U+009B']
  ])('reports the exact %s terminal control', (_label, control, name, codePoint) => {
    const result = validateRawInvocationTemplate(`mycli ${control}{prompt}`)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('terminal control characters')
      expect(result.error).toContain(name)
      expect(result.error).toContain(codePoint)
    }
  })

  it('guards the final PTY command while allowing the quoted prompt line feeds', () => {
    expect(validateRawPtyCommand("\\mycli 'line one\nline two'")).toEqual({
      ok: true,
      value: "\\mycli 'line one\nline two'"
    })
    expect(validateRawPtyCommand("\\mycli 'before\x15after'")).toMatchObject({
      ok: false,
      error: expect.stringContaining('Ctrl-U')
    })
    expect(() =>
      ADAPTERS.raw.formatInvocation('before\x15after', {
        invocationTemplate: "mycli '--ask' {prompt}"
      })
    ).toThrow(/Ctrl-U/)
  })

  it('refuses quoted or escaped prompt placeholders before shell expansion is possible', () => {
    for (const invocationTemplate of [
      'mycli \'--ask\' "{prompt}"',
      "mycli '--ask' '{prompt}'",
      "mycli '--ask' \\{prompt}"
    ]) {
      expect(validateRawInvocationTemplate(invocationTemplate)).toMatchObject({
        ok: false,
        error: expect.stringContaining('unquoted and unescaped')
      })
      expect(() =>
        ADAPTERS.raw.formatInvocation('$(printf injected)', { invocationTemplate })
      ).toThrow(/unquoted and unescaped/)
    }
  })

  it('allows balanced literal argument quotes while keeping an unquoted placeholder safe', () => {
    const invocationTemplate = 'printf "%s" {prompt}'
    expect(validateRawInvocationTemplate(invocationTemplate)).toEqual({
      ok: true,
      value: invocationTemplate
    })
    const command = ADAPTERS.raw.formatInvocation('$(printf injected)', { invocationTemplate })
    expect(command).toBe(`\\printf "%s" '$(printf injected)'`)
    expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toBe(
      '$(printf injected)'
    )
  })

  it('rejects history expansion inside double-quoted template arguments', () => {
    // Interactive Bash and zsh can expand `!` before DEBUG/preexec observes
    // the command, so the registered bytes would no longer match the hook.
    for (const invocationTemplate of ['mycli "!!" {prompt}', 'mycli "prefix!suffix" {prompt}']) {
      expect(validateRawInvocationTemplate(invocationTemplate), invocationTemplate).toMatchObject({
        ok: false,
        error: expect.stringContaining('literal text only')
      })
      expect(() => ADAPTERS.raw.formatInvocation('safe', { invocationTemplate })).toThrow(
        /literal text only/
      )
    }

    expect(validateRawPtyCommand('\\mycli "!!" \'safe\'')).toMatchObject({
      ok: false,
      error: expect.stringContaining('literal text only')
    })
  })

  it('requires every prompt placeholder to be one standalone simple-command word', () => {
    for (const invocationTemplate of [
      'printf "%s" $[{prompt}]',
      'printf "%s" $[ {prompt} ]',
      'mycli arr[{prompt}]',
      'mycli arr[ {prompt} ]',
      'mycli --ask={prompt}',
      'mycli {prompt}suffix',
      'mycli ${value:-{prompt}}'
    ]) {
      expect(validateRawInvocationTemplate(invocationTemplate), invocationTemplate).toMatchObject({
        ok: false
      })
      expect(() =>
        ADAPTERS.raw.formatInvocation('$(/usr/bin/printf injected)', { invocationTemplate })
      ).toThrow()
    }
  })

  it('rejects hook-unstable spacing and makes a bare executable alias-stable', () => {
    for (const invocationTemplate of [
      ' mycli {prompt}',
      'mycli {prompt} ',
      'mycli  {prompt}',
      "mycli {prompt}  '--final'"
    ]) {
      expect(validateRawInvocationTemplate(invocationTemplate), invocationTemplate).toMatchObject({
        ok: false,
        error: expect.stringContaining('exactly one unquoted space')
      })
    }

    expect(validateRawInvocationTemplate('mycli "two  spaces" {prompt}')).toMatchObject({
      ok: true
    })
    expect(validateRawPtyCommand("mycli 'safe'")).toMatchObject({
      ok: false,
      error: expect.stringContaining('leading escape')
    })
    expect(ADAPTERS.raw.formatInvocation('safe', { invocationTemplate: 'mycli {prompt}' })).toBe(
      "\\mycli 'safe'"
    )
  })

  it('matches the formatted bytes observed by a real Bash DEBUG hook despite an alias', () => {
    const prompt = "hello 'world'\nsecond line"
    const command = ADAPTERS.raw.formatInvocation(prompt, {
      invocationTemplate: 'printf "%s" {prompt}'
    })
    const hookPath = join(__dirname, '..', '..', 'resources', 'shell-hooks', 'te.bash')
    const script = [
      `source ${singleQuote(hookPath)}`,
      `alias printf='builtin printf "ALIASED"'`,
      'shopt -s expand_aliases',
      // Close the setup command captured after the production DEBUG trap was
      // installed, then observe the formatted raw invocation as its own block.
      '__te_prompt_command',
      command,
      '__te_prompt_command'
    ].join('\n')

    const observed = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, TE_SESSION_ID: 'raw-hook-test' }
    })
    expect(observed.error).toBeUndefined()
    expect(observed.status).toBe(0)
    const events = createBlockDetector().consume(observed.stdout)
    const starts = events.filter((event) => event.kind === 'command-start')
    expect(
      starts.some((event) => event.kind === 'command-start' && event.command === command)
    ).toBe(true)
    const output = events
      .filter((event) => event.kind === 'output-chunk')
      .map((event) => (event.kind === 'output-chunk' ? event.text : ''))
      .join('')
    expect(output).toContain(prompt)
  })

  it('prevents zsh global and slash-path aliases from rewriting the command', () => {
    const command = ADAPTERS.raw.formatInvocation('PROMPT', {
      invocationTemplate: "/bin/echo 'G' {prompt}"
    })
    expect(command).toBe("\\/bin/echo 'G' 'PROMPT'")

    const script = [
      `alias -g G='; print GLOBAL_EXECUTED; print'`,
      `alias '/bin/echo=print PATH_ALIAS'`,
      `eval ${singleQuote(command)}`
    ].join('\n')
    const observed = spawnSync('zsh', ['-f', '-c', script], { encoding: 'utf8' })

    expect(observed.error).toBeUndefined()
    expect(observed.status).toBe(0)
    expect(observed.stdout.trim()).toBe('G PROMPT')
    expect(observed.stdout).not.toContain('GLOBAL_EXECUTED')
    expect(observed.stdout).not.toContain('PATH_ALIAS')
  })

  it('requires quoted literal arguments and escapes both bare and path executables', () => {
    for (const invocationTemplate of [
      'mycli --ask {prompt}',
      'mycli GLOBAL {prompt}',
      'mycli "safe"suffix {prompt}'
    ]) {
      expect(validateRawInvocationTemplate(invocationTemplate), invocationTemplate).toMatchObject({
        ok: false
      })
    }

    expect(
      ADAPTERS.raw.formatInvocation('safe', {
        invocationTemplate: "mycli '--ask' {prompt}"
      })
    ).toBe("\\mycli '--ask' 'safe'")
    expect(
      ADAPTERS.raw.formatInvocation('safe', {
        invocationTemplate: "/usr/local/bin/mycli '--ask' {prompt}"
      })
    ).toBe("\\/usr/local/bin/mycli '--ask' 'safe'")
    expect(validateRawPtyCommand("\\mycli --ask 'safe'")).toMatchObject({
      ok: false,
      error: expect.stringContaining('remain quoted')
    })
  })

  it('rejects lone UTF-16 surrogates before formatting or PTY registration', () => {
    const cases = [
      ['high', '\ud800', 'U+D800'],
      ['low', '\udfff', 'U+DFFF']
    ] as const
    for (const [kind, surrogate, codePoint] of cases) {
      const template = validateRawInvocationTemplate(`mycli '${surrogate}' {prompt}`)
      expect(template.ok).toBe(false)
      if (!template.ok) {
        expect(template.error).toContain(`lone ${kind} surrogate`)
        expect(template.error).toContain(codePoint)
      }
      expect(validateRawPtyCommand(`\\mycli '${surrogate}'`)).toMatchObject({ ok: false })
      expect(() =>
        ADAPTERS.raw.formatInvocation(surrogate, { invocationTemplate: 'mycli {prompt}' })
      ).toThrow(/well-formed Unicode/)
    }

    expect(validateRawInvocationTemplate("mycli '😀' {prompt}")).toMatchObject({ ok: true })
    expect(ADAPTERS.raw.formatInvocation('😀', { invocationTemplate: 'mycli {prompt}' })).toBe(
      "\\mycli '😀'"
    )
  })

  it('refuses unbalanced quoting, command substitution, and hook-unstable compound commands', () => {
    for (const invocationTemplate of [
      'mycli "label {prompt}',
      "mycli 'label' {prompt} '",
      'mycli {prompt} | tee output.log',
      'mycli {prompt}; true',
      'mycli {prompt} && true',
      'mycli {prompt} &',
      '(mycli {prompt})',
      'echo $(mycli {prompt})',
      'echo `mycli {prompt}`',
      '! mycli {prompt}',
      'mycli {prompt} > output.log'
    ]) {
      expect(validateRawInvocationTemplate(invocationTemplate), invocationTemplate).toMatchObject({
        ok: false
      })
    }
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
      resultText: null,
      costUsd: null
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
      resultText: null,
      costUsd: null
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
      resultText: null,
      costUsd: null
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
      resultText: null,
      costUsd: null
    })
    expect(
      parseCodex('2026-06-10T14:08:01.334563Z ERROR codex_memories_write::phase2: no changes')
    ).toBeNull()
  })

  it('gemini has no parseEvent (raw PTY projection — the bridge contract)', () => {
    expect(ADAPTERS.gemini.parseEvent).toBeUndefined()
  })
})

describe('costUsd observability (Phase 3 step 5, contracts v1.3.4)', () => {
  const parseClaude = ADAPTERS.claude.parseEvent!
  const parseCodex = ADAPTERS.codex.parseEvent!

  // VERBATIM spike fixture (claude 2.1.205, spiked 2026-07-17): the terminal
  // result line of a real `claude --print --verbose --output-format
  // stream-json` run — `total_cost_usd` on the result record is the ONLY
  // parsed cost source; `modelUsage.<id>.costUSD` repeats the same value
  // under an environment-specific model-id key and is deliberately unparsed.
  const SPIKE_CLAUDE_RESULT =
    '{"type":"result","subtype":"success","is_error":false,"api_error_status":null,"duration_ms":1457,"duration_api_ms":1282,"ttft_ms":1356,"ttft_stream_ms":1331,"time_to_request_ms":110,"num_turns":1,"result":"ok","stop_reason":"end_turn","session_id":"a9c19c25-8293-45e5-bf7f-bbaac3443a11","total_cost_usd":0.49012999999999995,"usage":{"input_tokens":5263,"cache_creation_input_tokens":21865,"cache_read_input_tokens":0,"output_tokens":4,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":21865,"ephemeral_5m_input_tokens":0},"inference_geo":"not_available","iterations":[{"input_tokens":5263,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":21865,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":21865},"type":"message"}],"speed":"standard"},"modelUsage":{"claude-fable-5":{"inputTokens":5263,"outputTokens":4,"cacheReadInputTokens":0,"cacheCreationInputTokens":21865,"webSearchRequests":0,"costUSD":0.49012999999999995,"contextWindow":1000000,"maxOutputTokens":64000}},"permission_denials":[],"terminal_reason":"completed","fast_mode_state":"off","uuid":"fa84ef09-e779-4b26-ac7b-7c5b765ef5ff"}'

  // VERBATIM spike fixture (codex-cli 0.144.5, spiked 2026-07-17): the only
  // usage-bearing record `codex exec --json` emits — token counts, NO USD
  // field anywhere. Codex is cost-UNOBSERVABLE (verified-absent).
  const SPIKE_CODEX_TURN_COMPLETED =
    '{"type":"turn.completed","usage":{"input_tokens":21809,"cached_input_tokens":10496,"output_tokens":5,"reasoning_output_tokens":0}}'

  const SESSION = 'a9c19c25-8293-45e5-bf7f-bbaac3443a11'

  it('claude: the verbatim spike result record yields total_cost_usd', () => {
    const event = parseClaude(SPIKE_CLAUDE_RESULT)
    expect(event?.costUsd).toBe(0.49012999999999995)
    expect(event?.resultText).toBe('ok')
    expect(event?.agentSessionId).toBe(SESSION)
    expect(event?.texts).toEqual([])
  })

  it('claude: a result record without total_cost_usd is null — modelUsage.costUSD is not a source', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      session_id: SESSION,
      modelUsage: { 'claude-fable-5': { costUSD: 0.49012999999999995 } }
    })
    expect(parseClaude(line)?.costUsd).toBeNull()
  })

  it('claude: error-subtype result records (no string `result`) still yield total_cost_usd (v1.3.4 review fix)', () => {
    // Shape verified against a real error_max_turns turn (claude 2.1.205,
    // 2026-07-17): failed turns carry cost but NO string `result` field —
    // the cost read must not gate on the text field, or a consistently
    // erroring loop burns real spend invisibly to the durable floor.
    for (const subtype of ['error_max_turns', 'error_during_execution']) {
      const line = JSON.stringify({
        type: 'result',
        subtype,
        is_error: true,
        num_turns: 1,
        session_id: SESSION,
        total_cost_usd: 0.0230836,
        usage: { input_tokens: 3, output_tokens: 1 }
      })
      const event = parseClaude(line)
      expect(event?.costUsd, subtype).toBe(0.0230836)
      expect(event?.resultText, subtype).toBeNull()
    }
  })

  it('claude: non-number and non-finite total_cost_usd values are null, never coerced', () => {
    for (const raw of ['"0.49"', 'null', 'true', '1e999', '-1e999']) {
      const line = `{"type":"result","result":"ok","session_id":"${SESSION}","total_cost_usd":${raw}}`
      expect(parseClaude(line)?.costUsd, raw).toBeNull()
    }
  })

  it('claude: system and assistant events carry costUsd null', () => {
    const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: SESSION })
    const assistant = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      session_id: SESSION
    })
    expect(parseClaude(init)?.costUsd).toBeNull()
    expect(parseClaude(assistant)?.costUsd).toBeNull()
  })

  it('codex: the verbatim turn.completed usage record has NO cost semantics (verified-absent)', () => {
    // Asserting the ABSENCE of cost semantics, not their presence: the event
    // is structured (non-null) but carries no USD observation.
    const event = parseCodex(SPIKE_CODEX_TURN_COMPLETED)
    expect(event).not.toBeNull()
    expect(event?.costUsd).toBeNull()
  })

  it('codex: every event shape carries costUsd null', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: '019eb1da-decb-7052-a145-1ac71e4bc80b' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'ok' }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'command_execution', command: 'ls' }
      })
    ]
    for (const line of lines) {
      expect(parseCodex(line)?.costUsd, line).toBeNull()
    }
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
