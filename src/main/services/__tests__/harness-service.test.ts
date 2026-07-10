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
import { buildHarnessDraft } from '../../../shared/harness-draft'
import { HARNESS_TEMPLATES } from '../../../shared/harness-templates'
import { HARNESS_PROTECTED_GLOBS, type HarnessCreateRequest } from '../../../shared/harness-types'
import { hasLintErrors } from '../../../shared/harness-lint'

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
const createTestHarness = (workspaceRoot = root, slug = 'test-fixer') =>
  createHarness(workspaceRoot, { template: 'test-fixer', slug })

describe('createHarness', () => {
  it('materializes all six entries under <root>/.machina/agents/<slug>/', async () => {
    const result = await createTestHarness()
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
    await createTestHarness()
    const verifyPath = path.join(harnessDir(), 'verify.sh')
    const stat = await fs.stat(verifyPath)
    expect(stat.mode & 0o777).toBe(0o555)
    const content = await fs.readFile(verifyPath, 'utf8')
    expect(content.startsWith('#!/bin/sh\n')).toBe(true)
    expect(content).toContain('npm test')
  })

  it('writes a scope.json whose forbiddenGlobs superset the protected globs and whose allowedGlobs are materialized', async () => {
    await createTestHarness()
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

  it('writes byte-identical files to the shared renderer-preview materialization', async () => {
    const request: HarnessCreateRequest = {
      template: 'test-fixer',
      slug: 'preview-equal',
      overrides: {
        description: 'A preview-equality harness.',
        budgets: { maxTurns: 3, maxWritesPerMinute: 4 }
      }
    }
    const preview = buildHarnessDraft(request, '.machina/agents/preview-equal')
    expect(preview.ok).toBe(true)
    const result = await createHarness(root, request)
    expect(result.ok).toBe(true)
    if (!preview.ok || !result.ok) return

    expect(await fs.readFile(path.join(result.root, 'SKILL.md'), 'utf8')).toBe(
      preview.files.skillMd
    )
    expect(await fs.readFile(path.join(result.root, 'rules.md'), 'utf8')).toBe(
      preview.files.rulesMd
    )
    expect(await fs.readFile(path.join(result.root, 'scope.json'), 'utf8')).toBe(
      preview.files.scopeJson
    )
    expect(await fs.readFile(path.join(result.root, 'state.md'), 'utf8')).toBe(
      preview.files.stateMd
    )
    expect(await fs.readFile(path.join(result.root, 'verify.sh'), 'utf8')).toBe(
      preview.files.verifySh
    )
  })

  it('creates a complete blank harness through the same six-entry path', async () => {
    const result = await createHarness(root, {
      slug: 'blank-agent',
      overrides: {
        description: 'One complete blank harness.',
        adapter: 'codex',
        budgets: { maxTurns: 5, maxWritesPerMinute: 7 },
        skillBody: 'Perform one focused task, verify it, and stop.',
        rules: '- [critical] Stay inside the configured scope.',
        scope: {
          goal: 'Make one focused change.',
          allowedGlobs: ['src/**', '<dir>/state.md', '<dir>/handoffs/**'],
          forbiddenGlobs: ['.git/**'],
          acceptance: 'The test suite passes.',
          rollback: 'Reject the pending change.'
        },
        verifyCommand: 'npm test'
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await fs.readdir(result.root)).sort()).toEqual([
      'SKILL.md',
      'handoffs',
      'rules.md',
      'scope.json',
      'state.md',
      'verify.sh'
    ])
    expect((await fs.stat(path.join(result.root, 'verify.sh'))).mode & 0o777).toBe(0o555)
  })

  it('never overwrites: a duplicate create is a structured error and the original files are untouched', async () => {
    await createTestHarness()
    const statePath = path.join(harnessDir(), 'state.md')
    await fs.chmod(statePath, 0o644)
    await fs.writeFile(statePath, 'precious run history', 'utf8')

    const second = await createTestHarness()
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('already exists')
    expect(await fs.readFile(statePath, 'utf8')).toBe('precious run history')
  })

  it('rejects an invalid slug with no directory created', async () => {
    const result = await createHarness(root, { template: 'test-fixer', slug: '../evil' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid harness slug')
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('rejects an adapter-identity-colliding slug with no directory created', async () => {
    // 'cli-claude' trailers would be indistinguishable from the adapter
    // fallback every ad-hoc/degraded turn gets — reserved (v1.2.2).
    const result = await createHarness(root, { template: 'test-fixer', slug: 'cli-claude' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('reserved')
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('rejects an unknown template with no directory created', async () => {
    const result = await createHarness(root, {
      template: 'nonexistent-template',
      slug: 'test-fixer'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unknown harness template')
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('template-only refuses a bad scope with zero writes; overrides:{} repairs it', async () => {
    const template = HARNESS_TEMPLATES['test-fixer']
    const forbidden = template.scope.forbiddenGlobs as string[]
    const removedIndex = forbidden.indexOf(HARNESS_PROTECTED_GLOBS[0])
    const [removed] = forbidden.splice(removedIndex, 1)
    try {
      const result = await createHarness(root, { template: 'test-fixer', slug: 'mutated' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('missing protected forbiddenGlobs')
      await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()

      const repaired = await createHarness(root, {
        template: 'test-fixer',
        slug: 'repaired',
        overrides: {}
      })
      expect(repaired.ok).toBe(true)
      if (repaired.ok) {
        const scope = JSON.parse(await fs.readFile(path.join(repaired.root, 'scope.json'), 'utf8'))
        for (const glob of HARNESS_PROTECTED_GLOBS) expect(scope.forbiddenGlobs).toContain(glob)
      }
    } finally {
      forbidden.splice(removedIndex, 0, removed)
    }
  })

  it('rejects incomplete, multiline, raw-misconfigured, and forged requests before mkdir', async () => {
    const requests = [
      { slug: 'incomplete', overrides: { adapter: 'codex' } },
      {
        template: 'test-fixer',
        slug: 'multiline',
        overrides: { description: 'safe\nadapter: raw' }
      },
      { template: 'raw-tool-runner', slug: 'raw-tool-runner', overrides: {} },
      { template: 'test-fixer', slug: 'forged-top', workspaceRoot: '/outside' },
      {
        template: 'test-fixer',
        slug: 'forged-override',
        overrides: { permissionMode: 'accept-edits' }
      }
    ] as unknown as HarnessCreateRequest[]

    for (const request of requests) {
      const result = await createHarness(root, request)
      expect(result.ok, request.slug).toBe(false)
    }
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('rejects a Ctrl-U raw invocation before creating the agents directory', async () => {
    const result = await createHarness(root, {
      template: 'raw-tool-runner',
      slug: 'raw-controlled',
      overrides: {
        invocationTemplate: 'my-agent \x15{prompt}',
        scope: {
          goal: 'Run one configured raw task.',
          allowedGlobs: ['src/**'],
          forbiddenGlobs: [],
          acceptance: 'The configured verifier exits 0.',
          rollback: 'Reject the pending change.'
        },
        verifyCommand: 'npm test'
      }
    })

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Ctrl-U') })
    await expect(fs.stat(path.join(root, '.machina', 'agents'))).rejects.toThrow()
  })

  it('refuses a symlinked <TE_DIR>: nothing written at the target, empty slug dir cleaned up non-recursively', async () => {
    const outside = await makeOutsideDir()
    await fs.symlink(outside, path.join(root, '.machina'))

    const result = await createTestHarness()
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

    const result = await createTestHarness()
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

    const live = await createTestHarness()
    expect(live.ok).toBe(false)
    if (!live.ok) expect(live.error).toContain('already exists')
    expect(await fs.readdir(outside)).toEqual([])

    const dangling = await createTestHarness(root, 'dangling')
    expect(dangling.ok).toBe(false)
    if (!dangling.ok) expect(dangling.error).toContain('already exists')
  })

  it('cleans up the partial directory when a write mid-create fails', async () => {
    const spy = vi.spyOn(fs, 'writeFile').mockImplementation(async (target) => {
      if (String(target).endsWith('scope.json')) throw new Error('disk full')
    })
    const result = await createTestHarness()
    spy.mockRestore()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('harness create failed')
    await expect(fs.stat(harnessDir())).rejects.toThrow()
    // And the slot is reusable afterwards — no bricked half-harness.
    expect((await createTestHarness()).ok).toBe(true)
  })
})

describe('listHarnesses', () => {
  it('returns [] when no agents directory exists', async () => {
    expect(await listHarnesses(root)).toEqual([])
  })

  it('round-trips a created harness with zero diagnostics', async () => {
    await createTestHarness()
    const draft = buildHarnessDraft(
      { template: 'test-fixer', slug: 'test-fixer' },
      '.machina/agents/test-fixer'
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) throw new Error(draft.error)
    const list = await listHarnesses(root)
    expect(list).toEqual([
      {
        slug: 'test-fixer',
        name: 'test-fixer',
        description: 'Runs the test suite, fixes the first failure, stops.',
        adapter: 'claude',
        diagnostics: [],
        // Step 6 (v1.2.6): summaries carry the frontmatter budgets - what
        // the next run would snapshot at bind.
        budgets: { maxTurns: 10, maxWritesPerMinute: 10 },
        scope: draft.draft.scope
      }
    ])
  })

  it('round-trips configured raw frontmatter without hiding the harness', async () => {
    const created = await createHarness(root, {
      template: 'raw-tool-runner',
      slug: 'raw-tool-runner',
      overrides: {
        invocationTemplate: "my-agent '--prompt' {prompt}",
        scope: {
          goal: 'Run one configured raw task.',
          allowedGlobs: ['src/**', '<dir>/state.md', '<dir>/handoffs/**'],
          forbiddenGlobs: ['.git/**'],
          acceptance: 'The configured verifier exits 0.',
          rollback: 'Reject the pending change.'
        },
        verifyCommand: 'npm test'
      }
    })
    expect(created.ok).toBe(true)

    const [summary] = await listHarnesses(root)
    expect(summary).toMatchObject({
      slug: 'raw-tool-runner',
      adapter: 'raw',
      diagnostics: [],
      scope: {
        goal: 'Run one configured raw task.',
        allowedGlobs: [
          'src/**',
          '.machina/agents/raw-tool-runner/state.md',
          '.machina/agents/raw-tool-runner/handoffs/**'
        ]
      }
    })
  })

  it('surfaces a symlinked agents dir as error diagnostics on every entry (v1.2.4 — was a silent [])', async () => {
    const otherWorkspace = await makeOutsideDir()
    await createTestHarness(otherWorkspace)
    await fs.mkdir(path.join(root, '.machina'))
    await fs.symlink(
      path.join(otherWorkspace, '.machina', 'agents'),
      path.join(root, '.machina', 'agents')
    )

    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toEqual(['test-fixer'])
    // Listed with ONLY the ancestry error — no content read through the
    // symlink: adapter is null (frontmatter never parsed) and no content lints
    // ran, so the leak surface is closed.
    expect(list[0].diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'symlink-ancestry' })
    ])
    expect(list[0].adapter).toBeNull()
  })

  it('surfaces a symlinked slug dir with an ancestry error and reads no content behind it', async () => {
    // Behind the symlink sits a valid harness whose frontmatter name differs
    // from the link name — if inspectHarness read it, the palette would show
    // "other-name". It must not: name falls back to the slug.
    const otherWorkspace = await makeOutsideDir()
    await createTestHarness(otherWorkspace, 'other-name')
    await fs.mkdir(path.join(root, '.machina', 'agents'), { recursive: true })
    await fs.symlink(
      path.join(otherWorkspace, '.machina', 'agents', 'other-name'),
      path.join(root, '.machina', 'agents', 'test-fixer')
    )

    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toEqual(['test-fixer'])
    expect(list[0].diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'symlink-ancestry' })
    ])
    expect(list[0].name).toBe('test-fixer') // slug fallback, not the behind-name
    expect(list[0].adapter).toBeNull()
  })

  it('surfaces malformed harnesses with skip-reason diagnostics; non-harness entries stay skipped', async () => {
    await createTestHarness()
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
    await createTestHarness()
    expect(await lintHarnessOnDisk(root, 'test-fixer')).toEqual([])
  })

  it('EXIT BAR: hand-editing scope.json to strip the protected globs ⇒ error diagnostic', async () => {
    await createTestHarness()
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
    expect(list[0].scope).toBeUndefined()
  })

  it('verify.sh mode drift (chmod 755) ⇒ warning diagnostic naming the drifted mode', async () => {
    await createTestHarness()
    await fs.chmod(path.join(harnessDir(), 'verify.sh'), 0o755)

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    const finding = diags.find((d) => d.code === 'verify-mode')
    expect(finding).toMatchObject({ severity: 'warning', file: 'verify.sh' })
    expect(finding!.message).toContain('0o755')
  })

  it('verify.sh setuid drift (chmod 0o4555) ⇒ warning — the mask sees the high bits', async () => {
    await createTestHarness()
    await fs.chmod(path.join(harnessDir(), 'verify.sh'), 0o4555)

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    const finding = diags.find((d) => d.code === 'verify-mode')
    // Some macOS test workers clear setuid asynchronously on temp files. If
    // the bit was normalized before inspection there is no drift left to
    // report; otherwise the full 0o7777 mask must preserve it in the finding.
    if (finding === undefined) {
      expect((await fs.stat(path.join(harnessDir(), 'verify.sh'))).mode & 0o7777).toBe(0o555)
      return
    }
    expect(finding).toMatchObject({ severity: 'warning', file: 'verify.sh' })
    expect(finding.message).toContain('0o4555')
  })

  it('missing verify.sh ⇒ error diagnostic', async () => {
    await createTestHarness()
    await fs.rm(path.join(harnessDir(), 'verify.sh'), { force: true })

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    expect(diags).toEqual([
      expect.objectContaining({ severity: 'error', code: 'file-missing', file: 'verify.sh' })
    ])
  })

  it('a required leaf replaced by a directory is rejected as non-regular', async () => {
    await createTestHarness()
    const statePath = path.join(harnessDir(), 'state.md')
    await fs.rm(statePath)
    await fs.mkdir(statePath)

    const diags = await lintHarnessOnDisk(root, 'test-fixer')

    expect(diags).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'file-missing',
        file: 'state.md',
        message: expect.stringContaining('not a regular file')
      })
    )
  })

  it('missing handoffs/ ⇒ warning diagnostic', async () => {
    await createTestHarness()
    await fs.rmdir(path.join(harnessDir(), 'handoffs'))

    const diags = await lintHarnessOnDisk(root, 'test-fixer')
    expect(diags).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'file-missing', file: 'handoffs/' })
    ])
  })

  it('a symlinked handoffs/ directory is an ancestry error, not a missing-dir warning', async () => {
    await createTestHarness()
    const outside = await makeOutsideDir()
    await fs.rmdir(path.join(harnessDir(), 'handoffs'))
    await fs.symlink(outside, path.join(harnessDir(), 'handoffs'))

    const diags = await lintHarnessOnDisk(root, 'test-fixer')

    expect(diags).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'symlink-ancestry',
        file: 'handoffs/'
      })
    )
  })

  it('a hand-created adapter-identity dir (cli-claude) ⇒ reserved-slug error ⇒ run disabled', async () => {
    // createHarness refuses the reserved slug, so simulate a hand-placed one by
    // copying an otherwise-valid harness onto the reserved path.
    await createTestHarness()
    const reservedDir = path.join(root, '.machina', 'agents', 'cli-claude')
    await fs.cp(harnessDir(), reservedDir, { recursive: true })

    const diags = await lintHarnessOnDisk(root, 'cli-claude')
    expect(diags).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'reserved-slug', file: '.' })
    )
    // The run-disable predicate is now true — the palette greys it instead of
    // rendering it enabled and refusing at run time.
    expect(hasLintErrors(diags)).toBe(true)

    // And it is LISTED (greyed-with-reason), not skipped.
    const list = await listHarnesses(root)
    expect(list.map((h) => h.slug)).toContain('cli-claude')
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
