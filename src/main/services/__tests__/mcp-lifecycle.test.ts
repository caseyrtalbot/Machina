/**
 * Tests for McpLifecycle: lazy MCP server creation with optional vault deps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
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
import { McpLifecycle } from '../mcp-lifecycle'
import { VaultIndex } from '@shared/engine/indexer'
import { SearchEngine } from '@shared/engine/search-engine'
import { buildVaultDeps } from '../vault-indexing'

function createTestVault(): string {
  const base = join(tmpdir(), `mcp-lc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(base, 'notes'), { recursive: true })
  writeFileSync(
    join(base, 'notes', 'hello.md'),
    '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags:\n  - greeting\nconnections:\n  - world\n---\n\n# Hello World\n\nA greeting note.\n'
  )
  writeFileSync(
    join(base, 'notes', 'world.md'),
    '---\nid: world\ntitle: World\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags:\n  - place\n---\n\n# World\n\nThe world is vast.\n'
  )
  return realpathSync(base)
}

describe('McpLifecycle', () => {
  let vaultRoot: string

  beforeEach(() => {
    vaultRoot = createTestVault()
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('createForVault builds a server but does NOT report it as running until a transport connects', () => {
    const lifecycle = new McpLifecycle()
    const vaultIndex = new VaultIndex()
    const searchEngine = new SearchEngine()

    vaultIndex.addFile(
      'hello.md',
      '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\nconnections:\n  - world\n---\n\nHello body\n'
    )
    vaultIndex.addFile(
      'world.md',
      '---\nid: world\ntitle: World\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\n---\n\nWorld body\n'
    )
    searchEngine.upsert({
      id: 'hello',
      title: 'Hello',
      tags: [],
      body: 'Hello body',
      path: join(vaultRoot, 'notes', 'hello.md')
    })

    const server = lifecycle.createForVault(vaultRoot, { searchEngine, vaultIndex })

    expect(server).toBeDefined()
    // Built but no transport connected — status must not advertise it.
    expect(lifecycle.isRunning()).toBe(false)
    expect(lifecycle.toolCount()).toBe(0)
  })

  it('createForVault still works without deps (backward compatible)', () => {
    const lifecycle = new McpLifecycle()
    const server = lifecycle.createForVault(vaultRoot)

    expect(server).toBeDefined()
    expect(lifecycle.isRunning()).toBe(false)
  })

  it('reports running/toolCount only while a transport is connected', async () => {
    const lifecycle = new McpLifecycle()
    const server = lifecycle.createForVault(vaultRoot)
    expect(lifecycle.isRunning()).toBe(false)

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    // Now genuinely connected and serving.
    expect(lifecycle.isRunning()).toBe(true)
    expect(lifecycle.toolCount()).toBe(6)

    await client.close()
    await server.close()

    // Disconnected again — status falls back to not-running.
    expect(lifecycle.isRunning()).toBe(false)
    expect(lifecycle.toolCount()).toBe(0)
  })

  describe('MCP data flow with buildVaultDeps', () => {
    const HELLO_MD =
      '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags:\n  - greeting\nconnections:\n  - world\n---\n\n# Hello World\n\nA greeting note.\n'
    const WORLD_MD =
      '---\nid: world\ntitle: World\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags:\n  - place\n---\n\n# World\n\nThe world is vast.\n'

    it('search.query returns results through MCP transport', async () => {
      const deps = buildVaultDeps([
        { path: 'notes/hello.md', content: HELLO_MD },
        { path: 'notes/world.md', content: WORLD_MD }
      ])
      const lifecycle = new McpLifecycle()
      const server = lifecycle.createForVault(vaultRoot, deps)

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

    it('search.query paths can be fed back into vault.read_file', async () => {
      const deps = buildVaultDeps([
        { path: join(vaultRoot, 'notes', 'hello.md'), content: HELLO_MD },
        { path: join(vaultRoot, 'notes', 'world.md'), content: WORLD_MD }
      ])
      const lifecycle = new McpLifecycle()
      const server = lifecycle.createForVault(vaultRoot, deps)

      const client = new Client({ name: 'test-client', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      const searchResult = await client.callTool({
        name: 'search.query',
        arguments: { query: 'greeting' }
      })

      const searchText = (searchResult.content as Array<{ type: string; text: string }>)[0].text
      const hits = JSON.parse(searchText) as Array<{ path: string }>
      expect(hits[0]?.path).toBe(join(vaultRoot, 'notes', 'hello.md'))

      const readResult = await client.callTool({
        name: 'vault.read_file',
        arguments: { path: hits[0].path }
      })

      const readText = (readResult.content as Array<{ type: string; text: string }>)[0].text
      expect(readText).toContain('A greeting note.')

      await client.close()
      await server.close()
    })

    it('graph.get_neighbors returns edges through MCP transport', async () => {
      const deps = buildVaultDeps([
        { path: 'notes/hello.md', content: HELLO_MD },
        { path: 'notes/world.md', content: WORLD_MD }
      ])
      const lifecycle = new McpLifecycle()
      const server = lifecycle.createForVault(vaultRoot, deps)

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
      const lifecycle = new McpLifecycle()
      const server = lifecycle.createForVault(vaultRoot) // No deps!

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
      expect(hits).toHaveLength(0) // Bug: no deps = no results

      await client.close()
      await server.close()
    })
  })
})
