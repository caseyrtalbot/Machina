// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CLI_AGENTS, getAgentSpec } from '../../../shared/cli-agents'
import { detectAgentVersion, detectInstalledAgents, type ExecFn } from '../cli-agent-detector'

describe('detectAgentVersion', () => {
  it('extracts the version emitted by `claude --version`', () => {
    const spec = getAgentSpec('claude')!
    expect(detectAgentVersion(spec, '1.2.3 (Claude Code)')).toBe('1.2.3')
  })

  it('extracts the version emitted by `codex --version`', () => {
    const spec = getAgentSpec('codex')!
    expect(detectAgentVersion(spec, 'codex 0.7.4\n')).toBe('0.7.4')
  })

  it('extracts the version emitted by `gemini --version`', () => {
    const spec = getAgentSpec('gemini')!
    expect(detectAgentVersion(spec, 'gemini 0.10.1\n')).toBe('0.10.1')
  })

  it('returns null when output does not match the regex', () => {
    const spec = getAgentSpec('claude')!
    expect(detectAgentVersion(spec, 'unrelated banner')).toBeNull()
  })

  it('returns null on an empty banner', () => {
    const spec = getAgentSpec('claude')!
    expect(detectAgentVersion(spec, '')).toBeNull()
  })
})

describe('detectInstalledAgents', () => {
  it('marks an agent installed when its version probe succeeds', async () => {
    const exec: ExecFn = async (cmd) => {
      if (cmd === 'claude') return { stdout: '1.2.3 (Claude Code)\n', stderr: '' }
      if (cmd === 'codex') return { stdout: 'codex 0.7.4\n', stderr: '' }
      if (cmd === 'gemini') return { stdout: 'gemini 0.10.1\n', stderr: '' }
      throw new Error(`unexpected: ${cmd}`)
    }

    const installations = await detectInstalledAgents({ exec })

    expect(installations).toHaveLength(CLI_AGENTS.length)
    for (const inst of installations) {
      expect(inst.installed).toBe(true)
      expect(inst.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(inst.error).toBeNull()
    }
  })

  it('marks an agent uninstalled when the binary is not on PATH', async () => {
    const exec: ExecFn = async (cmd) => {
      if (cmd === 'claude') {
        const err = new Error('command not found') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return { stdout: 'codex 0.7.4\n', stderr: '' }
    }

    const installations = await detectInstalledAgents({
      exec,
      agents: [getAgentSpec('claude')!, getAgentSpec('codex')!]
    })

    const claude = installations.find((i) => i.id === 'claude')!
    const codex = installations.find((i) => i.id === 'codex')!

    expect(claude.installed).toBe(false)
    expect(claude.version).toBeNull()
    expect(claude.error).toMatch(/not found/i)

    expect(codex.installed).toBe(true)
    expect(codex.version).toBe('0.7.4')
  })

  it('handles success-but-unparseable banners by reporting installed without a version', async () => {
    const exec: ExecFn = async () => ({ stdout: 'mystery banner', stderr: '' })

    const installations = await detectInstalledAgents({
      exec,
      agents: [getAgentSpec('claude')!]
    })

    const claude = installations[0]
    expect(claude.installed).toBe(true)
    expect(claude.version).toBeNull()
    expect(claude.error).toBeNull()
  })

  it('preserves spec display metadata in each installation row', async () => {
    const exec: ExecFn = async () => ({ stdout: '1.2.3 (Claude Code)\n', stderr: '' })

    const installations = await detectInstalledAgents({
      exec,
      agents: [getAgentSpec('claude')!]
    })

    const claude = installations[0]
    expect(claude.id).toBe('claude')
    expect(claude.displayName).toBe('Claude Code')
    expect(claude.brandColor).toBe('#cc785c')
  })

  it('probes agents concurrently, not serially', async () => {
    const startedAt: number[] = []
    const exec: ExecFn = async () => {
      startedAt.push(Date.now())
      await new Promise((r) => setTimeout(r, 30))
      return { stdout: '1.2.3 (Claude Code)\n', stderr: '' }
    }

    const begin = Date.now()
    await detectInstalledAgents({ exec })
    const elapsed = Date.now() - begin

    // Three serial 30ms probes would take ~90ms. Concurrent probes finish in ~30ms.
    expect(elapsed).toBeLessThan(80)
    expect(startedAt).toHaveLength(CLI_AGENTS.length)
  })
})
