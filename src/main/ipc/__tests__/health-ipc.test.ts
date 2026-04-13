import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  currentWindow: null as unknown,
  sent: [] as Array<{ window: unknown; event: string; data: unknown }>,
  handlers: new Map<string, (args?: unknown) => Promise<void>>()
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args?: unknown) => Promise<void>) => {
    state.handlers.set(channel, handler)
  }),
  typedSend: vi.fn((window: unknown, event: string, data: unknown) => {
    state.sent.push({ window, event, data })
  })
}))

vi.mock('../../window-registry', () => ({
  getMainWindow: () => state.currentWindow
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerHealthIpc, setHealthMonitor, emitHealthReport } from '../health'
import type { VaultHealthMonitor } from '../../services/vault-health-monitor'
import type { InfraHealth } from '@shared/engine/vault-health'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerHealthIpc', () => {
  beforeEach(() => {
    state.currentWindow = { id: 'main', isDestroyed: () => false, webContents: {} }
    state.sent.length = 0
    state.handlers.clear()
  })

  it('registers health:heartbeat and health:request-tick handlers', () => {
    registerHealthIpc()

    expect(state.handlers.has('health:heartbeat')).toBe(true)
    expect(state.handlers.has('health:request-tick')).toBe(true)
  })

  it('heartbeat handler calls recordWorkerHeartbeat on monitor', async () => {
    registerHealthIpc()

    const monitor = {
      recordWorkerHeartbeat: vi.fn(),
      recordFileChange: vi.fn(),
      requestTick: vi.fn()
    } as unknown as VaultHealthMonitor

    setHealthMonitor(monitor)

    await state.handlers.get('health:heartbeat')?.({ at: 12345 })

    expect(monitor.recordWorkerHeartbeat).toHaveBeenCalledWith(12345)
  })

  it('request-tick handler calls requestTick on monitor', async () => {
    registerHealthIpc()

    const monitor = {
      recordWorkerHeartbeat: vi.fn(),
      recordFileChange: vi.fn(),
      requestTick: vi.fn()
    } as unknown as VaultHealthMonitor

    setHealthMonitor(monitor)

    await state.handlers.get('health:request-tick')?.()

    expect(monitor.requestTick).toHaveBeenCalled()
  })

  it('handlers are safe when no monitor is set', async () => {
    registerHealthIpc()
    setHealthMonitor(null as unknown as VaultHealthMonitor)

    // Should not throw
    await state.handlers.get('health:heartbeat')?.({ at: 999 })
    await state.handlers.get('health:request-tick')?.()
  })
})

describe('emitHealthReport', () => {
  beforeEach(() => {
    state.currentWindow = { id: 'main', isDestroyed: () => false, webContents: {} }
    state.sent.length = 0
  })

  it('sends health:report event to the main window', () => {
    const report: InfraHealth = {
      runs: [
        {
          checkId: 'vault-reachable',
          ranAt: 1000,
          passed: true,
          issues: []
        }
      ],
      computedAt: 1000
    }

    emitHealthReport(report)

    expect(state.sent).toEqual([
      {
        window: state.currentWindow,
        event: 'health:report',
        data: report
      }
    ])
  })

  it('does not send when no window exists', () => {
    state.currentWindow = null

    const report: InfraHealth = { runs: [], computedAt: 1000 }
    emitHealthReport(report)

    expect(state.sent).toHaveLength(0)
  })
})
