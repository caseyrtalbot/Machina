// @vitest-environment node
/**
 * Shell-hook contract tests for the block protocol.
 *
 * zsh and bash hooks are exercised live (both ship with macOS): the hook is
 * sourced in a real shell, markers are captured from stdout and fed through
 * the production BlockDetector — proving the percent-encoded cmd= round-trip.
 * fish is asserted on source text (fish isn't guaranteed installed): numeric
 * ts construction (BSD date has no %N) and no file-scope `exit`.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBlockDetector, type BlockEvent } from '../../src/shared/engine/block-detector'

const HOOKS_DIR = join(__dirname, '..', '..', 'resources', 'shell-hooks')

function runShell(shell: string, script: string): string {
  return execFileSync(shell, ['-c', script], {
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env, TE_SESSION_ID: 'test-session' }
  })
}

function detect(output: string): readonly BlockEvent[] {
  return createBlockDetector().consume(output)
}

describe('te.zsh', () => {
  it('emits a decodable command-start with the typed command percent-encoded', () => {
    const tricky = 'npm test; echo "100%"'
    const out = runShell(
      'zsh',
      `source ${HOOKS_DIR}/te.zsh
__te_precmd
__te_preexec ${JSON.stringify(tricky)}
false
__te_precmd`
    )
    const events = detect(out)
    expect(events.map((e) => e.kind)).toEqual([
      'prompt-start',
      'command-start',
      'command-end',
      'prompt-start'
    ])
    const start = events[1]
    if (start.kind !== 'command-start') throw new Error('precondition')
    expect(start.command).toBe(tricky)
    expect(Number.isFinite(start.ts)).toBe(true)
    expect(start.meta.shell).toBe('zsh')
    const end = events[2]
    if (end.kind !== 'command-end') throw new Error('precondition')
    expect(end.exit).toBe(1)
  })

  it('emits nothing when TE_SESSION_ID is unset', () => {
    const out = execFileSync('zsh', ['-c', `source ${HOOKS_DIR}/te.zsh; __te_precmd`], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, TE_SESSION_ID: '' }
    })
    expect(out).toBe('')
  })
})

describe('te.bash', () => {
  it('emits command-start with cmd= from the DEBUG trap', () => {
    const out = runShell(
      'bash',
      `source ${HOOKS_DIR}/te.bash; __te_prompt_command; echo real-output`
    )
    const events = detect(out)
    const start = events.find((e) => e.kind === 'command-start')
    expect(start).toBeDefined()
    if (start?.kind !== 'command-start') throw new Error('precondition')
    expect(start.command).toBe('echo real-output')
    expect(Number.isFinite(start.ts)).toBe(true)
    expect(start.meta.shell).toBe('bash')
    // The command's own output still flows through as output-chunk.
    const chunks = events.filter((e) => e.kind === 'output-chunk')
    expect(chunks.map((c) => (c.kind === 'output-chunk' ? c.text : '')).join('')).toContain(
      'real-output'
    )
  })
})

describe('te.fish (source contract)', () => {
  const src = readFileSync(join(HOOKS_DIR, 'te.fish'), 'utf-8')

  it('computes ts numerically without GNU-only %N', () => {
    expect(src).not.toContain('%3N')
    expect(src).not.toMatch(/date \+%s%/)
    expect(src).toContain('math (date +%s) x 1000')
  })

  it('has no file-scope exit (double-source must not kill the shell)', () => {
    expect(src).not.toMatch(/^\s*exit\b/m)
    expect(src).toContain('if not set -q __TE_HOOK_LOADED')
  })

  it('emits the percent-encoded cmd= key on command-start', () => {
    expect(src).toContain('cmd=$cmd')
    expect(src).toContain("string replace -a '%' '%25'")
    expect(src).toContain("string replace -a ';' '%3B'")
  })
})
