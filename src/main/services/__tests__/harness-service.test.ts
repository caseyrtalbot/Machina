// @vitest-environment node
/**
 * Harness generator/lister integration tests (workstation step 6). Real
 * filesystem in a temp dir; TE_DIR resolves to `.machina` under vitest.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHarness, listHarnesses } from '../harness-service'
import { HARNESS_TEMPLATES } from '../../../shared/harness-templates'
import { HARNESS_PROTECTED_GLOBS } from '../../../shared/harness-types'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-service-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const harnessDir = (): string => path.join(root, '.machina', 'agents', 'test-fixer')

describe('createHarness', () => {
  it('materializes all six entries under <root>/.machina/agents/<slug>/', async () => {
    const result = await createHarness(root, 'test-fixer', 'test-fixer')
    expect(result).toEqual({ ok: true, root: harnessDir() })

    const entries = (await fs.readdir(harnessDir())).sort()
    expect(entries).toEqual([
      'SKILL.md',
      'handoffs',
      'rules.md',
      'scope.json',
      'state.md',
      'verify.sh'
    ])
    expect((await fs.stat(path.join(harnessDir(), 'handoffs'))).isDirectory()).toBe(true)
  })

  it('writes verify.sh with mode 0o555 and a #!/bin/sh shebang running npm test', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const verifyPath = path.join(harnessDir(), 'verify.sh')
    const stat = await fs.stat(verifyPath)
    expect(stat.mode & 0o777).toBe(0o555)
    const content = await fs.readFile(verifyPath, 'utf8')
    expect(content.startsWith('#!/bin/sh\n')).toBe(true)
    expect(content).toContain('npm test')
  })

  it('writes a scope.json whose forbiddenGlobs superset the protected globs and whose allowedGlobs are materialized', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const scope = JSON.parse(await fs.readFile(path.join(harnessDir(), 'scope.json'), 'utf8'))
    for (const glob of HARNESS_PROTECTED_GLOBS) {
      expect(scope.forbiddenGlobs).toContain(glob)
    }
    expect(scope.forbiddenGlobs).toContain('.git/**')
    expect(scope.forbiddenGlobs).toContain('.env*')
    expect(scope.allowedGlobs).toContain('.machina/agents/test-fixer/state.md')
    expect(scope.allowedGlobs).toContain('.machina/agents/test-fixer/handoffs/**')
    expect(scope.allowedGlobs).not.toContain('<dir>/state.md')
  })

  it('never overwrites: a duplicate create is a structured error and the original files are untouched', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const statePath = path.join(harnessDir(), 'state.md')
    await fs.chmod(statePath, 0o644)
    await fs.writeFile(statePath, 'precious run history', 'utf8')

    const second = await createHarness(root, 'test-fixer', 'test-fixer')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('already exists')
    expect(await fs.readFile(statePath, 'utf8')).toBe('precious run history')
  })

  it('rejects an invalid slug with no directory created', async () => {
    const result = await createHarness(root, 'test-fixer', '../evil')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid harness slug')
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('rejects an unknown template with no directory created', async () => {
    const result = await createHarness(root, 'nonexistent-template', 'test-fixer')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unknown harness template')
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('refuses to emit when the template scope lacks a protected glob (mutated template), no dir created', async () => {
    const template = HARNESS_TEMPLATES['test-fixer']
    const templates = HARNESS_TEMPLATES as Record<string, (typeof HARNESS_TEMPLATES)[string]>
    templates['mutated'] = {
      ...template,
      scope: {
        ...template.scope,
        forbiddenGlobs: template.scope.forbiddenGlobs.filter((g) => !g.includes('verify.sh'))
      }
    }
    try {
      const result = await createHarness(root, 'mutated', 'mutated')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('missing protected forbiddenGlobs')
      await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
    } finally {
      delete templates['mutated']
    }
  })

  it('cleans up the partial directory when a write mid-create fails', async () => {
    const spy = vi.spyOn(fs, 'writeFile').mockImplementation(async (target) => {
      if (String(target).endsWith('scope.json')) throw new Error('disk full')
    })
    const result = await createHarness(root, 'test-fixer', 'test-fixer')
    spy.mockRestore()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('harness create failed')
    await expect(fs.stat(harnessDir())).rejects.toThrow()
    // And the slot is reusable afterwards — no bricked half-harness.
    expect((await createHarness(root, 'test-fixer', 'test-fixer')).ok).toBe(true)
  })
})

describe('listHarnesses', () => {
  it('returns [] when no agents directory exists', async () => {
    expect(await listHarnesses(root)).toEqual([])
  })

  it('round-trips a created harness', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const list = await listHarnesses(root)
    expect(list).toEqual([
      {
        slug: 'test-fixer',
        name: 'test-fixer',
        description: 'Runs the test suite, fixes the first failure, stops.',
        adapter: 'claude'
      }
    ])
  })

  it('skips malformed entries instead of throwing', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const agents = path.join(root, '.machina', 'agents')
    // Garbage SKILL.md → skipped.
    await fs.mkdir(path.join(agents, 'broken'))
    await fs.writeFile(path.join(agents, 'broken', 'SKILL.md'), 'not frontmatter', 'utf8')
    // Directory without SKILL.md → skipped.
    await fs.mkdir(path.join(agents, 'empty'))
    // Stray file and invalid-slug dir → skipped.
    await fs.writeFile(path.join(agents, 'stray.txt'), 'x', 'utf8')
    await fs.mkdir(path.join(agents, 'Bad.Slug'))

    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toEqual(['test-fixer'])
  })
})
