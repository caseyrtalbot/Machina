// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSpawn,
  mockExecFileSync,
  mockWriteSessionMeta,
  mockReadSessionMeta,
  mockDeleteSessionMeta,
  mockEnsureSessionDir,
  mockGetSessionDir,
  mockGetTerminfoDir
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockWriteSessionMeta: vi.fn(),
  mockReadSessionMeta: vi.fn(() => null as unknown),
  mockDeleteSessionMeta: vi.fn(),
  mockEnsureSessionDir: vi.fn(),
  mockGetSessionDir: vi.fn(() => '/tmp/sessions'),
  mockGetTerminfoDir: vi.fn(() => undefined)
}))

vi.mock('node-pty', () => ({ spawn: mockSpawn }))

vi.mock('child_process', () => ({ execFileSync: mockExecFileSync }))

vi.mock('fs', () => ({ readdirSync: vi.fn(() => []) }))

vi.mock('../session-paths', () => ({
  writeSessionMeta: mockWriteSessionMeta,
  readSessionMeta: mockReadSessionMeta,
  deleteSessionMeta: mockDeleteSessionMeta,
  ensureSessionDir: mockEnsureSessionDir,
  getSessionDir: mockGetSessionDir,
  getTerminfoDir: mockGetTerminfoDir
}))

import { PtyService } from '../pty-service'

function makePty() {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345
  }
}

