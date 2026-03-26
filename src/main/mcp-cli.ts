#!/usr/bin/env node
/**
 * Standalone MCP server for Thought Engine vaults.
 *
 * Claude Code (or any MCP client) spawns this as a subprocess and
 * communicates over stdio. The server exposes read-only vault tools:
 * vault.read_file, search.query, graph.get_neighbors.
 *
 * Write tools are intentionally excluded: without Electron's dialog
 * there is no HITL gate to confirm destructive operations.
 *
 * Usage:
 *   node out/main/mcp-cli.js /path/to/vault
 *
 * Claude Code config (~/.claude/settings.json):
 *   "mcpServers": {
 *     "thought-engine": {
 *       "command": "node",
 *       "args": ["<project>/out/main/mcp-cli.js", "/path/to/vault"]
 *     }
 *   }
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createMcpServer } from './services/mcp-server'
import { PathGuard } from './services/path-guard'
import { AuditLogger } from './services/audit-logger'
import { VaultQueryFacade } from './services/vault-query-facade'
import { initVaultIndex } from './services/vault-indexing'

/** Resolve audit log directory (no Electron app.getPath, use ~/.thought-engine/audit). */
function auditLogDir(): string {
  return join(homedir(), '.thought-engine', 'audit')
}

function parseVaultPath(args: readonly string[]): string {
  const vaultPath = args[2] // node script.js <vault-path>
  if (!vaultPath) {
    process.stderr.write(
      'Usage: thought-engine-mcp <vault-path>\n\n' +
        'Starts a read-only MCP server for the given vault.\n' +
        'Communicates over stdio (JSON-RPC).\n'
    )
    process.exit(1)
  }
  return vaultPath
}

export async function startMcpServer(vaultPath: string): Promise<void> {
  process.stderr.write(`[thought-engine-mcp] Indexing vault: ${vaultPath}\n`)

  const deps = await initVaultIndex(vaultPath)

  const guard = new PathGuard(vaultPath)
  const logger = new AuditLogger(auditLogDir())
  const facade = new VaultQueryFacade(guard, logger, vaultPath, deps)

  // No gate/rateLimiter = read-only tools only
  const server = createMcpServer(facade)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  process.stderr.write(
    `[thought-engine-mcp] Server ready (3 read-only tools, ${deps.vaultIndex.getArtifacts().length} files indexed)\n`
  )
}

// Run when executed directly (not imported for testing)
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('mcp-cli.js') || process.argv[1].endsWith('mcp-cli.ts'))

if (isDirectRun) {
  const vaultPath = parseVaultPath(process.argv)
  startMcpServer(vaultPath).catch((err) => {
    process.stderr.write(`[thought-engine-mcp] Fatal: ${String(err)}\n`)
    process.exit(1)
  })
}
