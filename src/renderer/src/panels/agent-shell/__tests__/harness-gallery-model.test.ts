import { describe, expect, it } from 'vitest'
import { TE_DIR, HARNESS_PROTECTED_GLOBS } from '@shared/constants'
import { HARNESS_TEMPLATES } from '@shared/harness-templates'
import {
  ALL_HARNESS_FILTERS,
  FIXED_HARNESS_PERMISSION_MODE,
  HARNESS_CATALOG,
  evaluateHarnessBuilder,
  filterHarnessCatalog,
  normalizeHarnessBuilderState,
  seedHarnessBuilderState,
  showsRawInvocationField,
  type HarnessBuilderState
} from '../harness-gallery-model'

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
]

function validBlank(overrides: Partial<HarnessBuilderState> = {}): HarnessBuilderState {
  return {
    ...seedHarnessBuilderState(),
    slug: 'blank-agent',
    description: 'Performs one focused task.',
    adapter: 'codex',
    maxTurns: '5',
    maxWritesPerMinute: '7',
    skillBody: 'Perform one focused task, verify it, and stop.',
    rules: '- [critical] Stay inside the configured scope.',
    goal: 'Make one focused change.',
    allowedGlobs: 'src/**\n<dir>/state.md',
    forbiddenGlobs: '.git/**',
    acceptance: 'The configured verifier exits 0.',
    rollback: 'Reject the pending change.',
    verifyCommand: 'npm test',
    ...overrides
  }
}

describe('harness gallery catalog model', () => {
  it('exposes the exact ten shared cards in registry order', () => {
    expect(HARNESS_CATALOG.map((template) => template.id)).toEqual(EXPECTED_IDS)
  })

  it('filters independently and jointly by shared category and audience metadata', () => {
    expect(
      filterHarnessCatalog({ category: 'Architecture' }).map((template) => template.id)
    ).toEqual(['architecture-mapper', 'boundary-auditor', 'migration-planner'])
    expect(
      filterHarnessCatalog({ audience: 'non-engineer' }).map((template) => template.id)
    ).toEqual(['idea-to-spec', 'docs-maintainer'])
    expect(
      filterHarnessCatalog({ category: 'Guided', audience: 'seasoned-programmer' }).map(
        (template) => template.id
      )
    ).toEqual(['docs-maintainer', 'automation-builder'])
    expect(
      filterHarnessCatalog({
        category: ALL_HARNESS_FILTERS,
        audience: ALL_HARNESS_FILTERS
      })
    ).toHaveLength(10)
  })
})

describe('harness builder seeding and normalization', () => {
  it('seeds blank state with fixed permission mode and safe numeric defaults', () => {
    const state = seedHarnessBuilderState()
    expect(state).toMatchObject({
      slug: '',
      adapter: 'claude',
      permissionMode: FIXED_HARNESS_PERMISSION_MODE,
      maxTurns: '10',
      maxWritesPerMinute: '10',
      invocationTemplate: ''
    })
  })

  it('seeds every editable template field without synthesizing a verifier override', () => {
    const template = HARNESS_TEMPLATES['test-fixer']
    const state = seedHarnessBuilderState(template)
    expect(state).toMatchObject({
      templateId: template.id,
      slug: template.id,
      description: template.description,
      adapter: template.adapter,
      permissionMode: FIXED_HARNESS_PERMISSION_MODE,
      maxTurns: String(template.budgets.maxTurns),
      maxWritesPerMinute: String(template.budgets.maxWritesPerMinute),
      goal: template.scope.goal,
      acceptance: template.scope.acceptance,
      rollback: template.scope.rollback,
      verifyCommand: ''
    })
    expect(state.allowedGlobs.split('\n')).toEqual(template.scope.allowedGlobs)
    expect(state.forbiddenGlobs.split('\n')).toEqual(template.scope.forbiddenGlobs)
    expect(evaluateHarnessBuilder(state)).toMatchObject({ createDisabled: false, warnings: [] })
  })

  it('seeds configuration-required raw scope blank and stays disabled until it is deliberate', () => {
    const template = HARNESS_TEMPLATES['raw-tool-runner']
    const seeded = seedHarnessBuilderState(template)
    expect(seeded).toMatchObject({
      invocationTemplate: '',
      goal: '',
      allowedGlobs: '',
      forbiddenGlobs: '',
      acceptance: '',
      rollback: '',
      verifyCommand: ''
    })

    const invocationAndVerifierOnly = evaluateHarnessBuilder({
      ...seeded,
      invocationTemplate: "my-agent '--prompt' {prompt}",
      verifyCommand: 'npm test'
    })
    expect(invocationAndVerifierOnly.createDisabled).toBe(true)
    expect(invocationAndVerifierOnly.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(['goal', 'acceptance', 'rollback'])
    )

    const configured = evaluateHarnessBuilder({
      ...seeded,
      invocationTemplate: "my-agent '--prompt' {prompt}",
      goal: 'Review one configured workspace boundary.',
      allowedGlobs: 'src/**',
      forbiddenGlobs: '.env*',
      acceptance: 'The configured verifier passes.',
      rollback: 'Reject the pending change.',
      verifyCommand: 'npm test'
    })
    expect(configured.createDisabled).toBe(false)
    expect(configured.preview?.ok).toBe(true)
  })

  it('normalizes newline-delimited globs/rules and integer budgets into a typed blank request', () => {
    const normalized = normalizeHarnessBuilderState(
      validBlank({
        maxTurns: ' 5 ',
        maxWritesPerMinute: '007',
        allowedGlobs: ' src/** \n\n src/**\n <dir>/state.md ',
        forbiddenGlobs: ' .git/**\r\n.env*\r\n.git/** ',
        rules: ' - [critical] Stay in scope. \n\n - [minor] Report verification. '
      })
    )
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.request.template).toBeUndefined()
    expect(normalized.request.overrides).toMatchObject({
      adapter: 'codex',
      budgets: { maxTurns: 5, maxWritesPerMinute: 7 },
      rules: '- [critical] Stay in scope.\n- [minor] Report verification.',
      scope: {
        allowedGlobs: ['src/**', '<dir>/state.md'],
        forbiddenGlobs: ['.git/**', '.env*']
      },
      verifyCommand: 'npm test'
    })
    expect(normalized.request.overrides).not.toHaveProperty('permissionMode')
  })

  it('shows and forwards invocationTemplate only for raw adapters', () => {
    const raw = validBlank({
      adapter: 'raw',
      invocationTemplate: "my-agent '--prompt' {prompt}"
    })
    expect(showsRawInvocationField(raw)).toBe(true)
    const rawResult = normalizeHarnessBuilderState(raw)
    expect(rawResult.ok).toBe(true)
    if (rawResult.ok) {
      expect(rawResult.request.overrides).toMatchObject({
        adapter: 'raw',
        invocationTemplate: "my-agent '--prompt' {prompt}"
      })
    }

    const structured = { ...raw, adapter: 'codex' as const }
    expect(showsRawInvocationField(structured)).toBe(false)
    const structuredResult = normalizeHarnessBuilderState(structured)
    expect(structuredResult.ok).toBe(true)
    if (structuredResult.ok) {
      expect(structuredResult.request.overrides).not.toHaveProperty('invocationTemplate')
    }
  })
})

