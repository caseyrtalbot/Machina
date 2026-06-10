/**
 * MCP server lifecycle manager.
 *
 * Creates the gated MCP server when a vault is opened and serves it to
 * external clients (Claude Code, Claude Desktop) over a Streamable HTTP
 * transport bound to 127.0.0.1. Each HTTP session gets its own McpServer
 * instance from a shared factory; the facade, HITL gate, rate limiter, and
 * audit logger are shared so safety state spans sessions.
 *
 * See docs/architecture/adr/0002-in-process-mcp-streamable-http.md.
 */
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './mcp-server'
import { PathGuard } from './path-guard'
import { AuditLogger } from './audit-logger'
import { VaultQueryFacade, type VaultQueryDeps } from './vault-query-facade'
import { ElectronHitlGate, WriteRateLimiter, TimeoutHitlGate } from './hitl-gate'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'

/** Default port for the local MCP endpoint; override with MACHINA_MCP_PORT. */
export const DEFAULT_MCP_PORT = 41627

/** Path component of the MCP endpoint URL. */
const MCP_PATH = '/mcp'

/**
 * Tools registered by createMcpServer when a gate is provided (always, via
 * createForVault): 6 reads (vault.read_file, search.query, graph.get_neighbors,
 * graph.get_ghosts, project.map_folder, canvas.get_snapshot) + 3 gated writes
 * (vault.write_file, vault.create_file, canvas.apply_plan). A lifecycle test
 * lists tools over the transport and asserts this count, so it cannot go stale.
 */
export const MCP_TOOL_COUNT = 9

export interface McpStatus {
  readonly running: boolean
  readonly toolCount: number
  readonly url: string | null
  readonly vaultRoot: string | null
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

/** Host-header allowlist: blocks DNS-rebinding even though we bind loopback. */
function isLocalHost(hostHeader: string): boolean {
  const hostname = hostHeader.replace(/:\d+$/, '')
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

export class McpLifecycle {
  private serverFactory: (() => McpServer) | null = null
  private vaultRoot: string | null = null
  private httpServer: HttpServer | null = null
  private port: number | null = null
  private readonly sessions = new Map<string, StreamableHTTPServerTransport>()

  /** Whether the local Streamable HTTP endpoint is up and accepting clients. */
  isRunning(): boolean {
    return this.httpServer?.listening ?? false
  }

  /** Tools exposed to connecting clients; zero while the endpoint is down. */
  toolCount(): number {
    return this.isRunning() ? MCP_TOOL_COUNT : 0
  }

  /** Snapshot for the mcp:status IPC channel / Settings surface. */
  status(): McpStatus {
    const running = this.isRunning()
    return {
      running,
      toolCount: this.toolCount(),
      url: running && this.port !== null ? `http://127.0.0.1:${this.port}${MCP_PATH}` : null,
      vaultRoot: this.vaultRoot
    }
  }

  /**
   * Prepare the MCP server factory for a given vault. Existing sessions are
   * closed (they hold the previous vault's facade); the HTTP listener, if
   * already up, keeps running and serves new sessions against the new vault.
   * Audit logs are stored outside the vault at app.getPath('userData')/audit.
   */
  createForVault(vaultRoot: string, deps?: VaultQueryDeps): void {
    this.closeSessions()

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

    this.vaultRoot = vaultRoot
    this.serverFactory = () => createMcpServer(facade, { gate, rateLimiter, dispatchCanvasPlan })
  }

  /** Build one McpServer instance from the prepared factory (per HTTP session). */
  buildServer(): McpServer {
    if (!this.serverFactory) {
      throw new Error('McpLifecycle: createForVault must be called before buildServer')
    }
    return this.serverFactory()
  }

  /**
   * Start the localhost Streamable HTTP endpoint. Idempotent: a live listener
   * is kept (vault switches swap the factory, not the socket). Prefers
   * MACHINA_MCP_PORT / DEFAULT_MCP_PORT; falls back to an ephemeral port if
   * the preferred one is taken (e.g. a second Machina instance).
   */
  async startTransport(opts?: { port?: number }): Promise<void> {
    if (!this.serverFactory) {
      throw new Error('McpLifecycle: createForVault must be called before startTransport')
    }
    if (this.httpServer?.listening) return

    const envPort = Number.parseInt(process.env.MACHINA_MCP_PORT ?? '', 10)
    const preferred = opts?.port ?? (Number.isFinite(envPort) ? envPort : DEFAULT_MCP_PORT)

    try {
      this.httpServer = await this.listen(preferred)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && preferred !== 0) {
        console.error(`[mcp] port ${preferred} in use, falling back to an ephemeral port`)
        this.httpServer = await this.listen(0)
      } else {
        throw err
      }
    }
    this.port = (this.httpServer.address() as AddressInfo).port
  }

  /** Stop the endpoint and close all sessions. */
  async stop(): Promise<void> {
    this.closeSessions()
    const server = this.httpServer
    this.httpServer = null
    this.port = null
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        // close() waits for idle connections; force-close any stragglers.
        server.closeAllConnections?.()
      })
    }
  }

  private closeSessions(): void {
    for (const transport of this.sessions.values()) {
      transport.close().catch(() => {})
    }
    this.sessions.clear()
  }

  private listen(port: number): Promise<HttpServer> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((err) => {
          console.error('[mcp] request handling failed', err)
          writeJsonRpcError(res, 500, -32603, 'Internal server error')
        })
      })
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject)
        server.on('error', (err) => console.error('[mcp] http server error', err))
        resolve(server)
      })
    })
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLocalHost(req.headers.host ?? '')) {
      writeJsonRpcError(res, 403, -32000, 'Forbidden: localhost only')
      return
    }
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname !== MCP_PATH) {
      writeJsonRpcError(res, 404, -32000, 'Not found')
      return
    }

    const sessionHeader = req.headers['mcp-session-id']
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader
    if (sessionId) {
      const existing = this.sessions.get(sessionId)
      if (!existing) {
        writeJsonRpcError(res, 404, -32001, 'Session not found')
        return
      }
      await existing.handleRequest(req, res)
      return
    }

    // No session header: only an initialize POST may open a new session.
    if (req.method !== 'POST') {
      writeJsonRpcError(res, 400, -32000, 'Bad request: missing mcp-session-id header')
      return
    }
    const factory = this.serverFactory
    if (!factory) {
      writeJsonRpcError(res, 503, -32000, 'No vault open')
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, transport)
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id)
      }
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id) this.sessions.delete(id)
    }

    const server = factory()
    await server.connect(transport)
    await transport.handleRequest(req, res)

    // Non-initialize request without a session id: the transport already
    // responded 400; drop the orphan (closing it also closes the server).
    if (!transport.sessionId) {
      await transport.close()
    }
  }
}
