// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { CliThreadSpawner } from '../cli-thread-spawner'
import type { CliAgentThreadBridge } from '../cli-agent-thread-bridge'

function harness(expectResult = true) {
  const pty = {
    writeAgentInput: vi.fn(() => true),
    getActiveSessions: vi.fn().mockReturnValue(['sess-raw'])
  }
  const shell = {
    create: vi.fn().mockReturnValue('sess-raw'),
    kill: vi.fn(),
    getPtyService: () => pty
  }
  const expectRawInvocation = vi.fn().mockReturnValue(expectResult)
  const cancelExpectedRawInvocation = vi.fn()
  const bridge = {
    bind: vi.fn(),
    expectRawInvocation,
    cancelExpectedRawInvocation,
    getAgentSessionId: vi.fn()
  } as unknown as CliAgentThreadBridge
  const registry = { turnStarted: vi.fn(), threadClosed: vi.fn() }
  const spawner = new CliThreadSpawner({
    shellService: shell as never,
    bridge,
    detect: async () => [],
    registry
  })
  return {
    spawner,
    shell,
    pty,
    bridge,
    expectRawInvocation,
    cancelExpectedRawInvocation,
    registry
  }
}

describe('CliThreadSpawner bound raw dispatch', () => {
  it('quotes prompt bytes and orders expectation → turnStarted → writeAgentInput', async () => {
    const { spawner, pty, bridge, expectRawInvocation, registry } = harness()
    const prompt = "don't $(touch /tmp/pwn); `id`"
    const template = "mytool '--ask' {prompt}"

    const result = await spawner.input(
      'thread-R',
      'cli-raw',
      prompt,
      '/v',
      'raw-runner',
      undefined,
      false,
      template
    )

    const command = "\\mytool '--ask' 'don'\\''t $(touch /tmp/pwn); `id`'"
    expect(result).toEqual({ ok: true })
    expect(bridge.bind).toHaveBeenCalledWith('sess-raw', 'thread-R', 'raw')
    expect(expectRawInvocation).toHaveBeenCalledWith('sess-raw', command)
    expect(registry.turnStarted).toHaveBeenCalledWith({
      threadId: 'thread-R',
      agentId: 'raw-runner',
      cwd: '/v',
      attributionSuspect: false
    })
    expect(pty.writeAgentInput).toHaveBeenCalledWith('sess-raw', `${command}\r`, 'batched')
    expect(expectRawInvocation.mock.invocationCallOrder[0]).toBeLessThan(
      registry.turnStarted.mock.invocationCallOrder[0]
    )
    expect(registry.turnStarted.mock.invocationCallOrder[0]).toBeLessThan(
      pty.writeAgentInput.mock.invocationCallOrder[0]
    )
  })

  it('missing template refuses before expectation, turn window, or PTY write', async () => {
    const { spawner, pty, expectRawInvocation, registry } = harness()
    const result = await spawner.input('thread-R', 'cli-raw', 'go', '/v', 'raw-runner')

    expect(result).toEqual({ ok: false })
    expect(expectRawInvocation).not.toHaveBeenCalled()
    expect(registry.turnStarted).not.toHaveBeenCalled()
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })

  it('malformed template refuses without throwing or opening a turn', async () => {
    const { spawner, pty, expectRawInvocation, registry } = harness()
    const result = await spawner.input(
      'thread-R',
      'cli-raw',
      'go',
      '/v',
      'raw-runner',
      undefined,
      false,
      'missing-placeholder'
    )

    expect(result).toEqual({ ok: false })
    expect(expectRawInvocation).not.toHaveBeenCalled()
    expect(registry.turnStarted).not.toHaveBeenCalled()
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })

  it.each([
    ['Ctrl-U', '\x15'],
    ['ESC', '\x1b'],
    ['DEL', '\x7f'],
    ['C1 CSI', '\u009b']
  ])('%s in the template cannot register, open a turn, or reach the PTY', async (_label, byte) => {
    const { spawner, pty, expectRawInvocation, registry } = harness()

    const result = await spawner.input(
      'thread-R',
      'cli-raw',
      'go',
      '/v',
      'raw-runner',
      undefined,
      false,
      `mytool ${byte}{prompt}`
    )

    expect(result).toEqual({ ok: false })
    expect(expectRawInvocation).not.toHaveBeenCalled()
    expect(registry.turnStarted).not.toHaveBeenCalled()
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })

  it('Ctrl-U introduced by prompt bytes cannot rewrite the registered PTY command', async () => {
    const { spawner, pty, expectRawInvocation, registry } = harness()

    const result = await spawner.input(
      'thread-R',
      'cli-raw',
      'before\x15after',
      '/v',
      'raw-runner',
      undefined,
      false,
      'mytool {prompt}'
    )

    expect(result).toEqual({ ok: false })
    expect(expectRawInvocation).not.toHaveBeenCalled()
    expect(registry.turnStarted).not.toHaveBeenCalled()
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })

  it('an arithmetic or subscript placeholder cannot register, open a turn, or reach the PTY', async () => {
    for (const template of [
      'printf "%s" $[{prompt}]',
      'printf "%s" $[ {prompt} ]',
      'mytool values[{prompt}]',
      'mytool values[ {prompt} ]'
    ]) {
      const { spawner, pty, expectRawInvocation, registry } = harness()
      const result = await spawner.input(
        'thread-R',
        'cli-raw',
        '$(/usr/bin/printf injected)',
        '/v',
        'raw-runner',
        undefined,
        false,
        template
      )

      expect(result, template).toEqual({ ok: false })
      expect(expectRawInvocation, template).not.toHaveBeenCalled()
      expect(registry.turnStarted, template).not.toHaveBeenCalled()
      expect(pty.writeAgentInput, template).not.toHaveBeenCalled()
    }
  })

  it('a lone surrogate in the template or prompt cannot reach bridge registration', async () => {
    for (const [prompt, template] of [
      ['go', `mytool '${'\ud800'}' {prompt}`],
      ['\udfff', 'mytool {prompt}']
    ]) {
      const { spawner, pty, expectRawInvocation, registry } = harness()
      const result = await spawner.input(
        'thread-R',
        'cli-raw',
        prompt,
        '/v',
        'raw-runner',
        undefined,
        false,
        template
      )

      expect(result).toEqual({ ok: false })
      expect(expectRawInvocation).not.toHaveBeenCalled()
      expect(registry.turnStarted).not.toHaveBeenCalled()
      expect(pty.writeAgentInput).not.toHaveBeenCalled()
    }
  })

  it('bridge refusal fails closed before turnStarted or writeAgentInput', async () => {
    const { spawner, pty, expectRawInvocation, registry } = harness(false)
    const result = await spawner.input(
      'thread-R',
      'cli-raw',
      'go',
      '/v',
      'raw-runner',
      undefined,
      false,
      'mytool {prompt}'
    )

    expect(result).toEqual({ ok: false })
    expect(expectRawInvocation).toHaveBeenCalledTimes(1)
    expect(registry.turnStarted).not.toHaveBeenCalled()
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })

  it('a later resolved request without a template clears the stored snapshot', async () => {
    const { spawner, pty, expectRawInvocation, registry } = harness()
    await spawner.input(
      'thread-R',
      'cli-raw',
      'first',
      '/v',
      'raw-runner',
      undefined,
      false,
      'mytool {prompt}'
    )
    const second = await spawner.input('thread-R', 'cli-raw', 'second', '/v', 'raw-runner')

    expect(second).toEqual({ ok: false })
    expect(expectRawInvocation).toHaveBeenCalledTimes(1)
    expect(registry.turnStarted).toHaveBeenCalledTimes(1)
    expect(pty.writeAgentInput).toHaveBeenCalledTimes(1)
  })

  it('a missing PTY session rejects queue acceptance and rolls back marker + turn', async () => {
    const { spawner, pty, cancelExpectedRawInvocation, registry } = harness()
    pty.writeAgentInput.mockReturnValue(false)

    const result = await spawner.input(
      'thread-R',
      'cli-raw',
      'go',
      '/v',
      'raw-runner',
      undefined,
      false,
      'mytool {prompt}'
    )

    expect(result).toEqual({ ok: false })
    expect(registry.turnStarted).toHaveBeenCalledTimes(1)
    expect(cancelExpectedRawInvocation).toHaveBeenCalledWith('sess-raw', "\\mytool 'go'")
    expect(registry.threadClosed).toHaveBeenCalledWith('thread-R')
  })

  it('a live raw PTY cannot be reused through a structured identity', async () => {
    const { spawner, pty, expectRawInvocation, registry } = harness()
    const first = await spawner.input(
      'thread-R',
      'cli-raw',
      'first',
      '/v',
      'raw-runner',
      undefined,
      false,
      'mytool {prompt}'
    )

    const swapped = await spawner.input('thread-R', 'cli-claude', 'second', '/v', 'raw-runner')

    expect(first).toEqual({ ok: true })
    expect(swapped).toEqual({ ok: false })
    expect(expectRawInvocation).toHaveBeenCalledTimes(1)
    expect(registry.turnStarted).toHaveBeenCalledTimes(1)
    expect(pty.writeAgentInput).toHaveBeenCalledTimes(1)
  })

  it.each(['turn-start', 'pty-write'] as const)(
    'rolls back the raw marker and attribution window when %s throws',
    async (failure) => {
      const { spawner, pty, cancelExpectedRawInvocation, registry } = harness()
      if (failure === 'turn-start')
        registry.turnStarted.mockImplementation(() => {
          throw new Error('boom')
        })
      else
        pty.writeAgentInput.mockImplementation(() => {
          throw new Error('boom')
        })

      const result = await spawner.input(
        'thread-R',
        'cli-raw',
        'go',
        '/v',
        'raw-runner',
        undefined,
        false,
        'mytool {prompt}'
      )

      expect(result).toEqual({ ok: false })
      expect(cancelExpectedRawInvocation).toHaveBeenCalledWith('sess-raw', "\\mytool 'go'")
      expect(registry.threadClosed).toHaveBeenCalledWith('thread-R')
    }
  )
})
