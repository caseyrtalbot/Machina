// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ClaudeStatusService } from '../claude-status-service'
import type { ExecFn } from '../cli-agent-detector'

const successAuth = JSON.stringify({
  loggedIn: true,
  email: 'casey@example.com',
  subscriptionType: 'max'
})

function buildExec(
  handlers: Record<string, () => Promise<{ stdout: string; stderr: string }>>
): ExecFn {
  return async (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    const handler = handlers[key]
    if (!handler) throw Object.assign(new Error(`unexpected cmd: ${key}`), { code: 'ENOENT' })
    return handler()
  }
}

describe('ClaudeStatusService', () => {
  it('reports installed + version + auth fields when both probes succeed', async () => {
    const exec = buildExec({
      'claude --version': async () => ({ stdout: '1.2.3 (Claude Code)\n', stderr: '' }),
      'claude auth status': async () => ({ stdout: successAuth, stderr: '' })
    })
    const service = new ClaudeStatusService({ exec })

    const status = await service.check()

    expect(status.installed).toBe(true)
    expect(status.version).toBe('1.2.3')
    expect(status.authenticated).toBe(true)
    expect(status.email).toBe('casey@example.com')
    expect(status.subscriptionType).toBe('max')
    expect(status.error).toBeNull()
  })

  it('reports not-installed with an error message when the binary is missing', async () => {
    const exec: ExecFn = async () => {
      const err = Object.assign(new Error('command not found'), { code: 'ENOENT' })
      throw err
    }
    const service = new ClaudeStatusService({ exec })

    const status = await service.check()

    expect(status.installed).toBe(false)
    expect(status.authenticated).toBe(false)
    expect(status.version).toBeNull()
    expect(status.error).toMatch(/not found/i)
  })

  it('reports installed but unauthenticated when auth probe says loggedIn:false', async () => {
    const exec = buildExec({
      'claude --version': async () => ({ stdout: '1.2.3 (Claude Code)\n', stderr: '' }),
      'claude auth status': async () => ({
        stdout: JSON.stringify({ loggedIn: false }),
        stderr: ''
      })
    })
    const service = new ClaudeStatusService({ exec })

    const status = await service.check()

    expect(status.installed).toBe(true)
    expect(status.version).toBe('1.2.3')
    expect(status.authenticated).toBe(false)
    expect(status.error).toMatch(/not signed in/i)
  })

  it('fires onChange only when the status actually changes', async () => {
    const exec = buildExec({
      'claude --version': async () => ({ stdout: '1.2.3 (Claude Code)\n', stderr: '' }),
      'claude auth status': async () => ({ stdout: successAuth, stderr: '' })
    })
    const service = new ClaudeStatusService({ exec })
    const events: number[] = []
    service.setOnChange(() => events.push(Date.now()))

    await service.check()
    await service.check()

    expect(events).toHaveLength(1)
  })
})
