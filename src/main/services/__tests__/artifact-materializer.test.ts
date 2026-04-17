// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ArtifactMaterializer } from '../artifact-materializer'
import type { CompiledArticleDraft } from '@shared/agent-artifact-types'

function createTestVault(): string {
  const base = join(tmpdir(), `te-mat-test-${Date.now()}-${randomUUID().slice(0, 8)}`)
  mkdirSync(base, { recursive: true })
  return base
}

function makeDraft(overrides: Partial<CompiledArticleDraft> = {}): CompiledArticleDraft {
  return {
    kind: 'compiled-article',
    title: 'Test Article',
    body: 'Some compiled content.',
    origin: 'agent',
    sources: ['Source Note A', 'Source Note B'],
    ...overrides
  }
}

describe('ArtifactMaterializer', () => {
  let vaultRoot: string
  let registerExternalWrite: ReturnType<typeof vi.fn<(path: string) => void>>
  let materializer: ArtifactMaterializer

  beforeEach(() => {
    vaultRoot = createTestVault()
    registerExternalWrite = vi.fn()
    materializer = new ArtifactMaterializer({ registerExternalWrite })
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  describe('materialize', () => {
    it('writes a .md file with correct frontmatter', async () => {
      const draft = makeDraft()
      const result = await materializer.materialize(draft, vaultRoot, 'compiled/')

      expect(result.vaultRelativePath).toMatch(/^compiled\/test-article\.md$/)
      const content = readFileSync(result.absolutePath, 'utf-8')
      expect(content).toContain('title: Test Article')
      expect(content).toContain('origin: agent')
      expect(content).toContain('sources:')
      expect(content).toContain('Some compiled content.')
    })

    it('creates the output directory if it does not exist', async () => {
      const draft = makeDraft()
      await materializer.materialize(draft, vaultRoot, 'compiled/')
      expect(existsSync(join(vaultRoot, 'compiled'))).toBe(true)
    })

    it('registers external write to suppress chokidar echo', async () => {
      const draft = makeDraft()
      const result = await materializer.materialize(draft, vaultRoot, 'compiled/')
      expect(registerExternalWrite).toHaveBeenCalledWith(result.absolutePath)
    })

    it('appends -1, -2 suffix on filename collision', async () => {
      const draft = makeDraft()
      const r1 = await materializer.materialize(draft, vaultRoot, 'compiled/')
      const r2 = await materializer.materialize(draft, vaultRoot, 'compiled/')
      const r3 = await materializer.materialize(draft, vaultRoot, 'compiled/')

      expect(r1.vaultRelativePath).toBe('compiled/test-article.md')
      expect(r2.vaultRelativePath).toBe('compiled/test-article-1.md')
      expect(r3.vaultRelativePath).toBe('compiled/test-article-2.md')
    })

    it('caps slug at 80 characters', async () => {
      const longTitle = 'A'.repeat(120)
      const draft = makeDraft({ title: longTitle })
      const result = await materializer.materialize(draft, vaultRoot, 'compiled/')
      const filename = result.vaultRelativePath.split('/').pop()!
      expect(filename.length).toBeLessThanOrEqual(80 + '.md'.length)
    })

    it('rejects invalid draft with Zod error', async () => {
      const bad = {
        kind: 'compiled-article',
        title: '',
        body: '',
        origin: 'agent',
        sources: []
      } as CompiledArticleDraft
      await expect(materializer.materialize(bad, vaultRoot, 'compiled/')).rejects.toThrow()
    })

    it('falls back to "artifact" slug when title has no alphanumeric chars', async () => {
      const draft = makeDraft({ title: '!!!' })
      const result = await materializer.materialize(draft, vaultRoot, 'compiled/')
      expect(result.vaultRelativePath).toBe('compiled/artifact.md')
    })

    it('writes to vault root when outputDir is empty string', async () => {
      const draft = makeDraft()
      const result = await materializer.materialize(draft, vaultRoot, '')
      expect(result.vaultRelativePath).toBe('test-article.md')
      expect(existsSync(result.absolutePath)).toBe(true)
    })
  })

  describe('rematerialize', () => {
    it('writes to the exact path provided, skipping collision logic', async () => {
      const draft = makeDraft()
      const targetPath = join(vaultRoot, 'compiled/original.md')
      mkdirSync(join(vaultRoot, 'compiled'), { recursive: true })

      const result = await materializer.rematerialize(draft, targetPath)
      expect(result.absolutePath).toBe(targetPath)
      expect(readFileSync(targetPath, 'utf-8')).toContain('Test Article')
    })
  })

  describe('unmaterialize', () => {
    it('deletes files that were materialized in this session', async () => {
      const draft = makeDraft()
      const result = await materializer.materialize(draft, vaultRoot, 'compiled/')
      expect(existsSync(result.absolutePath)).toBe(true)

      await materializer.unmaterialize([result.absolutePath])
      expect(existsSync(result.absolutePath)).toBe(false)
    })

    it('refuses to delete files not created by this session', async () => {
      const foreignPath = join(vaultRoot, 'foreign.md')
      writeFileSync(foreignPath, 'user content')

      await expect(materializer.unmaterialize([foreignPath])).rejects.toThrow(/session ownership/)
    })
  })

  describe('batch rollback', () => {
    it('deletes already-written files when a batch fails mid-way', async () => {
      const draft1 = makeDraft({ title: 'Good One' })
      const draft2 = makeDraft({ title: 'Bad One' })

      // Spy on the internal write: first call writes for real, second fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const writeSpy = vi.spyOn(materializer as any, '_atomicWrite')
      writeSpy
        .mockImplementationOnce(async (...args: unknown[]) => {
          const { writeFile: fsWriteFile } = await import('fs/promises')
          await fsWriteFile(args[0] as string, args[1] as string, 'utf-8')
        })
        .mockRejectedValueOnce(new Error('disk full'))

      await expect(
        materializer.materializeBatch([draft1, draft2], vaultRoot, 'compiled/')
      ).rejects.toThrow('disk full')

      // First file should have been rolled back
      const files = existsSync(join(vaultRoot, 'compiled'))
        ? readdirSync(join(vaultRoot, 'compiled'))
        : []
      expect(files).toHaveLength(0)
    })
  })
})
