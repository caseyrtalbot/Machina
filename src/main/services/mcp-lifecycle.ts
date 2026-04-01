/**
 * MCP server lifecycle manager.
 *
 * Handles lazy creation, startup, and shutdown of the MCP server.
 * The server is created only when a vault is opened (vault root is known).
 * Implements McpStatusProvider for the MCP IPC status channel.
 */
import { join } from 'node:path'
import { app } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpServer } from './mcp-server'
import { PathGuard } from './path-guard'
import { AuditLogger } from './audit-logger'
import { VaultQueryFacade, type VaultQueryDeps } from './vault-query-facade'
import { ElectronHitlGate, WriteRateLimiter } from './hitl-gate'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { McpStatusProvider } from '../ipc/mcp'

export class McpLifecycle implements McpStatusProvider {
  private server: McpServer | null = null
  private _created = false
  private _toolCount = 0

  /** Whether the MCP server has been created (not necessarily connected to a transport). */
  isRunning(): boolean {
    return this._created
  }

  toolCount(): number {
    return this._created ? this._toolCount : 0
  }

  /**
   * Create and prepare the MCP server for a given vault.
   * The server is created with tools registered but NOT connected to a transport.
   * A stdio or HTTP transport must be connected separately for external agents to use it.
   * Audit logs are stored outside the vault at app.getPath('userData')/audit.
   */
  createForVault(vaultRoot: string, deps?: VaultQueryDeps): McpServer {
    // Stop previous server if switching vaults
    if (this.server) {
      this.server.close().catch(() => {})
      this.server = null
      this._created = false
    }

    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(join(app.getPath('userData'), 'audit'))
    const facade = new VaultQueryFacade(guard, logger, vaultRoot, deps)
    const gate = new ElectronHitlGate()
    const rateLimiter = new WriteRateLimiter()

    const dispatchCanvasPlan = (plan: CanvasMutationPlan): void => {
      const window = getMainWindow()
      if (window) {
        typedSend(window, 'canvas:agent-plan-accepted', { plan })
      }
    }

    this.server = createMcpServer(facade, { gate, rateLimiter, dispatchCanvasPlan })
    this._toolCount = 6 // 4 read + 2 write (gate always provided)
    this._created = true
    return this.server
  }

  /** Stop the MCP server and clean up resources. */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close()
      this.server = null
      this._created = false
    }
  }
}
