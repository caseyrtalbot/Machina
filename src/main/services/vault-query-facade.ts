/**
 * VaultQueryFacade: safe, audited access to vault content.
 *
 * Wraps PathGuard (boundary enforcement) and AuditLogger (security audit trail)
 * to provide query and write methods for the MCP server.
 */
import { readFile, stat, writeFile as fsWriteFile, open } from 'node:fs/promises'
import matter from 'gray-matter'
import { PathGuardError } from '@shared/agent-types'
import type { PathGuard } from './path-guard'
import type { AuditLogger } from './audit-logger'
import type { SearchEngine, SearchHit } from '@shared/engine/search-engine'
import type { VaultIndex } from '@shared/engine/indexer'
import type { GraphNode, GraphEdge } from '@shared/types'
import { buildGhostIndex, type GhostEntry } from '@shared/engine/ghost-index'

export interface VaultQueryDeps {
  readonly searchEngine?: SearchEngine
  readonly vaultIndex?: VaultIndex
}

export interface NeighborResult {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

export interface WriteFileOpts {
  readonly agentId: string
  readonly expectedMtime?: string
}

/** Error thrown when optimistic lock fails due to mtime mismatch. */
export class MtimeConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(`Conflict: expected mtime ${expected} but found ${actual} for ${path}`)
    this.name = 'MtimeConflictError'
  }
}

/** Error thrown when a required frontmatter id: field is missing. */
export class MissingIdError extends Error {
  constructor(readonly path: string) {
    super(`Agent-created file must include a frontmatter id: field: ${path}`)
    this.name = 'MissingIdError'
  }
}

export class VaultQueryFacade {
  private readonly searchEngine?: SearchEngine
  private readonly vaultIndex?: VaultIndex

  readonly vaultRoot: string

  constructor(
    private readonly guard: PathGuard,
    private readonly logger: AuditLogger,
    vaultRoot: string,
    deps?: VaultQueryDeps
  ) {
    this.vaultRoot = vaultRoot
    this.searchEngine = deps?.searchEngine
    this.vaultIndex = deps?.vaultIndex
  }

  async readFile(filePath: string): Promise<string> {
    const start = Date.now()
    let resolved: string
    try {
      resolved = this.guard.assertWithinVault(filePath)
    } catch (err) {
      this.logger.log({
        ts: new Date().toISOString(),
        tool: 'vault.read_file',
        args: { path: filePath },
        affectedPaths: [filePath],
        decision: 'denied',
        durationMs: Date.now() - start,
        error: err instanceof PathGuardError ? err.message : String(err)
      })
      throw err
    }
    const content = await readFile(resolved, 'utf-8')
    this.logger.log({
      ts: new Date().toISOString(),
      tool: 'vault.read_file',
      args: { path: filePath },
      affectedPaths: [resolved],
      decision: 'allowed',
      durationMs: Date.now() - start
    })
    return content
  }

  async writeFile(filePath: string, content: string, opts: WriteFileOpts): Promise<void> {
    const start = Date.now()
    let resolved: string
    try {
      resolved = this.guard.assertWithinVault(filePath)
    } catch (err) {
      this.logger.log({
        ts: new Date().toISOString(),
        tool: 'vault.write_file',
        args: { path: filePath },
        affectedPaths: [filePath],
        decision: 'denied',
        durationMs: Date.now() - start,
        error: err instanceof PathGuardError ? err.message : String(err)
      })
      throw err
    }

    // Optimistic locking: check mtime if expectedMtime provided
    if (opts.expectedMtime) {
      const fileStat = await stat(resolved)
      const actual = fileStat.mtime.toISOString()
      if (actual !== opts.expectedMtime) {
        throw new MtimeConflictError(filePath, opts.expectedMtime, actual)
      }
    }

    // Stamp provenance in frontmatter
    const stamped = this.stampProvenance(content, opts.agentId)

    await fsWriteFile(resolved, stamped, 'utf-8')

    this.logger.log({
      ts: new Date().toISOString(),
      tool: 'vault.write_file',
      args: { path: filePath, agentId: opts.agentId },
      affectedPaths: [resolved],
      decision: 'allowed',
      durationMs: Date.now() - start
    })
  }

  async createFile(filePath: string, content: string, opts: { agentId: string }): Promise<void> {
    const start = Date.now()
    let resolved: string
    try {
      resolved = this.guard.assertWithinVault(filePath)
    } catch (err) {
      this.logger.log({
        ts: new Date().toISOString(),
        tool: 'vault.create_file',
        args: { path: filePath },
        affectedPaths: [filePath],
        decision: 'denied',
        durationMs: Date.now() - start,
        error: err instanceof PathGuardError ? err.message : String(err)
      })
      throw err
    }

    // Validate that content has a frontmatter id: field
    const parsed = matter(content)
    if (!parsed.data.id) {
      throw new MissingIdError(filePath)
    }

    // Stamp creation provenance
    const data = {
      ...parsed.data,
      created_by: opts.agentId,
      created_at: new Date().toISOString()
    }
    const stamped = matter.stringify(parsed.content, data)

    // Exclusive create: fail if file already exists (prevents silent overwrite)
    const fh = await open(resolved, 'wx')
    try {
      await fh.writeFile(stamped, 'utf-8')
    } finally {
      await fh.close()
    }

    this.logger.log({
      ts: new Date().toISOString(),
      tool: 'vault.create_file',
      args: { path: filePath, agentId: opts.agentId },
      affectedPaths: [resolved],
      decision: 'allowed',
      durationMs: Date.now() - start
    })
  }

  /**
   * Inject modified_by and modified_at into file frontmatter.
   * Parses existing frontmatter, adds provenance fields, re-serializes.
   */
  private stampProvenance(content: string, agentId: string): string {
    const parsed = matter(content)
    const data = {
      ...parsed.data,
      modified_by: agentId,
      modified_at: new Date().toISOString()
    }
    return matter.stringify(parsed.content, data)
  }

  search(query: string, limit?: number): readonly SearchHit[] {
    if (!this.searchEngine) return []
    return this.searchEngine.search(query, limit)
  }

  getNeighbors(nodeId: string): NeighborResult {
    if (!this.vaultIndex) return { nodes: [], edges: [] }
    const graph = this.vaultIndex.getGraph()
    const edges = graph.edges.filter((e) => e.source === nodeId || e.target === nodeId)
    const neighborIds = new Set<string>()
    for (const e of edges) {
      if (e.source !== nodeId) neighborIds.add(e.source)
      if (e.target !== nodeId) neighborIds.add(e.target)
    }
    const nodes = graph.nodes.filter((n) => neighborIds.has(n.id))
    return { nodes, edges }
  }

  getGhosts(): readonly GhostEntry[] {
    if (!this.vaultIndex) return []
    const graph = this.vaultIndex.getGraph()
    const artifacts = this.vaultIndex.getArtifacts()
    return buildGhostIndex(graph, artifacts)
  }
}
