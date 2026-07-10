import { describe, expect, it } from 'vitest'
import { buildHarnessDraft } from '../harness-draft'
import {
  HARNESS_BUDGET_BOUNDS,
  HARNESS_PROTECTED_GLOBS,
  isValidHarnessSlug,
  type BlankHarnessOverrides,
  type HarnessCreateRequest,
  type HarnessScope
} from '../harness-types'
import { HARNESS_TEMPLATES } from '../harness-templates'

const EXPECTED_IDS = [
  'idea-to-spec',
  'docs-maintainer',
  'automation-builder',
  'architecture-mapper',
  'boundary-auditor',
  'migration-planner',
  'bug-reproducer',
  'test-fixer',
  'vertical-slice-builder',
  'raw-tool-runner'
] as const

const PLAIN_SCOPE: HarnessScope = {
  goal: 'Make one focused change.',
  allowedGlobs: ['src/**', '<dir>/notes/<dir>.md'],
  forbiddenGlobs: ['.git/**'],
  acceptance: 'The configured verifier exits 0.',
  rollback: 'Reject the pending change.'
}

function blankOverrides(overrides: Partial<BlankHarnessOverrides> = {}): BlankHarnessOverrides {
  return {
    description: 'A complete blank harness.',
    adapter: 'codex',
    budgets: { maxTurns: 5, maxWritesPerMinute: 7 },
    skillBody: 'Perform one focused task, verify it, and stop.',
    rules: '- [critical] Stay inside the configured scope.',
    scope: PLAIN_SCOPE,
    verifyCommand: 'npm test',
    ...overrides
  } as BlankHarnessOverrides
}

describe('Step 8 harness catalog', () => {
  it('freezes the exact ten unique, valid ids and required metadata', () => {
    expect(Object.keys(HARNESS_TEMPLATES)).toEqual(EXPECTED_IDS)
    expect(new Set(Object.keys(HARNESS_TEMPLATES)).size).toBe(EXPECTED_IDS.length)

    for (const template of Object.values(HARNESS_TEMPLATES)) {
      expect(template.id).toBeTruthy()
      expect(isValidHarnessSlug(template.id)).toBe(true)
      expect(template.label).toBeTruthy()
      expect(['Guided', 'Architecture', 'Engineering', 'Bridge']).toContain(template.category)
      expect(template.audience.length).toBeGreaterThan(0)
    }
  })

  it('materializes every one-click template into lint-clean files', () => {
    for (const template of Object.values(HARNESS_TEMPLATES)) {
      if (template.requiresConfiguration) continue
      const result = buildHarnessDraft(
        { template: template.id, slug: template.id },
        `.machina/agents/${template.id}`
      )
      expect(result, template.id).toMatchObject({ ok: true, diagnostics: [] })
    }
  })

  it('raw-tool-runner requires real command, scope, and verifier configuration', () => {
    const unconfigured = buildHarnessDraft(
      { template: 'raw-tool-runner', slug: 'raw-tool-runner' },
      '.machina/agents/raw-tool-runner'
    )
    expect(unconfigured.ok).toBe(false)
    if (!unconfigured.ok) {
      expect(unconfigured.error).toContain('requires configuration')
      expect(unconfigured.error).toContain('invocationTemplate')
      expect(unconfigured.error).toContain('scope')
      expect(unconfigured.error).toContain('verifyCommand')
    }

    const configured = buildHarnessDraft(
      {
        template: 'raw-tool-runner',
        slug: 'raw-tool-runner',
        overrides: {
          invocationTemplate: "my-agent '--prompt' {prompt}",
          scope: PLAIN_SCOPE,
          verifyCommand: 'npm test'
        }
      },
      '.machina/agents/raw-tool-runner'
    )
    expect(configured).toMatchObject({ ok: true, diagnostics: [] })
    if (configured.ok) {
      expect(configured.draft.invocationTemplate).toBe("my-agent '--prompt' {prompt}")
      expect(configured.files.skillMd).toContain("invocationTemplate: my-agent '--prompt' {prompt}")
    }
  })
})

