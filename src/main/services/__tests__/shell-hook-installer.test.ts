// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  detectShell,
  getShellHookStatus,
  hookTarget,
  installShellHooks
} from '../shell-hook-installer'

const HOOK_CONTENT = '# te hook content\n__TE_HOOK_LOADED=1\n'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'te-hooks-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('detectShell', () => {
  it('maps $SHELL basenames to supported shells', () => {
    expect(detectShell('/bin/zsh')).toBe('zsh')
    expect(detectShell('/bin/bash')).toBe('bash')
    expect(detectShell('/opt/homebrew/bin/fish')).toBe('fish')
  })

  it('defaults to zsh when unset or unrecognized', () => {
    expect(detectShell(undefined)).toBe('zsh')
    expect(detectShell('')).toBe('zsh')
    expect(detectShell('/usr/bin/nu')).toBe('zsh')
  })
})

describe('hookTarget', () => {
  it('targets home dotfile + rc for zsh and bash', () => {
    const zsh = hookTarget('zsh', home)
    expect(zsh.hookPath).toBe(join(home, '.te.zsh'))
    expect(zsh.rcPath).toBe(join(home, '.zshrc'))
    expect(zsh.sourceLine).toBe('[ -f ~/.te.zsh ] && source ~/.te.zsh')

    const bash = hookTarget('bash', home)
    expect(bash.hookPath).toBe(join(home, '.te.bash'))
    expect(bash.rcPath).toBe(join(home, '.bashrc'))
  })

  it('targets conf.d with no rc edit for fish', () => {
    const fish = hookTarget('fish', home)
    expect(fish.hookPath).toBe(join(home, '.config', 'fish', 'conf.d', 'te.fish'))
    expect(fish.rcPath).toBeNull()
    expect(fish.sourceLine).toBeNull()
  })
})

describe('installShellHooks', () => {
  it('writes the hook file and appends a guarded source line to the rc', async () => {
    writeFileSync(join(home, '.zshrc'), '# existing rc\nexport FOO=bar\n')
    const target = hookTarget('zsh', home)

    const result = await installShellHooks(target, HOOK_CONTENT)

    expect(result.ok).toBe(true)
    expect(result.rcUpdated).toBe(true)
    expect(readFileSync(target.hookPath, 'utf-8')).toBe(HOOK_CONTENT)
    const rc = readFileSync(join(home, '.zshrc'), 'utf-8')
    expect(rc).toContain('# existing rc\nexport FOO=bar\n')
    expect(rc).toContain('[ -f ~/.te.zsh ] && source ~/.te.zsh')
  })

  it('creates the rc file when missing', async () => {
    const target = hookTarget('bash', home)

    const result = await installShellHooks(target, HOOK_CONTENT)

    expect(result.ok).toBe(true)
    expect(result.rcUpdated).toBe(true)
    expect(readFileSync(join(home, '.bashrc'), 'utf-8')).toContain(
      '[ -f ~/.te.bash ] && source ~/.te.bash'
    )
  })

  it('is idempotent: a second install never duplicates the source line', async () => {
    const target = hookTarget('zsh', home)
    await installShellHooks(target, HOOK_CONTENT)

    const second = await installShellHooks(target, HOOK_CONTENT)

    expect(second.ok).toBe(true)
    expect(second.rcUpdated).toBe(false)
    const rc = readFileSync(join(home, '.zshrc'), 'utf-8')
    expect(rc.match(/\.te\.zsh/g)?.length).toBe(2) // one guard test + one source
    expect(rc.match(/&& source/g)?.length).toBe(1)
  })

  it('respects a hand-rolled rc reference to the hook file', async () => {
    writeFileSync(join(home, '.zshrc'), 'source "$HOME/.te.zsh"\n')
    const target = hookTarget('zsh', home)

    const result = await installShellHooks(target, HOOK_CONTENT)

    expect(result.ok).toBe(true)
    expect(result.rcUpdated).toBe(false)
    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('source "$HOME/.te.zsh"\n')
  })

  it('terminates an rc that lacks a trailing newline before appending', async () => {
    writeFileSync(join(home, '.zshrc'), 'export FOO=bar')
    const target = hookTarget('zsh', home)

    await installShellHooks(target, HOOK_CONTENT)

    const rc = readFileSync(join(home, '.zshrc'), 'utf-8')
    expect(rc).toContain('export FOO=bar\n')
    expect(rc.includes('export FOO=bar[')).toBe(false)
  })

  it('creates conf.d and skips rc editing for fish', async () => {
    const target = hookTarget('fish', home)

    const result = await installShellHooks(target, HOOK_CONTENT)

    expect(result.ok).toBe(true)
    expect(result.rcUpdated).toBe(false)
    expect(result.rcPath).toBeNull()
    expect(readFileSync(target.hookPath, 'utf-8')).toBe(HOOK_CONTENT)
    expect(existsSync(join(home, '.zshrc'))).toBe(false)
  })

  it('returns ok: false with an error message when the write fails', async () => {
    // A file where the conf.d *directory* should be makes mkdir fail.
    mkdirSync(join(home, '.config', 'fish'), { recursive: true })
    writeFileSync(join(home, '.config', 'fish', 'conf.d'), 'not a directory')
    const target = hookTarget('fish', home)

    const result = await installShellHooks(target, HOOK_CONTENT)

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('getShellHookStatus', () => {
  it('reports not installed when the hook file is absent', async () => {
    const status = await getShellHookStatus(hookTarget('zsh', home))
    expect(status.installed).toBe(false)
  })

  it('reports not installed when the hook exists but the rc never sources it', async () => {
    const target = hookTarget('zsh', home)
    writeFileSync(target.hookPath, HOOK_CONTENT)
    writeFileSync(join(home, '.zshrc'), '# nothing relevant\n')

    const status = await getShellHookStatus(target)

    expect(status.installed).toBe(false)
  })

  it('reports installed after installShellHooks for every shell', async () => {
    for (const shell of ['zsh', 'bash', 'fish'] as const) {
      const target = hookTarget(shell, home)
      await installShellHooks(target, HOOK_CONTENT)
      const status = await getShellHookStatus(target)
      expect(status.installed).toBe(true)
      expect(status.shell).toBe(shell)
    }
  })
})
