/**
 * Tests for VaultQueryFacade: wraps VaultIndex + PathGuard + AuditLogger
 * to provide safe, audited read-only access to vault content.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VaultQueryFacade, MtimeConflictError, MissingIdError } from '../vault-query-facade'
import { PathGuard } from '../path-guard'
import { AuditLogger } from '../audit-logger'
import { PathGuardError } from '@shared/agent-types'
import { SearchEngine } from '@shared/engine/search-engine'
import { VaultIndex } from '@shared/engine/indexer'
import type { DocumentManager } from '../document-manager'

function createTestVault(): string {
  const base = join(tmpdir(), `vqf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(base, 'notes'), { recursive: true })
  writeFileSync(
    join(base, 'notes', 'hello.md'),
    '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\n---\n\n# Hello World\n'
  )
  return realpathSync(base)
}

describe('VaultQueryFacade', () => {
  let vaultRoot: string
  let facade: VaultQueryFacade

  beforeEach(() => {
    vaultRoot = createTestVault()
    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
    facade = new VaultQueryFacade(guard, logger, vaultRoot)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('readFile returns content for a valid vault path', async () => {
    const content = await facade.readFile(join(vaultRoot, 'notes', 'hello.md'))
    expect(content).toContain('# Hello World')
  })

  it('readFile rejects path outside vault', async () => {
    await expect(facade.readFile('/etc/passwd')).rejects.toThrow(PathGuardError)
  })

  it('search returns results matching query', () => {
    const searchEngine = new SearchEngine()
    searchEngine.upsert({
      id: 'hello',
      title: 'Hello',
      tags: [],
      body: 'Hello World',
      path: join(vaultRoot, 'notes', 'hello.md')
    })
    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
    const index = new VaultIndex()
    const searchFacade = new VaultQueryFacade(guard, logger, vaultRoot, {
      searchEngine,
      vaultIndex: index
    })

    const results = searchFacade.search('Hello')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Hello')
  })

  it('getNeighbors returns edges for a node', () => {
    const index = new VaultIndex()
    index.addFile(
      'hello.md',
      '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\nconnections:\n  - world\n---\n\nHello body\n'
    )
    index.addFile(
      'world.md',
      '---\nid: world\ntitle: World\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\n---\n\nWorld body\n'
    )
    const guard = new PathGuard(vaultRoot)
    const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
    const neighborFacade = new VaultQueryFacade(guard, logger, vaultRoot, {
      vaultIndex: index
    })

    const result = neighborFacade.getNeighbors('hello')
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toEqual(
      expect.objectContaining({ source: 'hello', target: 'world', kind: 'connection' })
    )
    expect(result.nodes.map((n) => n.id)).toContain('world')
  })

  it('readFile logs an audit entry on success', async () => {
    const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
    const logSpy = vi.spyOn(logger, 'log')
    const guard = new PathGuard(vaultRoot)
    const spiedFacade = new VaultQueryFacade(guard, logger, vaultRoot)

    await spiedFacade.readFile(join(vaultRoot, 'notes', 'hello.md'))

    expect(logSpy).toHaveBeenCalledOnce()
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'vault.read_file',
        decision: 'allowed'
      })
    )
  })

  describe('writeFile', () => {
    it('writes content and stamps modified_by in frontmatter', async () => {
      const filePath = join(vaultRoot, 'notes', 'hello.md')
      const newContent =
        '---\nid: hello\ntitle: Hello Updated\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\n---\n\n# Hello Updated\n'

      await facade.writeFile(filePath, newContent, { agentId: 'test-agent' })

      const written = readFileSync(filePath, 'utf-8')
      expect(written).toContain('modified_by: test-agent')
      expect(written).toContain('modified_at:')
      expect(written).toContain('# Hello Updated')
    })

    it('rejects path outside vault', async () => {
      await expect(
        facade.writeFile('/etc/passwd', 'hacked', { agentId: 'bad-agent' })
      ).rejects.toThrow(PathGuardError)
    })

    it('rejects when mtime does not match (optimistic lock)', async () => {
      const filePath = join(vaultRoot, 'notes', 'hello.md')
      const content = '---\nid: hello\ntitle: Hello\ntype: note\n---\n\n# Hello\n'

      await expect(
        facade.writeFile(filePath, content, {
          agentId: 'test-agent',
          expectedMtime: '1999-01-01T00:00:00.000Z'
        })
      ).rejects.toThrow(MtimeConflictError)
    })

    it('logs an audit entry on successful write', async () => {
      const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
      const logSpy = vi.spyOn(logger, 'log')
      const guard = new PathGuard(vaultRoot)
      const spiedFacade = new VaultQueryFacade(guard, logger, vaultRoot)

      const filePath = join(vaultRoot, 'notes', 'hello.md')
      const content = '---\nid: hello\ntitle: Hello\ntype: note\n---\n\n# Hello\n'

      await spiedFacade.writeFile(filePath, content, { agentId: 'test-agent' })

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'vault.write_file',
          decision: 'allowed'
        })
      )
    })

    it('calls registerExternalWrite before writing to disk', async () => {
      const mockDocManager = {
        registerExternalWrite: vi.fn()
      } as unknown as DocumentManager

      const guard = new PathGuard(vaultRoot)
      const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
      const facadeWithDm = new VaultQueryFacade(guard, logger, vaultRoot, {
        documentManager: mockDocManager
      })

      const filePath = join(vaultRoot, 'notes', 'hello.md')
      const content = '---\nid: hello\ntitle: Hello\ntype: note\n---\n\n# Hello\n'

      await facadeWithDm.writeFile(filePath, content, { agentId: 'test-agent' })

      expect(mockDocManager.registerExternalWrite).toHaveBeenCalledOnce()
      // Should be called with the resolved absolute path
      expect(mockDocManager.registerExternalWrite).toHaveBeenCalledWith(
        join(vaultRoot, 'notes', 'hello.md')
      )
    })
  })

  describe('getGhosts', () => {
    it('returns empty array when no vaultIndex', () => {
      // Default facade has no vaultIndex
      const ghosts = facade.getGhosts()
      expect(ghosts).toEqual([])
    })

    it('returns ghost entries from buildGhostIndex when vault has ghosts', () => {
      const index = new VaultIndex()
      // hello.md references "phantom" via wikilink, but phantom has no file
      index.addFile(
        'hello.md',
        '---\nid: hello\ntitle: Hello\ntype: note\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\n---\n\nSee [[phantom]] for more ideas.\n'
      )
      const guard = new PathGuard(vaultRoot)
      const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
      const ghostFacade = new VaultQueryFacade(guard, logger, vaultRoot, {
        vaultIndex: index
      })

      const ghosts = ghostFacade.getGhosts()
      expect(ghosts).toHaveLength(1)
      expect(ghosts[0].id).toBe('phantom')
      expect(ghosts[0].referenceCount).toBeGreaterThan(0)
      expect(ghosts[0].references.length).toBeGreaterThan(0)
    })
  })

  describe('createFile', () => {
    it('creates a new file and stamps created_by in frontmatter', async () => {
      const filePath = join(vaultRoot, 'notes', 'new-note.md')
      const content = '---\nid: new-note\ntitle: New Note\ntype: note\n---\n\n# New Note\n'

      await facade.createFile(filePath, content, { agentId: 'test-agent' })

      const written = readFileSync(filePath, 'utf-8')
      expect(written).toContain('created_by: test-agent')
      expect(written).toContain('created_at:')
      expect(written).toContain('id: new-note')
      expect(written).toContain('# New Note')
    })

    it('rejects if frontmatter has no id: field', async () => {
      const filePath = join(vaultRoot, 'notes', 'no-id.md')
      const content = '---\ntitle: No ID\ntype: note\n---\n\n# No ID\n'

      await expect(facade.createFile(filePath, content, { agentId: 'test-agent' })).rejects.toThrow(
        MissingIdError
      )
    })

    it('calls registerExternalWrite before creating file on disk', async () => {
      const mockDocManager = {
        registerExternalWrite: vi.fn()
      } as unknown as DocumentManager

      const guard = new PathGuard(vaultRoot)
      const logger = new AuditLogger(join(vaultRoot, '.te', 'audit'))
      const facadeWithDm = new VaultQueryFacade(guard, logger, vaultRoot, {
        documentManager: mockDocManager
      })

      const filePath = join(vaultRoot, 'notes', 'created-note.md')
      const content =
        '---\nid: created-note\ntitle: Created Note\ntype: note\n---\n\n# Created Note\n'

      await facadeWithDm.createFile(filePath, content, { agentId: 'test-agent' })

      expect(mockDocManager.registerExternalWrite).toHaveBeenCalledOnce()
      expect(mockDocManager.registerExternalWrite).toHaveBeenCalledWith(
        join(vaultRoot, 'notes', 'created-note.md')
      )
    })
  })
})
