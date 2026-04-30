// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const { mockExecFileSync, mockReadFileSync, mockReadSessionMeta } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(() => ''),
  mockReadFileSync: vi.fn(() => {
    throw new Error('no sidecar')
  }),
  mockReadSessionMeta: vi.fn(() => null as unknown)
}))

vi.mock('child_process', () => ({ execFileSync: mockExecFileSync }))
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }))
vi.mock('../session-paths', () => ({ readSessionMeta: mockReadSessionMeta }))

import { PtyMonitor } from '../pty-monitor'
import type { PtyService } from '../pty-service'

function makeFakePty(sessionIds: readonly string[], pidsByid: Record<string, number>): PtyService {
  return {
    getActiveSessions: () => [...sessionIds],
    getPid: (id: string) => pidsByid[id]
  } as unknown as PtyService
}

describe('AgentSidecarState shape', () => {
  it('emits displayName (not the legacy tmuxName field)', () => {
    const pty = makeFakePty(['abc123'], { abc123: 4242 })
    const monitor = new PtyMonitor('/tmp/vault', pty)
    const states = monitor.getAgentStates()
    expect(states).toHaveLength(1)
    const state = states[0]
    expect(state.sessionId).toBe('abc123')
    expect(state.displayName).toBe('te-abc123')
    // tmuxName must be gone — narrow assertion via key presence
    expect(Object.keys(state)).not.toContain('tmuxName')
  })
})
