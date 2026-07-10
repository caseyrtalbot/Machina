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
import {
  buildHarnessPrompt,
  HARNESS_PROTECTED_GLOBS,
  type HarnessAdapter,
  type HarnessBudgets
} from '@shared/harness-types'
import { composeHarnessRun } from '../harness-run'
import { createHarness, type HarnessInspection } from '../harness-service'
import type { HarnessBinding } from '../harness-run-registry'

// harness-run defaults to the singleton registry, whose module imports
// electron; every test here injects its own registry.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' } }))

const SLUG = 'test-fixer'
const TASK_BRIEF = 'Fix the reported checkout regression.'
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

function makeRegistry(result: RecordResult = { ok: true }, initial?: HarnessBinding) {
  let binding = initial
  return {
    record: vi.fn(
      async (
        workspaceRoot: string,
        _threadId: string,
        slug: string,
        budgets?: HarnessBudgets,
        invocationTemplate?: string,
        adapter?: HarnessAdapter
      ): Promise<RecordResult> => {
        if (result.ok && binding === undefined) {
          binding = {
            slug,
            workspaceRoot,
            ...(adapter !== undefined ? { adapter } : {}),
            ...(budgets !== undefined ? { budgets } : {}),
            ...(invocationTemplate !== undefined ? { invocationTemplate } : {})
          }
        }
        return result
      }
    ),
    get: vi.fn(() => binding)
  }
}

