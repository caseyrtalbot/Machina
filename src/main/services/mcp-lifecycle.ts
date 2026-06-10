/**
 * MCP server lifecycle manager.
 *
 * Handles lazy creation, startup, and shutdown of the MCP server.
 * The server is created only when a vault is opened (vault root is known).
 */
import { join } from 'node:path'
import { app } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpServer } from './mcp-server'
import { PathGuard } from './path-guard'
import { AuditLogger } from './audit-logger'
import { VaultQueryFacade, type VaultQueryDeps } from './vault-query-facade'
import { ElectronHitlGate, WriteRateLimiter, TimeoutHitlGate } from './hitl-gate'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'

export class McpLifecycle {
  private server: McpServer | null = null
  private _toolCount = 0

  /**
   * Whether the in-process MCP server is connected to a transport and actually
   * serving requests. createForVault builds the server with tools registered but
   * deliberately does NOT connect a transport — the only production transport is
   * the headless stdio path in mcp-cli.ts. So this stays false in production.
   * The connect-or-delete decision for this in-process server is Wave 2 item 2.3.
   */
  isRunning(): boolean {
    return this.server?.isConnected() ?? false
  }

  /** Tools exposed to a connected client; zero while no transport is connected. */
  toolCount(): number {
    return this.isRunning() ? this._toolCount : 0
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
    }

    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(join(app.getPath('userData'), 'audit'))
    const facade = new VaultQueryFacade(guard, logger, vaultRoot, deps)
    const gate = new TimeoutHitlGate(new ElectronHitlGate())
    const rateLimiter = new WriteRateLimiter()

    const dispatchCanvasPlan = (plan: CanvasMutationPlan, canvasPath: string): void => {
      const window = getMainWindow()
      if (window) {
        typedSend(window, 'canvas:agent-plan-accepted', { plan, canvasPath })
      }
    }

    this.server = createMcpServer(facade, { gate, rateLimiter, dispatchCanvasPlan })
    this._toolCount = 6 // 4 read + 2 write (gate always provided)
    return this.server
  }

  /** Stop the MCP server and clean up resources. */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close()
      this.server = null
    }
  }
}
