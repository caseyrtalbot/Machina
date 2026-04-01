/**
 * Tests for registerMcpIpc: exposes MCP server status to the renderer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron ipcMain before importing the module under test
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      __getHandler: (channel: string) => handlers.get(channel)
    }
  }
})

import { ipcMain } from 'electron'
import { registerMcpIpc, type McpStatusProvider } from '../mcp'

describe('registerMcpIpc', () => {
  let provider: McpStatusProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = {
      isRunning: () => false,
      toolCount: () => 0
    }
  })

  it('registers mcp:status handler', () => {
    registerMcpIpc(provider)
    expect(ipcMain.handle).toHaveBeenCalledWith('mcp:status', expect.any(Function))
  })

  it('returns running: false when server is not started', async () => {
    registerMcpIpc(provider)
    const handler = (
      ipcMain as unknown as { __getHandler: (c: string) => (...args: unknown[]) => unknown }
    ).__getHandler('mcp:status')
    const result = await handler(null)
    expect(result).toEqual({ running: false, toolCount: 0 })
  })

  it('returns running: true when server is started', async () => {
    provider = { isRunning: () => true, toolCount: () => 3 }
    registerMcpIpc(provider)
    const handler = (
      ipcMain as unknown as { __getHandler: (c: string) => (...args: unknown[]) => unknown }
    ).__getHandler('mcp:status')
    const result = await handler(null)
    expect(result).toEqual({ running: true, toolCount: 3 })
  })
})
