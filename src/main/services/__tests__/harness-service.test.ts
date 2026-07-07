// @vitest-environment node
/**
 * Harness generator/lister integration tests (workstation step 6). Real
 * filesystem in a temp dir; TE_DIR resolves to `.machina` under vitest.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHarness, lintHarnessOnDisk, listHarnesses } from '../harness-service'
import { HARNESS_TEMPLATES } from '../../../shared/harness-templates'
import { HARNESS_PROTECTED_GLOBS } from '../../../shared/harness-types'

let root: string
let extraDirs: string[]

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-service-'))
  extraDirs = []
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  for (const dir of extraDirs) {
    await fs.rm(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

const makeOutsideDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-outside-'))
  extraDirs.push(dir)
  return dir
}

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

  it('rejects an adapter-identity-colliding slug with no directory created', async () => {
    // 'cli-claude' trailers would be indistinguishable from the adapter
    // fallback every ad-hoc/degraded turn gets — reserved (v1.2.2).
    const result = await createHarness(root, 'test-fixer', 'cli-claude')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('reserved')
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

  it('refuses a symlinked <TE_DIR>: nothing written at the target, empty slug dir cleaned up non-recursively', async () => {
    const outside = await makeOutsideDir()
    await fs.symlink(outside, path.join(root, '.machina'))

    const result = await createHarness(root, 'test-fixer', 'test-fixer')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('escapes its contract location')
    // No harness content at the redirect target.
    await expect(fs.stat(path.join(outside, 'agents', 'test-fixer'))).rejects.toThrow()
    // Cleanup was non-recursive: the agents dir the recursive mkdir made at
    // the target survives — we never delete through the symlink.
    expect((await fs.stat(path.join(outside, 'agents'))).isDirectory()).toBe(true)
  })

  it('refuses a symlinked agents dir: nothing written at the target, empty slug dir cleaned up', async () => {
    const outside = await makeOutsideDir()
    await fs.mkdir(path.join(root, '.machina'))
    await fs.symlink(outside, path.join(root, '.machina', 'agents'))

    const result = await createHarness(root, 'test-fixer', 'test-fixer')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('escapes its contract location')
    await expect(fs.stat(path.join(outside, 'test-fixer'))).rejects.toThrow()
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('refuses a pre-existing symlink at the slug path (live and dangling) via the no-overwrite branch, target untouched', async () => {
    const outside = await makeOutsideDir()
    await fs.mkdir(path.join(root, '.machina', 'agents'), { recursive: true })
    await fs.symlink(outside, path.join(root, '.machina', 'agents', 'test-fixer'))
    await fs.symlink(
      path.join(root, 'does-not-exist'),
      path.join(root, '.machina', 'agents', 'dangling')
    )

    const live = await createHarness(root, 'test-fixer', 'test-fixer')
    expect(live.ok).toBe(false)
    if (!live.ok) expect(live.error).toContain('already exists')
    expect(await fs.readdir(outside)).toEqual([])

    const dangling = await createHarness(root, 'test-fixer', 'dangling')
    expect(dangling.ok).toBe(false)
    if (!dangling.ok) expect(dangling.error).toContain('already exists')
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

  it('round-trips a created harness with zero diagnostics', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const list = await listHarnesses(root)
    expect(list).toEqual([
      {
        slug: 'test-fixer',
        name: 'test-fixer',
        description: 'Runs the test suite, fixes the first failure, stops.',
        adapter: 'claude',
        diagnostics: []
      }
    ])
  })

  it('surfaces a symlinked agents dir as error diagnostics on every entry (v1.2.4 — was a silent [])', async () => {
    const otherWorkspace = await makeOutsideDir()
    await createHarness(otherWorkspace, 'test-fixer', 'test-fixer')
    await fs.mkdir(path.join(root, '.machina'))
    await fs.symlink(
      path.join(otherWorkspace, '.machina', 'agents'),
      path.join(root, '.machina', 'agents')
    )

    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toEqual(['test-fixer'])
    expect(list[0].diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'symlink-ancestry' })
    )
  })

  it('surfaces a symlinked slug dir with an ancestry error (used to vanish)', async () => {
    const otherWorkspace = await makeOutsideDir()
    await createHarness(otherWorkspace, 'test-fixer', 'test-fixer')
    await fs.mkdir(path.join(root, '.machina', 'agents'), { recursive: true })
    await fs.symlink(
      path.join(otherWorkspace, '.machina', 'agents', 'test-fixer'),
      path.join(root, '.machina', 'agents', 'test-fixer')
    )

    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toEqual(['test-fixer'])
    expect(list[0].diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'symlink-ancestry' })
    )
  })

  it('surfaces malformed harnesses with skip-reason diagnostics; non-harness entries stay skipped', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const agents = path.join(root, '.machina', 'agents')
    // Garbage SKILL.md → listed with a frontmatter-invalid error (the reason
    // it used to be skipped, surfaced).
    await fs.mkdir(path.join(agents, 'broken'))
    await fs.writeFile(path.join(agents, 'broken', 'SKILL.md'), 'not frontmatter', 'utf8')
    // Directory without any harness files → listed with file-missing errors.
    await fs.mkdir(path.join(agents, 'empty'))
    // Stray file and invalid-slug dir → still skipped (not addressable as harnesses).
    await fs.writeFile(path.join(agents, 'stray.txt'), 'x', 'utf8')
    await fs.mkdir(path.join(agents, 'Bad.Slug'))

    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toEqual(['broken', 'empty', 'test-fixer'])

    const broken = list.find((h) => h.slug === 'broken')!
    expect(broken.adapter).toBeNull()
    expect(broken.name).toBe('broken') // falls back to the slug
    expect(broken.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'frontmatter-invalid',
        file: 'SKILL.md'
      })
    )

    const empty = list.find((h) => h.slug === 'empty')!
    expect(empty.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'file-missing', file: 'SKILL.md' })
    )
    expect(empty.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'file-missing', file: 'verify.sh' })
    )
  })
})

describe('lintHarnessOnDisk (fs lints composed with the shared content lints)', () => {
  it('a freshly-created harness lints clean', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    expect(await lintHarnessOnDisk(root, 'test-fixer')).toEqual([])
  })

  it('EXIT BAR: hand-editing scope.json to strip the protected globs ⇒ error diagnostic', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    const scopePath = path.join(harnessDir(), 'scope.json')
    const scope = JSON.parse(await fs.readFile(scopePath, 'utf8'))
    scope.forbiddenGlobs = scope.forbiddenGlobs.filter(
      (g: string) => !(HARNESS_PROTECTED_GLOBS as readonly string[]).includes(g)
    )
    await fs.writeFile(scopePath, JSON.stringify(scope, null, 2), 'utf8')

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    expect(diags).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'scope-protected-globs',
        file: 'scope.json'
      })
    )
    // And the list carries the same finding — the palette greys off it.
    const list = await listHarnesses(root)
    expect(list[0].diagnostics).toEqual(diags)
  })

  it('verify.sh mode drift (chmod 755) ⇒ warning diagnostic naming the drifted mode', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    await fs.chmod(path.join(harnessDir(), 'verify.sh'), 0o755)

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    const finding = diags.find((d) => d.code === 'verify-mode')
    expect(finding).toMatchObject({ severity: 'warning', file: 'verify.sh' })
    expect(finding!.message).toContain('0o755')
  })

  it('missing verify.sh ⇒ error diagnostic', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    await fs.rm(path.join(harnessDir(), 'verify.sh'), { force: true })

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    expect(diags).toEqual([
      expect.objectContaining({ severity: 'error', code: 'file-missing', file: 'verify.sh' })
    ])
  })

  it('missing handoffs/ ⇒ warning diagnostic', async () => {
    await createHarness(root, 'test-fixer', 'test-fixer')
    await fs.rmdir(path.join(harnessDir(), 'handoffs'))

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    expect(diags).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'file-missing', file: 'handoffs/' })
    ])
  })

  it('nonexistent harness ⇒ file-missing error; invalid slug ⇒ invalid-slug error', async () => {
    expect(await lintHarnessOnDisk(root, 'no-such-harness')).toEqual([
      expect.objectContaining({ severity: 'error', code: 'file-missing', file: '.' })
    ])
    expect(await lintHarnessOnDisk(root, '../evil')).toEqual([
      expect.objectContaining({ severity: 'error', code: 'invalid-slug' })
    ])
  })
})