describe('PtyService', () => {
  let service: PtyService
  let pty: ReturnType<typeof makePty>

  beforeEach(() => {
    vi.clearAllMocks()
    pty = makePty()
    mockSpawn.mockReturnValue(pty)
    service = new PtyService()
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  it('spawns node-pty with correct args', () => {
    service.create('s1', '/tmp/project', 120, 40, '/bin/bash', 'my-label')

    expect(mockSpawn).toHaveBeenCalledWith(
      '/bin/bash',
      [],
      expect.objectContaining({ cwd: '/tmp/project', cols: 120, rows: 40 })
    )
  })

  it('defaults to 80x24 when no dimensions given', () => {
    service.create('s2', '/tmp/project')

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ cols: 80, rows: 24 })
    )
  })

  it('writes session metadata on create', () => {
    service.create('s3', '/home/user', 80, 24, '/bin/zsh', 'dev')

    expect(mockWriteSessionMeta).toHaveBeenCalledWith(
      's3',
      expect.objectContaining({ shell: '/bin/zsh', cwd: '/home/user', label: 'dev' })
    )
  })

  it('exposes TE_SESSION_ID in the spawned env so shell hooks can activate', () => {
    service.create('s4', '/tmp')
    const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1]
    const opts = lastCall[2] as { env: Record<string, string> }
    expect(opts.env.TE_SESSION_ID).toBe('s4')
  })

  // -------------------------------------------------------------------------
  // write() / sendRawKeys() / resize()
  // -------------------------------------------------------------------------

  it('write() calls pty.write()', () => {
    service.create('s1', '/tmp')
    service.write('s1', 'ls\n')

    expect(pty.write).toHaveBeenCalledWith('ls\n')
  })

  it('sendRawKeys() calls pty.write()', () => {
    service.create('s1', '/tmp')
    service.sendRawKeys('s1', '\x03')

    expect(pty.write).toHaveBeenCalledWith('\x03')
  })

  it('resize() calls pty.resize()', () => {
    service.create('s1', '/tmp')
    service.resize('s1', 100, 50)

    expect(pty.resize).toHaveBeenCalledWith(100, 50)
  })

  it('writeAgentInput() routes through pty.write with the agent payload', () => {
    service.create('s1', '/tmp')
    service.writeAgentInput('s1', '/help\r', 'batched')

    expect(pty.write).toHaveBeenCalledWith('/help\r')
  })

  it('preserves enqueue order across mixed user/agent/raw writes', async () => {
    service.create('s1', '/tmp')

    service.write('s1', 'A')
    service.writeAgentInput('s1', 'B', 'streaming')
    service.sendRawKeys('s1', 'C')

    // Allow any queued microtasks to settle.
    await new Promise((r) => setTimeout(r, 0))

    expect(pty.write.mock.calls.map((c) => c[0])).toEqual(['A', 'B', 'C'])
  })

  it('drops writes for unknown sessions without throwing', () => {
    expect(() => service.write('missing', 'x')).not.toThrow()
    expect(() => service.writeAgentInput('missing', 'x')).not.toThrow()
    expect(() => service.sendRawKeys('missing', 'x')).not.toThrow()
    expect(pty.write).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // kill()
  // -------------------------------------------------------------------------

  it('kill() kills pty, removes from sessions, and deletes metadata', () => {
    service.create('s1', '/tmp')
    service.kill('s1')

    expect(pty.kill).toHaveBeenCalled()
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith('s1')
    expect(service.getActiveSessions()).not.toContain('s1')
  })

  // -------------------------------------------------------------------------
  // Data callback + reconnect queue
  // -------------------------------------------------------------------------

  it('fires data callback when session is connected', () => {
    const onData = vi.fn()
    service.setCallbacks(onData, vi.fn())
    service.create('s1', '/tmp')

    const handler = pty.onData.mock.calls[0][0] as (data: string) => void
    handler('hello')

    expect(onData).toHaveBeenCalledWith('s1', 'hello')
  })

  it('buffers data in reconnectQueue when disconnected', () => {
    const onData = vi.fn()
    service.setCallbacks(onData, vi.fn())
    service.create('s1', '/tmp')
    service.detachAll()

    const handler = pty.onData.mock.calls[0][0] as (data: string) => void
    handler('buffered-chunk')

    expect(onData).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // reconnect()
  // -------------------------------------------------------------------------

  it('returns ring buffer snapshot as scrollback', () => {
    mockReadSessionMeta.mockReturnValue({ shell: '/bin/zsh', cwd: '/tmp', createdAt: 'now' })
    service.create('s1', '/tmp')

    const result = service.reconnect('s1', 80, 24)

    expect(result).not.toBeNull()
    expect(typeof result!.scrollback).toBe('string')
  })

  it('flushes queued data through callback on reconnect', () => {
    const onData = vi.fn()
    service.setCallbacks(onData, vi.fn())
    mockReadSessionMeta.mockReturnValue({ shell: '/bin/zsh', cwd: '/tmp', createdAt: 'now' })
    service.create('s1', '/tmp')
    service.detachAll()

    const handler = pty.onData.mock.calls[0][0] as (data: string) => void
    handler('queued')
    onData.mockClear()

    service.reconnect('s1', 80, 24)

    expect(onData).toHaveBeenCalledWith('s1', 'queued')
  })

  it('returns null for unknown sessions', () => {
    expect(service.reconnect('nonexistent', 80, 24)).toBeNull()
  })

  // -------------------------------------------------------------------------
  // discover()
  // -------------------------------------------------------------------------

  it('returns disconnected sessions', () => {
    mockReadSessionMeta.mockReturnValue({ shell: '/bin/zsh', cwd: '/tmp', createdAt: 'now' })
    service.create('s1', '/tmp')
    service.detachAll()

    const discovered = service.discover()

    expect(discovered).toHaveLength(1)
    expect(discovered[0].sessionId).toBe('s1')
  })

  // -------------------------------------------------------------------------
  // getProcessName()
  // -------------------------------------------------------------------------

  it('calls ps with correct pid', () => {
    mockExecFileSync.mockReturnValue('vim\n')
    service.create('s1', '/tmp')

    const name = service.getProcessName('s1')

    expect(name).toBe('vim')
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ps',
      ['-o', 'comm=', '-p', '12345'],
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  // -------------------------------------------------------------------------
  // detachAll() / killAll()
  // -------------------------------------------------------------------------

  it('detachAll() marks sessions as disconnected', () => {
    const onData = vi.fn()
    service.setCallbacks(onData, vi.fn())
    service.create('s1', '/tmp')
    service.detachAll()

    const handler = pty.onData.mock.calls[0][0] as (data: string) => void
    handler('data-after-detach')

    expect(onData).not.toHaveBeenCalled()
  })

  it('killAll() kills all ptys and clears metadata', () => {
    service.create('s1', '/tmp')

    const pty2 = makePty()
    mockSpawn.mockReturnValue(pty2)
    service.create('s2', '/tmp')

    service.killAll()

    expect(pty.kill).toHaveBeenCalled()
    expect(pty2.kill).toHaveBeenCalled()
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith('s1')
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith('s2')
    expect(service.getActiveSessions()).toHaveLength(0)
  })

  it('shutdown() kills sessions without firing exit callbacks', () => {
    const onExit = vi.fn()
    service.setCallbacks(vi.fn(), onExit)
    service.create('s1', '/tmp')

    service.shutdown()

    expect(pty.kill).toHaveBeenCalledOnce()
    expect(service.getActiveSessions()).toHaveLength(0)
    expect(onExit).not.toHaveBeenCalled()
  })
})
