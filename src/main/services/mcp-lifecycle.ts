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
import { VaultQueryFacade } from './vault-query-facade'
import { ElectronHitlGate, WriteRateLimiter } from './hitl-gate'
import type { McpStatusProvider } from '../ipc/mcp'

export class McpLifecycle implements McpStatusProvider {
  private server: McpServer | null = null
  private running = false
  private _toolCount = 0

  isRunning(): boolean {
    return this.running
  }

  toolCount(): number {
    return this.running ? this._toolCount : 0
  }

  /**
   * Create and prepare the MCP server for a given vault.
   * Does not start stdio transport (that requires an external connection).
   * Audit logs are stored outside the vault at app.getPath('userData')/audit.
   */
  createForVault(vaultRoot: string): McpServer {
    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(join(app.getPath('userData'), 'audit'))
    const facade = new VaultQueryFacade(guard, logger, vaultRoot)
    const gate = new ElectronHitlGate()
    const rateLimiter = new WriteRateLimiter()

    this.server = createMcpServer(facade, { gate, rateLimiter })
    this._toolCount = 5 // 3 read + 2 write (gate always provided)
    this.running = true
    return this.server
  }

  /** Stop the MCP server and clean up resources. */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close()
      this.server = null
      this.running = false
    }
  }
}