describe('buildHarnessDraft merge and refusal semantics', () => {
  it('rejects unknown top-level request keys from forged IPC input', () => {
    const result = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'test-fixer',
        workspaceRoot: '/forged/root'
      } as unknown as HarnessCreateRequest,
      '.machina/agents/test-fixer'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('unknown harness create request field')
      expect(result.error).toContain('workspaceRoot')
    }
  })

  it('rejects unknown override keys from forged IPC input', () => {
    const result = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'test-fixer',
        overrides: { permissionMode: 'accept-edits' }
      } as unknown as HarnessCreateRequest,
      '.machina/agents/test-fixer'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('unknown harness override field')
      expect(result.error).toContain('permissionMode')
    }
  })

  it('rejects present null, undefined, and wrong-type overrides instead of inheriting', () => {
    const badOverrides: Array<Record<string, unknown>> = [
      { description: null },
      { adapter: null },
      { budgets: null },
      { scope: null },
      { skillBody: 42 },
      { rules: undefined },
      { initialState: false }
    ]
    for (const overrides of badOverrides) {
      const result = buildHarnessDraft(
        {
          template: 'test-fixer',
          slug: 'closed-runtime',
          overrides
        } as unknown as HarnessCreateRequest,
        '.machina/agents/closed-runtime'
      )
      expect(result.ok, JSON.stringify(overrides)).toBe(false)
    }
  })

  it('raw-tool-runner refuses its placeholder scope even when invocation and verifier are supplied', () => {
    const template = HARNESS_TEMPLATES['raw-tool-runner']
    const result = buildHarnessDraft(
      {
        template: template.id,
        slug: template.id,
        overrides: {
          invocationTemplate: "my-agent '--prompt' {prompt}",
          scope: template.scope,
          verifyCommand: 'npm test'
        }
      },
      '.machina/agents/raw-tool-runner'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('deliberate concrete scope goal')
  })

  it('template-only refuses a missing protected glob; overrides:{} repairs it constructively', () => {
    const template = HARNESS_TEMPLATES['test-fixer']
    const forbidden = template.scope.forbiddenGlobs as string[]
    const removedIndex = forbidden.indexOf(HARNESS_PROTECTED_GLOBS[0])
    const [removed] = forbidden.splice(removedIndex, 1)
    try {
      const refused = buildHarnessDraft(
        { template: 'test-fixer', slug: 'test-fixer' },
        '.machina/agents/test-fixer'
      )
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.error).toContain('missing protected forbiddenGlobs')

      const repaired = buildHarnessDraft(
        { template: 'test-fixer', slug: 'test-fixer', overrides: {} },
        '.machina/agents/test-fixer'
      )
      expect(repaired.ok).toBe(true)
      if (repaired.ok) {
        for (const glob of HARNESS_PROTECTED_GLOBS) {
          expect(repaired.draft.scope.forbiddenGlobs).toContain(glob)
        }
      }
    } finally {
      forbidden.splice(removedIndex, 0, removed)
    }
  })

  it('uses atomic field replacement and replaces every <dir> occurrence', () => {
    const result = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'custom-fixer',
        overrides: {
          budgets: { maxTurns: 2, maxWritesPerMinute: 3 },
          scope: PLAIN_SCOPE
        }
      },
      '.machina/agents/custom-fixer'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.budgets).toEqual({ maxTurns: 2, maxWritesPerMinute: 3 })
      expect(result.draft.scope.allowedGlobs).toEqual([
        'src/**',
        '.machina/agents/custom-fixer/notes/.machina/agents/custom-fixer.md'
      ])
      expect(result.draft.scope.allowedGlobs.some((glob) => glob.includes('<dir>'))).toBe(false)
    }
  })

  it('builds a complete blank harness and refuses incomplete runtime input', () => {
    const complete = buildHarnessDraft(
      { slug: 'blank-agent', overrides: blankOverrides() },
      '.machina/agents/blank-agent'
    )
    expect(complete).toMatchObject({ ok: true, diagnostics: [] })
    if (complete.ok) {
      expect(complete.draft.templateId).toBeUndefined()
      expect(complete.files.verifySh).toContain('npm test')
      expect(complete.files.stateMd).toContain('# Repo memory')
    }

    const incomplete = buildHarnessDraft(
      { slug: 'blank-agent', overrides: { adapter: 'codex' } } as HarnessCreateRequest,
      '.machina/agents/blank-agent'
    )
    expect(incomplete.ok).toBe(false)
    if (!incomplete.ok) expect(incomplete.error).toContain('description is required')
  })

  it('rejects frontmatter injection or truncation instead of escaping it', () => {
    for (const description of ['safe\nadapter: raw', 'visible # silently truncated']) {
      const result = buildHarnessDraft(
        { template: 'test-fixer', slug: 'custom-fixer', overrides: { description } },
        '.machina/agents/custom-fixer'
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('frontmatter round-trip')
    }
  })

  it('requires raw templates only for raw and forbids them on structured adapters', () => {
    const rawMissing = buildHarnessDraft(
      {
        slug: 'blank-raw',
        overrides: {
          ...blankOverrides(),
          adapter: 'raw',
          invocationTemplate: undefined
        }
      } as HarnessCreateRequest,
      '.machina/agents/blank-raw'
    )
    expect(rawMissing.ok).toBe(false)
    if (!rawMissing.ok) expect(rawMissing.error).toContain('must be a string when present')

    const structuredWithRaw = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'custom-fixer',
        overrides: { invocationTemplate: 'other-agent {prompt}' }
      },
      '.machina/agents/custom-fixer'
    )
    expect(structuredWithRaw.ok).toBe(false)
    if (!structuredWithRaw.ok) expect(structuredWithRaw.error).toContain('only valid for raw')
  })

  it('refuses terminal control bytes in a raw invocation before materialization', () => {
    const result = buildHarnessDraft(
      {
        template: 'raw-tool-runner',
        slug: 'raw-controlled',
        overrides: {
          invocationTemplate: 'my-agent \x15{prompt}',
          scope: {
            goal: 'Run the configured agent.',
            allowedGlobs: ['src/**'],
            forbiddenGlobs: [],
            acceptance: 'The configured task succeeds.',
            rollback: 'Revert the queued changes.'
          },
          verifyCommand: 'npm test'
        }
      },
      '.machina/agents/raw-controlled'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Ctrl-U')
  })

  it('rejects verifier shell constructs that can mask an earlier failure', () => {
    for (const verifyCommand of [
      'npm test | tee test.log',
      'npm test || echo ignored',
      'npm test; true',
      'npm test &',
      '! npm test',
      'npm test && ! npm run check',
      'echo $(npm test)',
      'echo `npm test`'
    ]) {
      const result = buildHarnessDraft(
        { template: 'test-fixer', slug: 'custom-fixer', overrides: { verifyCommand } },
        '.machina/agents/custom-fixer'
      )
      expect(result.ok, verifyCommand).toBe(false)
      if (!result.ok) expect(result.error).toContain('join required gates with &&')
    }

    const requiredSequence = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'custom-fixer',
        overrides: { verifyCommand: 'npm test && npm run check' }
      },
      '.machina/agents/custom-fixer'
    )
    expect(requiredSequence.ok).toBe(true)

    const benignTestArgument = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'custom-fixer',
        overrides: { verifyCommand: 'test ! -e sentinel && npm test' }
      },
      '.machina/agents/custom-fixer'
    )
    expect(benignTestArgument.ok).toBe(true)
  })

  it('enforces finite integer budget bounds', () => {
    const invalid = [
      { maxTurns: 0, maxWritesPerMinute: 1 },
      { maxTurns: HARNESS_BUDGET_BOUNDS.maxTurns.max + 1, maxWritesPerMinute: 1 },
      { maxTurns: 1.5, maxWritesPerMinute: 1 },
      { maxTurns: 1, maxWritesPerMinute: HARNESS_BUDGET_BOUNDS.maxWritesPerMinute.max + 1 }
    ]
    for (const budgets of invalid) {
      const result = buildHarnessDraft(
        { template: 'test-fixer', slug: 'custom-fixer', overrides: { budgets } },
        '.machina/agents/custom-fixer'
      )
      expect(result.ok, JSON.stringify(budgets)).toBe(false)
    }

    const edge = buildHarnessDraft(
      {
        template: 'test-fixer',
        slug: 'custom-fixer',
        overrides: {
          budgets: {
            maxTurns: HARNESS_BUDGET_BOUNDS.maxTurns.max,
            maxWritesPerMinute: HARNESS_BUDGET_BOUNDS.maxWritesPerMinute.max
          }
        }
      },
      '.machina/agents/custom-fixer'
    )
    expect(edge.ok).toBe(true)
  })
})
