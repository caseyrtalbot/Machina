/**
 * Tests for the standalone MCP CLI server setup.
 *
 * Verifies that startMcpServer correctly indexes a vault, creates
 * a read-only MCP server, and connects it to a transport.
 * Uses InMemoryTransport to avoid actual stdio.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../mcp-server'
import { PathGuard } from '../path-guard'
import { AuditLogger } from '../audit-logger'
import { VaultQueryFacade } from '../vault-query-facade'
import { initVaultIndex } from '../vault-indexing'

const HELLO_MD = [
  '---',
  'id: hello',
  'title: Hello',
  'type: note',
  'created: 2026-01-01',
  'modified: 2026-01-01',
  'tags:',
  '  - greeting',
  'connections:',
  '  - world',
  '---',
  '',
  '# Hello World',
  '',
  'A greeting note with a [[world]] link.',
  ''
].join('\n')

const WORLD_MD = [
  '---',
  'id: world',
  'title: World',
  'type: note',
  'created: 2026-01-01',
  'modified: 2026-01-01',
  'tags:',
  '  - place',
  '---',
  '',
  '# World',
  '',
  'The world is vast.',
  ''
].join('\n')

function createTestVault(): string {
  const base = join(tmpdir(), `mcp-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(base, 'notes'), { recursive: true })
  writeFileSync(join(base, 'notes', 'hello.md'), HELLO_MD)
  writeFileSync(join(base, 'notes', 'world.md'), WORLD_MD)
  return realpathSync(base)
}

describe('MCP CLI server (standalone)', () => {
  let vaultRoot: string
  let auditDir: string

  beforeEach(() => {
    vaultRoot = createTestVault()
    auditDir = join(tmpdir(), `mcp-cli-audit-${Date.now()}`)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
    rmSync(auditDir, { recursive: true, force: true })
  })

  async function createCliServer() {
    const deps = await initVaultIndex(vaultRoot)
    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(auditDir)
    const facade = new VaultQueryFacade(guard, logger, vaultRoot, deps)
    // No gate = read-only tools only
    const server = createMcpServer(facade)

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    return { server, client, deps }
  }

  it('indexes vault files and creates a server with 4 read-only tools', async () => {
    const { server, client, deps } = await createCliServer()

    // Should have indexed both files
    expect(deps.vaultIndex.getArtifacts().length).toBe(2)

    // Should only expose read tools (no gate = no write tools)
    const tools = await client.listTools()
    const toolNames = tools.tools.map((t) => t.name).sort()
    expect(toolNames).toEqual([
      'graph.get_ghosts',
      'graph.get_neighbors',
      'search.query',
      'vault.read_file'
    ])

    await client.close()
    await server.close()
  })

  it('vault.read_file returns content wrapped in Spotlighting markers', async () => {
    const { server, client } = await createCliServer()

    const result = await client.callTool({
      name: 'vault.read_file',
      arguments: { path: join(vaultRoot, 'notes', 'hello.md') }
    })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('trust="user_content"')
    expect(text).toContain('Hello World')
    expect(text).toContain('SPOTLIGHT')

    await client.close()
    await server.close()
  })

  it('search.query finds indexed notes', async () => {
    const { server, client } = await createCliServer()

    const result = await client.callTool({
      name: 'search.query',
      arguments: { query: 'greeting' }
    })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    const hits = JSON.parse(text)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].title).toBe('Hello')

    await client.close()
    await server.close()
  })

  it('graph.get_neighbors returns edges for connected nodes', async () => {
    const { server, client } = await createCliServer()

    const result = await client.callTool({
      name: 'graph.get_neighbors',
      arguments: { nodeId: 'hello' }
    })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    const parsed = JSON.parse(text)
    expect(parsed.edges.length).toBeGreaterThanOrEqual(1)
    expect(parsed.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'hello', target: 'world' })])
    )

    await client.close()
    await server.close()
  })

  it('vault.read_file rejects paths outside vault', async () => {
    const { server, client } = await createCliServer()

    const result = await client.callTool({
      name: 'vault.read_file',
      arguments: { path: '/etc/passwd' }
    })

    expect(result.isError).toBe(true)

    await client.close()
    await server.close()
  })
})
