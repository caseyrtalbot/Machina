// @vitest-environment node
/**
 * Main-side harness-run composition tests (workstation step 3, contracts §4
 * v1.2.2). Real filesystem fixtures; the binding registry is injected so the
 * record-last ordering and refusal paths are observable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TE_DIR } from '@shared/constants'
import { buildHarnessPrompt, HARNESS_PROTECTED_GLOBS } from '@shared/harness-types'
import { composeHarnessRun } from '../harness-run'
import { createHarness } from '../harness-service'

// harness-run defaults to the singleton registry, whose module imports
// electron; every test here injects its own registry.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' } }))

const SLUG = 'test-fixer'
const FIXTURE = {
  'SKILL.md': '---\nname: test-fixer\n---\nFix the failing test.\n',
  'rules.md': 'Never touch verify.sh.\n',
  'scope.json': '{ "allowedGlobs": ["src/**"] }\n',
  'state.md': 'No runs yet.\n'
} as const

let root: string
let extraDirs: string[]

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-run-'))
  extraDirs = []
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  for (const d of extraDirs) {
    await fs.rm(d, { recursive: true, force: true })
  }
})

async function writeFixture(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  for (const [file, content] of Object.entries(FIXTURE)) {
    await fs.writeFile(path.join(dir, file), content, 'utf8')
  }
}

type RecordResult = { ok: true } | { ok: false; error: string }

function makeRegistry(result: RecordResult = { ok: true }) {
  return { record: vi.fn(async (): Promise<RecordResult> => result) }
}

describe('composeHarnessRun', () => {
  it('happy path: returns the composed prompt and records the binding last', async () => {
    // A real, lint-clean harness: the run-time lint gate now refuses anything
    // with error-severity diagnostics, so the happy path needs a valid one.
    await createHarness(root, 'test-fixer', SLUG)
    const dir = path.join(root, TE_DIR, 'agents', SLUG)
    const [skillMd, rulesMd, scopeJson, stateMd] = await Promise.all(
      ['SKILL.md', 'rules.md', 'scope.json', 'state.md'].map((f) =>
        fs.readFile(path.join(dir, f), 'utf8')
      )
    )
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result).toEqual({
      ok: true,
      prompt: buildHarnessPrompt({
        slug: SLUG,
        harnessDir: `${TE_DIR}/agents/${SLUG}`,
        skillMd,
        rulesMd,
        scopeJson,
        stateMd
      })
    })
    // Budgets snapshot at bind (step 6): the frontmatter budgets read in
    // this compose ride the record call.
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(root, 'th1', SLUG, {
      maxTurns: 10,
      maxWritesPerMinute: 10
    })
  })

  it('run-time lint authority: scope.json tampered after create ⇒ refuses, no binding (TOCTOU)', async () => {
    // The renderer enforces the palette disable against the LIST-time snapshot;
    // a hand-edit stripping the protected globs after the palette opened would
    // slip past it. Main re-lints at run time and refuses.
    await createHarness(root, 'test-fixer', SLUG)
    const scopePath = path.join(root, TE_DIR, 'agents', SLUG, 'scope.json')
    const scope = JSON.parse(await fs.readFile(scopePath, 'utf8'))
    scope.forbiddenGlobs = scope.forbiddenGlobs.filter(
      (g: string) => !(HARNESS_PROTECTED_GLOBS as readonly string[]).includes(g)
    )
    await fs.writeFile(scopePath, JSON.stringify(scope, null, 2), 'utf8')
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('run-time lint')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('a warning-only harness still runs and records the binding', async () => {
    await createHarness(root, 'test-fixer', SLUG)
    // Removing handoffs/ is a WARNING (not read by run) — must not block.
    await fs.rmdir(path.join(root, TE_DIR, 'agents', SLUG, 'handoffs'))
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result.ok).toBe(true)
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(root, 'th1', SLUG, {
      maxTurns: 10,
      maxWritesPerMinute: 10
    })
  })

  it('budgets snapshot source is THIS run request: a post-edit SKILL.md feeds the NEXT bind only', async () => {
    // Snapshot-at-bind (step 6, contracts §5 v1.2.6): compose reads the
    // frontmatter budgets at run time and hands them to record(); the
    // registry's write-once rule (tested in harness-run-registry.test.ts)
    // keeps an ALREADY-bound thread on its original snapshot. Here: after a
    // SKILL.md edit, a fresh thread's bind carries the NEW numbers.
    await createHarness(root, 'test-fixer', SLUG)
    const skillPath = path.join(root, TE_DIR, 'agents', SLUG, 'SKILL.md')
    const skill = await fs.readFile(skillPath, 'utf8')
    await fs.writeFile(
      skillPath,
      skill.replace(
        'budgets: { maxTurns: 10, maxWritesPerMinute: 10 }',
        'budgets: { maxTurns: 3, maxWritesPerMinute: 4 }'
      ),
      'utf8'
    )
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, SLUG, 'th2', { registry })
    expect(result.ok).toBe(true)
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(root, 'th2', SLUG, {
      maxTurns: 3,
      maxWritesPerMinute: 4
    })
  })

  it('refuses an unreadable file with no binding recorded', async () => {
    await writeFixture(path.join(root, TE_DIR, 'agents', SLUG))
    await fs.rm(path.join(root, TE_DIR, 'agents', SLUG, 'rules.md'))
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('rules.md')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses a symlinked agents dir (v1.1.5 read-time realpath re-check), no binding', async () => {
    // A fully valid harness behind the symlink: only the realpath equality
    // check stands between it and a composed prompt.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-run-outside-'))
    extraDirs.push(outside)
    await writeFixture(path.join(outside, SLUG))
    await fs.mkdir(path.join(root, TE_DIR))
    await fs.symlink(outside, path.join(root, TE_DIR, 'agents'))
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('escapes its contract location')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an invalid slug before touching the filesystem', async () => {
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, '../evil', 'th1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid harness slug')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an adapter-identity-colliding slug even when the harness dir exists', async () => {
    // 'cli-claude' trailers would be indistinguishable from the degrade
    // fallback — revertAgent scope would sweep ad-hoc commits too.
    await writeFixture(path.join(root, TE_DIR, 'agents', 'cli-claude'))
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, 'cli-claude', 'th1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('reserved')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an invalid threadId before touching the filesystem (registry-key precondition)', async () => {
    await writeFixture(path.join(root, TE_DIR, 'agents', SLUG))
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, SLUG, 'th 1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid thread id')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses when the registry reports a binding conflict', async () => {
    await createHarness(root, 'test-fixer', SLUG)
    const registry = makeRegistry({
      ok: false,
      error: 'thread th1 is already bound to harness "other" (bindings are write-once)'
    })

    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result).toEqual({
      ok: false,
      error: 'thread th1 is already bound to harness "other" (bindings are write-once)'
    })
  })

  it('a missing harness dir refuses with no binding', async () => {
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, SLUG, 'th1', { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unreadable')
    expect(registry.record).not.toHaveBeenCalled()
  })
})