describe('composeHarnessRun', () => {
  it('happy path: returns the composed prompt and records the binding last', async () => {
    // A real, lint-clean harness: the run-time lint gate now refuses anything
    // with error-severity diagnostics, so the happy path needs a valid one.
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const dir = path.join(root, TE_DIR, 'agents', SLUG)
    const [skillMd, rulesMd, scopeJson, stateMd] = await Promise.all(
      ['SKILL.md', 'rules.md', 'scope.json', 'state.md'].map((f) =>
        fs.readFile(path.join(dir, f), 'utf8')
      )
    )
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
    expect(result).toEqual({
      ok: true,
      adapter: 'claude',
      prompt: buildHarnessPrompt({
        slug: SLUG,
        harnessDir: `${TE_DIR}/agents/${SLUG}`,
        taskBrief: TASK_BRIEF,
        skillMd,
        rulesMd,
        scopeJson,
        stateMd
      })
    })
    // Budgets snapshot at bind (step 6): the frontmatter budgets read in
    // this compose ride the record call.
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(
      root,
      'th1',
      SLUG,
      { maxTurns: 10, maxWritesPerMinute: 10 },
      undefined,
      'claude'
    )
  })

  it.each([
    ['absent', undefined, 'required'],
    ['blank', ' \n\t ', 'blank'],
    ['oversized', 'x'.repeat(4001), 'at most 4000'],
    ['NUL', 'fix\0anything', 'NUL']
  ])(
    'rejects an %s task brief before filesystem access or binding',
    async (_label, invalidBrief, reason) => {
      const inspect = vi.fn(async (): Promise<HarnessInspection> => {
        throw new Error('inspection must not run')
      })
      const registry = makeRegistry()

      const result = await composeHarnessRun(root, SLUG, 'th1', invalidBrief as string, {
        inspect,
        registry
      })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain(reason)
      expect(inspect).not.toHaveBeenCalled()
      expect(registry.record).not.toHaveBeenCalled()
    }
  )

  it('run-time lint authority: scope.json tampered after create ⇒ refuses, no binding (TOCTOU)', async () => {
    // The renderer enforces the palette disable against the LIST-time snapshot;
    // a hand-edit stripping the protected globs after the palette opened would
    // slip past it. Main re-lints at run time and refuses.
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const scopePath = path.join(root, TE_DIR, 'agents', SLUG, 'scope.json')
    const scope = JSON.parse(await fs.readFile(scopePath, 'utf8'))
    scope.forbiddenGlobs = scope.forbiddenGlobs.filter(
      (g: string) => !(HARNESS_PROTECTED_GLOBS as readonly string[]).includes(g)
    )
    await fs.writeFile(scopePath, JSON.stringify(scope, null, 2), 'utf8')
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('run-time lint')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('a warning-only harness still runs and records the binding', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    // Removing handoffs/ is a WARNING (not read by run) — must not block.
    await fs.rmdir(path.join(root, TE_DIR, 'agents', SLUG, 'handoffs'))
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(true)
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(
      root,
      'th1',
      SLUG,
      { maxTurns: 10, maxWritesPerMinute: 10 },
      undefined,
      'claude'
    )
  })

  it('budgets snapshot source is THIS run request: a post-edit SKILL.md feeds the NEXT bind only', async () => {
    // Snapshot-at-bind (step 6, contracts §5 v1.2.6): compose reads the
    // frontmatter budgets at run time and hands them to record(); the
    // registry's write-once rule (tested in harness-run-registry.test.ts)
    // keeps an ALREADY-bound thread on its original snapshot. Here: after a
    // SKILL.md edit, a fresh thread's bind carries the NEW numbers.
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
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
    const result = await composeHarnessRun(root, SLUG, 'th2', TASK_BRIEF, { registry })
    expect(result.ok).toBe(true)
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(
      root,
      'th2',
      SLUG,
      { maxTurns: 3, maxWritesPerMinute: 4 },
      undefined,
      'claude'
    )
  })

  it('raw harness snapshots its validated invocation template into the main binding', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const skillPath = path.join(root, TE_DIR, 'agents', SLUG, 'SKILL.md')
    const skill = await fs.readFile(skillPath, 'utf8')
    await fs.writeFile(
      skillPath,
      skill
        .replace('adapter: claude', 'adapter: raw')
        .replace('permissionMode:', "invocationTemplate: mytool '--ask' {prompt}\npermissionMode:"),
      'utf8'
    )
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th-raw', TASK_BRIEF, { registry })

    expect(result.ok).toBe(true)
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(
      root,
      'th-raw',
      SLUG,
      { maxTurns: 10, maxWritesPerMinute: 10 },
      "mytool '--ask' {prompt}",
      'raw'
    )
  })

  it('raw harness with a missing invocation template refuses without recording a binding', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const skillPath = path.join(root, TE_DIR, 'agents', SLUG, 'SKILL.md')
    const skill = await fs.readFile(skillPath, 'utf8')
    await fs.writeFile(skillPath, skill.replace('adapter: claude', 'adapter: raw'), 'utf8')
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th-raw', TASK_BRIEF, { registry })

    expect(result.ok).toBe(false)
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('hand-edited raw Ctrl-U template fails run-time lint without recording a binding', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const skillPath = path.join(root, TE_DIR, 'agents', SLUG, 'SKILL.md')
    const skill = await fs.readFile(skillPath, 'utf8')
    await fs.writeFile(
      skillPath,
      skill
        .replace('adapter: claude', 'adapter: raw')
        .replace('permissionMode:', 'invocationTemplate: mytool \x15{prompt}\npermissionMode:'),
      'utf8'
    )
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th-controlled', TASK_BRIEF, { registry })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Ctrl-U')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an unreadable file with no binding recorded', async () => {
    await writeFixture(path.join(root, TE_DIR, 'agents', SLUG))
    await fs.rm(path.join(root, TE_DIR, 'agents', SLUG, 'rules.md'))
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
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

    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('does not canonicalize')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an invalid slug before touching the filesystem', async () => {
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, '../evil', 'th1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid harness slug')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an adapter-identity-colliding slug even when the harness dir exists', async () => {
    // 'cli-claude' trailers would be indistinguishable from the degrade
    // fallback — revertAgent scope would sweep ad-hoc commits too.
    await writeFixture(path.join(root, TE_DIR, 'agents', 'cli-claude'))
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, 'cli-claude', 'th1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('reserved')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an invalid threadId before touching the filesystem (registry-key precondition)', async () => {
    await writeFixture(path.join(root, TE_DIR, 'agents', SLUG))
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, SLUG, 'th 1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid thread id')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses when the registry reports a binding conflict', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const registry = makeRegistry({
      ok: false,
      error: 'thread th1 is already bound to harness "other" (bindings are write-once)'
    })

    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
    expect(result).toEqual({
      ok: false,
      error: 'thread th1 is already bound to harness "other" (bindings are write-once)'
    })
  })

  it('a missing harness dir refuses with no binding', async () => {
    const registry = makeRegistry()
    const result = await composeHarnessRun(root, SLUG, 'th1', TASK_BRIEF, { registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('directory not found')
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('refuses an outside-target state.md symlink and never composes or binds it', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const outside = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'harness-state-outside-')),
      'state.md'
    )
    extraDirs.push(path.dirname(outside))
    await fs.writeFile(outside, 'outside secret state\n', 'utf8')
    const statePath = path.join(root, TE_DIR, 'agents', SLUG, 'state.md')
    await fs.rm(statePath)
    await fs.symlink(outside, statePath)
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th-state-link', TASK_BRIEF, { registry })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('state.md')
      expect(result.error).toContain('symbolic link')
    }
    expect(registry.record).not.toHaveBeenCalled()
  })

  it('composes and binds from the same inspected bytes with one inspection only', async () => {
    const files = {
      skillMd: '---\nname: exact\n---\nexact skill bytes\n',
      rulesMd: 'exact rules bytes\n',
      scopeJson: '{"goal":"exact scope bytes"}\n',
      stateMd: 'exact state bytes\n',
      verifySh: '#!/bin/sh\nexit 0\n'
    }
    const inspect = vi.fn(
      async (): Promise<HarnessInspection> => ({
        diagnostics: [],
        frontmatter: {
          name: 'Exact',
          description: 'Captured once',
          adapter: 'codex',
          permissionMode: 'queue-all-writes',
          budgets: { maxTurns: 2, maxWritesPerMinute: 3 }
        },
        files
      })
    )
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th-exact', TASK_BRIEF, {
      inspect,
      registry
    })

    expect(inspect).toHaveBeenCalledExactlyOnceWith(root, SLUG)
    expect(result).toEqual({
      ok: true,
      adapter: 'codex',
      prompt: buildHarnessPrompt({
        slug: SLUG,
        harnessDir: `${TE_DIR}/agents/${SLUG}`,
        taskBrief: TASK_BRIEF,
        skillMd: files.skillMd,
        rulesMd: files.rulesMd,
        scopeJson: files.scopeJson,
        stateMd: files.stateMd
      })
    })
    expect(registry.record).toHaveBeenCalledExactlyOnceWith(
      root,
      'th-exact',
      SLUG,
      { maxTurns: 2, maxWritesPerMinute: 3 },
      undefined,
      'codex'
    )
  })

  it('returns the authoritative current adapter, not a stale renderer summary', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const skillPath = path.join(root, TE_DIR, 'agents', SLUG, 'SKILL.md')
    await fs.writeFile(
      skillPath,
      (await fs.readFile(skillPath, 'utf8')).replace('adapter: claude', 'adapter: codex'),
      'utf8'
    )
    const registry = makeRegistry()

    const result = await composeHarnessRun(root, SLUG, 'th-current-adapter', TASK_BRIEF, {
      registry
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.adapter).toBe('codex')
  })

  it('reports null adapter for an authoritative legacy binding without an adapter snapshot', async () => {
    await createHarness(root, { template: 'test-fixer', slug: SLUG })
    const registry = makeRegistry({ ok: true }, { slug: SLUG, workspaceRoot: root })

    const result = await composeHarnessRun(root, SLUG, 'th-legacy', TASK_BRIEF, { registry })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.adapter).toBeNull()
  })
})
