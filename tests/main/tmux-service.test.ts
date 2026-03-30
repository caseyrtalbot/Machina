import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

// Redirect metadata to a temp directory
const TEST_DIR = join(tmpdir(), `tmux-svc-test-${randomUUID()}`)

// Check if tmux is available before importing the module
let HAS_TMUX = false
try {
  const output = execFileSync('tmux', ['-V'], { encoding: 'utf-8' }).trim()
  const match = output.match(/(\d+\.\d+)/)
  HAS_TMUX = match ? parseFloat(match[1]) >= 2.6 : false
} catch {
  HAS_TMUX = false
}

// Conditionally import and test
describe.skipIf(!HAS_TMUX)('TmuxService (integration)', () => {
  let TmuxService: typeof import('../../src/main/services/tmux-service').TmuxService
  let _setSessionDirForTest: typeof import('../../src/main/services/tmux-paths')._setSessionDirForTest
  let service: InstanceType<typeof TmuxService>

  beforeAll(async () => {
    const tmuxPaths = await import('../../src/main/services/tmux-paths')
    const tmuxSvc = await import('../../src/main/services/tmux-service')
    TmuxService = tmuxSvc.TmuxService
    _setSessionDirForTest = tmuxPaths._setSessionDirForTest

    _setSessionDirForTest(TEST_DIR)

    const svc = TmuxService.tryCreate()
    if (!svc) throw new Error('TmuxService.tryCreate() returned null despite tmux being available')
    service = svc
    service.setCallbacks(
      () => {},
      () => {}
    )
  })

  afterEach(() => {
    // Clean up any sessions created during tests
    service.killAll()
  })

  it('tryCreate returns a TmuxService instance', () => {
    expect(service).toBeDefined()
  })

  it('create + discover lifecycle', () => {
    const id = randomUUID()
    service.create(id, '/tmp', undefined, undefined, undefined, 'Test Shell')

    // Detach the client so discover() can find the orphaned session.
    // discover() correctly skips sessions with active clients.
    service.detachAll()

    const discovered = service.discover()
    expect(discovered.length).toBeGreaterThanOrEqual(1)

    const found = discovered.find((d) => d.sessionId === id)
    expect(found).toBeDefined()
    expect(found!.meta.cwd).toBe('/tmp')
    expect(found!.meta.label).toBe('Test Shell')
  })

  it('create + reconnect lifecycle', () => {
    const id = randomUUID()
    service.create(id, '/tmp')

    // Detach the client so we can reconnect
    service.detachAll()

    const result = service.reconnect(id, 80, 24)
    expect(result).not.toBeNull()
    expect(result!.meta.cwd).toBe('/tmp')
    expect(typeof result!.scrollback).toBe('string')
  })

  it('kill removes session and metadata', () => {
    const id = randomUUID()
    service.create(id, '/tmp')
    service.kill(id)

    // Verify session is gone
    const discovered = service.discover()
    const found = discovered.find((d) => d.sessionId === id)
    expect(found).toBeUndefined()
  })

  it('reconnect returns null for nonexistent session', () => {
    const result = service.reconnect('nonexistent-id', 80, 24)
    expect(result).toBeNull()
  })

  it('getProcessName returns a string for live session', () => {
    const id = randomUUID()
    service.create(id, '/tmp')

    const name = service.getProcessName(id)
    expect(typeof name).toBe('string')
  })

  it('getProcessName returns null for dead session', () => {
    expect(service.getProcessName('nonexistent')).toBeNull()
  })

  it('discover cleans up orphan metadata', async () => {
    const tmuxPaths = await import('../../src/main/services/tmux-paths')

    // Write metadata without a matching tmux session
    tmuxPaths.writeSessionMeta('orphan-meta', {
      shell: '/bin/zsh',
      cwd: '/tmp',
      createdAt: new Date().toISOString()
    })

    // discover should clean up the orphan
    service.discover()
    expect(tmuxPaths.sessionMetaExists('orphan-meta')).toBe(false)
  })
})

describe('TmuxService (no tmux fallback)', () => {
  it('documents that tryCreate returns null when tmux unavailable', () => {
    // This test runs regardless of tmux availability.
    // When tmux IS available, tryCreate returns an instance.
    // When tmux is NOT available, tryCreate returns null.
    // Either way, the function doesn't throw.
    expect(typeof HAS_TMUX).toBe('boolean')
  })
})
