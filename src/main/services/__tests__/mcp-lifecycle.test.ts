// @vitest-environment node
/**
 * Tests for McpLifecycle: vault-scoped MCP server factory + localhost
 * Streamable HTTP transport (external clients connect over HTTP).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock electron modules before importing McpLifecycle
vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'te-lifecycle-test-userdata')
  }
}))

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpLifecycle, MCP_TOOL_COUNT, setMcpApprovalQueueProvider } from '../mcp-lifecycle'
import { buildVaultDeps, applyFileToIndex } from '../vault-indexing'

const HELLO_MD =
  '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags:\n  - greeting\nconnections:\n  - world\n---\n\n# Hello World\n\nA greeting note.\n'
const WORLD_MD =
  '---\nid: world\ntitle: World\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags:\n  - place\n---\n\n# World\n\nThe world is vast.\n'

function createTestVault(): string {
  const base = join(tmpdir(), `mcp-lc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(base, 'notes'), { recursive: true })
  writeFileSync(join(base, 'notes', 'hello.md'), HELLO_MD)
  writeFileSync(join(base, 'notes', 'world.md'), WORLD_MD)
  return realpathSync(base)
}

describe('McpLifecycle', () => {
  let vaultRoot: string
  let lifecycle: McpLifecycle

  beforeEach(() => {
    vaultRoot = createTestVault()
    lifecycle = new McpLifecycle()
  })

  afterEach(async () => {
    await lifecycle.stop()
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('createForVault prepares the factory but does not report running until the transport starts', () => {
    lifecycle.createForVault(vaultRoot, buildVaultDeps([]))

    expect(lifecycle.isRunning()).toBe(false)
    expect(lifecycle.toolCount()).toBe(0)
    expect(lifecycle.status()).toEqual({
      running: false,
      toolCount: 0,
      url: null,
      vaultRoot
    })
  })

  it('startTransport before createForVault throws', async () => {
    await expect(lifecycle.startTransport({ port: 0 })).rejects.toThrow(/createForVault/)
  })

  it('startTransport serves a localhost URL and status reflects it; stop tears it down', async () => {
    lifecycle.createForVault(vaultRoot, buildVaultDeps([]))
    await lifecycle.startTransport({ port: 0 })

    expect(lifecycle.isRunning()).toBe(true)
    expect(lifecycle.toolCount()).toBe(MCP_TOOL_COUNT)
    const status = lifecycle.status()
    expect(status.running).toBe(true)
    expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(status.vaultRoot).toBe(vaultRoot)

    await lifecycle.stop()
    expect(lifecycle.isRunning()).toBe(false)
    expect(lifecycle.toolCount()).toBe(0)
    expect(lifecycle.status().url).toBeNull()
  })

  it('an external HTTP client can connect, list all gated tools, and query the vault', async () => {
    const deps = buildVaultDeps([
      { path: join(vaultRoot, 'notes', 'hello.md'), content: HELLO_MD },
      { path: join(vaultRoot, 'notes', 'world.md'), content: WORLD_MD }
    ])
    lifecycle.createForVault(vaultRoot, deps)
    await lifecycle.startTransport({ port: 0 })

    const url = lifecycle.status().url
    expect(url).not.toBeNull()

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(url as string))
    await client.connect(transport)

    // Guards the MCP_TOOL_COUNT constant against going stale.
    const tools = await client.listTools()
    expect(tools.tools).toHaveLength(MCP_TOOL_COUNT)

    const result = await client.callTool({
      name: 'search.query',
      arguments: { query: 'greeting' }
    })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    const hits = JSON.parse(text) as Array<{ title: string; path: string }>
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].title).toBe('Hello')

    const readResult = await client.callTool({
      name: 'vault.read_file',
      arguments: { path: hits[0].path }
    })
    const readText = (readResult.content as Array<{ type: string; text: string }>)[0].text
    expect(readText).toContain('A greeting note.')

    await client.close()
  })

  it('search over HTTP sees live index updates made after vault open', async () => {
    const deps = buildVaultDeps([])
    lifecycle.createForVault(vaultRoot, deps)
    await lifecycle.startTransport({ port: 0 })

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(lifecycle.status().url as string))
    )

    const before = await client.callTool({
      name: 'search.query',
      arguments: { query: 'greeting' }
    })
    expect(JSON.parse((before.content as Array<{ text: string }>)[0].text)).toHaveLength(0)

    // Simulate a watcher-driven index update landing while the server runs.
    applyFileToIndex(deps, join(vaultRoot, 'notes', 'hello.md'), HELLO_MD)

    const after = await client.callTool({
      name: 'search.query',
      arguments: { query: 'greeting' }
    })
    const hits = JSON.parse((after.content as Array<{ text: string }>)[0].text)
    expect(hits.length).toBeGreaterThanOrEqual(1)

    await client.close()
  })

  it('rejects requests with a non-local Host header', async () => {
    lifecycle.createForVault(vaultRoot, buildVaultDeps([]))
    await lifecycle.startTransport({ port: 0 })

    // fetch/undici strips a custom Host header, so use raw http.request.
    const url = new URL(lifecycle.status().url as string)
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            Host: 'evil.example.com',
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream'
          }
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      req.end(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }))
    })
    expect(status).toBe(403)
  })

  describe('MCP data flow with buildVaultDeps (in-memory transport via buildServer)', () => {
    it('search.query returns results through MCP transport', async () => {
      const deps = buildVaultDeps([
        { path: 'notes/hello.md', content: HELLO_MD },
        { path: 'notes/world.md', content: WORLD_MD }
      ])
      lifecycle.createForVault(vaultRoot, deps)
      const server = lifecycle.buildServer()

      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'search.query',
        arguments: { query: 'greeting' }
      })

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      const hits = JSON.parse(text)
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(hits[0].title).toBe('Hello')
      expect(hits[0].path).toBe('notes/hello.md')

      await client.close()
      await server.close()
    })

    it('graph.get_neighbors returns edges through MCP transport', async () => {
      const deps = buildVaultDeps([
        { path: 'notes/hello.md', content: HELLO_MD },
        { path: 'notes/world.md', content: WORLD_MD }
      ])
      lifecycle.createForVault(vaultRoot, deps)
      const server = lifecycle.buildServer()

      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'graph.get_neighbors',
        arguments: { nodeId: 'hello' }
      })

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      const parsed = JSON.parse(text)
      expect(parsed.edges).toHaveLength(1)
      expect(parsed.edges[0]).toEqual(
        expect.objectContaining({ source: 'hello', target: 'world', kind: 'connection' })
      )

      await client.close()
      await server.close()
    })

    it('search.query returns empty without deps (the original bug)', async () => {
      lifecycle.createForVault(vaultRoot) // No deps!
      const server = lifecycle.buildServer()

      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'search.query',
        arguments: { query: 'greeting' }
      })

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      expect(JSON.parse(text)).toHaveLength(0)

      await client.close()
      await server.close()
    })
  })

  // ── MCP gate convergence (Phase 3 step 2, contracts §4 v1.3.1) ───────────
  // The write gate is QueueHitlGate over the approval queue, late-bound via
  // setMcpApprovalQueueProvider (wired in registerGitIpc). Order matters
  // inside this describe: the fail-closed test runs BEFORE any provider is
  // set (module state starts unwired).
  describe('MCP gate convergence (v1.3.1)', () => {
    async function callWriteFile(): Promise<{ text: string; isError: boolean; target: string }> {
      lifecycle.createForVault(vaultRoot, buildVaultDeps([]))
      const server = lifecycle.buildServer()
      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      // write_file requires an EXISTING file at an absolute path (pre-gate
      // mtime capture stats it before the confirm).
      const target = join(vaultRoot, 'notes', 'hello.md')
      const result = await client.callTool({
        name: 'vault.write_file',
        arguments: { path: target, content: 'agent content' }
      })
      await client.close()
      await server.close()
      return {
        text: (result.content as Array<{ type: string; text: string }>)[0].text,
        isError: result.isError === true,
        target
      }
    }

    it('fail-closed: an unwired provider denies writes instead of falling back to a dialog', async () => {
      const { text, isError } = await callWriteFile()
      expect(isError).toBe(true)
      expect(text).toBe('Denied: Approval queue not wired')
    })

    it('write confirms delegate to the queue backend (QueueHitlGate over enqueueGateConfirm)', async () => {
      const seen: Array<{ tool: string; path: string }> = []
      setMcpApprovalQueueProvider(() => ({
        enqueueGateConfirm: async (opts, timeoutMs) => {
          seen.push({ tool: opts.tool, path: opts.path })
          // Production default flows through: the queue owns the timeout.
          expect(timeoutMs).toBe(30_000)
          return { allowed: false, reason: 'User denied via approvals queue' }
        }
      }))

      const { text, isError, target } = await callWriteFile()

      expect(seen).toEqual([{ tool: 'vault.write_file', path: target }])
      expect(isError).toBe(true)
      expect(text).toBe('Denied: User denied via approvals queue')
    })
  })
})