describe('harness builder preview and feedback', () => {
  it('delegates protected-glob union and every <dir> replacement to shared draft assembly', () => {
    const evaluation = evaluateHarnessBuilder(
      validBlank({ allowedGlobs: '<dir>/notes/<dir>.md', forbiddenGlobs: '.git/**' })
    )
    expect(evaluation.createDisabled).toBe(false)
    expect(evaluation.preview?.ok).toBe(true)
    if (evaluation.preview?.ok !== true) return
    for (const glob of HARNESS_PROTECTED_GLOBS) {
      expect(evaluation.preview.draft.scope.forbiddenGlobs).toContain(glob)
    }
    expect(evaluation.preview.draft.scope.allowedGlobs).toEqual([
      `${TE_DIR}/agents/blank-agent/notes/${TE_DIR}/agents/blank-agent.md`
    ])
  })

  it('disables create for blank required fields, malformed budgets, invalid slugs, and raw commands', () => {
    const missing = evaluateHarnessBuilder(seedHarnessBuilderState())
    expect(missing.createDisabled).toBe(true)
    expect(missing.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining([
        'slug',
        'description',
        'skillBody',
        'rules',
        'goal',
        'acceptance',
        'rollback',
        'verifyCommand'
      ])
    )

    const budget = evaluateHarnessBuilder(validBlank({ maxTurns: '1.5' }))
    expect(budget.createDisabled).toBe(true)
    expect(budget.errors).toEqual([
      expect.objectContaining({
        field: 'maxTurns',
        message: expect.stringContaining('whole number')
      })
    ])

    const slug = evaluateHarnessBuilder(validBlank({ slug: '../escape' }))
    expect(slug.createDisabled).toBe(true)
    expect(slug.errors[0].message).toContain('invalid harness slug')

    const raw = evaluateHarnessBuilder(
      validBlank({ adapter: 'raw', invocationTemplate: "my-agent '--version'" })
    )
    expect(raw.createDisabled).toBe(true)
    expect(raw.errors[0].message).toContain("'{prompt}'")
  })

  it('surfaces shared frontmatter round-trip refusal as a blocking form error', () => {
    for (const description of ['safe\nadapter: raw', 'visible # silently truncated']) {
      const evaluation = evaluateHarnessBuilder(validBlank({ description }))
      expect(evaluation.createDisabled).toBe(true)
      expect(evaluation.errors).toEqual([
        expect.objectContaining({
          code: 'draft-invalid',
          message: expect.stringContaining('round-trip')
        })
      ])
    }
  })

  it('does not disable create for warning-only shared lint diagnostics', () => {
    const evaluation = evaluateHarnessBuilder(
      validBlank({ rules: 'This rule intentionally lacks a severity tag.' })
    )
    expect(evaluation.errors).toEqual([])
    expect(evaluation.warnings).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'rules-format', file: 'rules.md' })
    ])
    expect(evaluation.createDisabled).toBe(false)
  })

  it('keeps permission mode fixed even if forged form state tries to widen it', () => {
    const forged = {
      ...validBlank(),
      permissionMode: 'accept-edits'
    } as unknown as HarnessBuilderState
    const evaluation = evaluateHarnessBuilder(forged)
    expect(evaluation.createDisabled).toBe(false)
    expect(evaluation.preview?.ok).toBe(true)
    if (evaluation.preview?.ok) {
      expect(evaluation.preview.draft.permissionMode).toBe(FIXED_HARNESS_PERMISSION_MODE)
    }
    expect(evaluation.request?.overrides).not.toHaveProperty('permissionMode')
  })
})
