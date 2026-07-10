import { TE_DIR } from '@shared/constants'
import { buildHarnessDraft, type HarnessDraftBuildResult } from '@shared/harness-draft'
import { HARNESS_TEMPLATES } from '@shared/harness-templates'
import {
  HARNESS_BUDGET_BOUNDS,
  type BlankHarnessOverrides,
  type HarnessAdapter,
  type HarnessAudience,
  type HarnessCategory,
  type HarnessCreateRequest,
  type HarnessOverrides,
  type HarnessScope,
  type HarnessTemplate
} from '@shared/harness-types'

export const ALL_HARNESS_FILTERS = 'all' as const
export const FIXED_HARNESS_PERMISSION_MODE = 'queue-all-writes' as const

export type HarnessCategoryFilter = HarnessCategory | typeof ALL_HARNESS_FILTERS
export type HarnessAudienceFilter = HarnessAudience | typeof ALL_HARNESS_FILTERS

export interface HarnessCatalogFilters {
  readonly category?: HarnessCategoryFilter
  readonly audience?: HarnessAudienceFilter
}

/** Stable catalog order is the shared registry order shown by the gallery. */
export const HARNESS_CATALOG: readonly HarnessTemplate[] = Object.freeze(
  Object.values(HARNESS_TEMPLATES)
)

export function filterHarnessCatalog(
  filters: HarnessCatalogFilters,
  catalog: readonly HarnessTemplate[] = HARNESS_CATALOG
): readonly HarnessTemplate[] {
  const category = filters.category ?? ALL_HARNESS_FILTERS
  const audience = filters.audience ?? ALL_HARNESS_FILTERS
  return catalog.filter(
    (template) =>
      (category === ALL_HARNESS_FILTERS || template.category === category) &&
      (audience === ALL_HARNESS_FILTERS || template.audience.includes(audience))
  )
}

/** String-backed form state: inputs can be incomplete without lying to shared types. */
export interface HarnessBuilderState {
  readonly templateId?: string
  readonly slug: string
  readonly description: string
  readonly adapter: HarnessAdapter
  readonly permissionMode: typeof FIXED_HARNESS_PERMISSION_MODE
  readonly maxTurns: string
  readonly maxWritesPerMinute: string
  readonly invocationTemplate: string
  readonly skillBody: string
  readonly rules: string
  readonly goal: string
  readonly allowedGlobs: string
  readonly forbiddenGlobs: string
  readonly acceptance: string
  readonly rollback: string
  /** Blank means inherit the selected template's verify.sh; required for blank/config templates. */
  readonly verifyCommand: string
}

const DEFAULT_BUDGET = '10'

export function seedHarnessBuilderState(template?: HarnessTemplate): HarnessBuilderState {
  if (template === undefined) {
    return {
      slug: '',
      description: '',
      adapter: 'claude',
      permissionMode: FIXED_HARNESS_PERMISSION_MODE,
      maxTurns: DEFAULT_BUDGET,
      maxWritesPerMinute: DEFAULT_BUDGET,
      invocationTemplate: '',
      skillBody: '',
      rules: '',
      goal: '',
      allowedGlobs: '',
      forbiddenGlobs: '',
      acceptance: '',
      rollback: '',
      verifyCommand: ''
    }
  }

  const requiresScopeConfiguration = template.requiresConfiguration

  return {
    templateId: template.id,
    slug: template.id,
    description: template.description,
    adapter: template.adapter,
    permissionMode: FIXED_HARNESS_PERMISSION_MODE,
    maxTurns: String(template.budgets.maxTurns),
    maxWritesPerMinute: String(template.budgets.maxWritesPerMinute),
    invocationTemplate: template.invocationTemplate ?? '',
    skillBody: template.skillBody,
    rules: template.rules,
    // Configuration-required templates deliberately start empty. Copying the
    // template's sentinel scope would make mere field presence look like an
    // operator-authored contract once protected globs are unioned main-side.
    goal: requiresScopeConfiguration ? '' : template.scope.goal,
    allowedGlobs: requiresScopeConfiguration ? '' : template.scope.allowedGlobs.join('\n'),
    forbiddenGlobs: requiresScopeConfiguration ? '' : template.scope.forbiddenGlobs.join('\n'),
    acceptance: requiresScopeConfiguration ? '' : template.scope.acceptance,
    rollback: requiresScopeConfiguration ? '' : template.scope.rollback,
    // Built-in scripts remain inherited byte-for-byte. Config-required
    // templates expose this empty field for the user to supply explicitly.
    verifyCommand: ''
  }
}

export function showsRawInvocationField(state: HarnessBuilderState): boolean {
  return state.adapter === 'raw'
}

export type HarnessBuilderField =
  | 'templateId'
  | 'slug'
  | 'description'
  | 'maxTurns'
  | 'maxWritesPerMinute'
  | 'invocationTemplate'
  | 'skillBody'
  | 'rules'
  | 'goal'
  | 'acceptance'
  | 'rollback'
  | 'verifyCommand'

export interface HarnessBuilderFieldError {
  readonly field: HarnessBuilderField
  readonly message: string
}

export type HarnessBuilderNormalization =
  | { readonly ok: true; readonly request: HarnessCreateRequest }
  | { readonly ok: false; readonly errors: readonly HarnessBuilderFieldError[] }

function normalizeLines(value: string, deduplicate: boolean): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return deduplicate ? [...new Set(lines)] : lines
}

function parseBudget(
  field: 'maxTurns' | 'maxWritesPerMinute',
  raw: string
): { readonly value?: number; readonly error?: HarnessBuilderFieldError } {
  const value = raw.trim()
  const bounds = HARNESS_BUDGET_BOUNDS[field]
  if (!/^\d+$/.test(value)) {
    return { error: { field, message: `${field} must be a whole number` } }
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return {
      error: {
        field,
        message: `${field} must be an integer from ${bounds.min} to ${bounds.max}`
      }
    }
  }
  return { value: parsed }
}

function required(
  errors: HarnessBuilderFieldError[],
  field: HarnessBuilderField,
  value: string
): void {
  if (value.trim().length === 0) errors.push({ field, message: `${field} is required` })
}

export function normalizeHarnessBuilderState(
  state: HarnessBuilderState
): HarnessBuilderNormalization {
  const errors: HarnessBuilderFieldError[] = []
  const template = state.templateId === undefined ? undefined : HARNESS_TEMPLATES[state.templateId]
  if (state.templateId !== undefined && template === undefined) {
    errors.push({ field: 'templateId', message: `unknown harness template: ${state.templateId}` })
  }

  required(errors, 'slug', state.slug)
  required(errors, 'description', state.description)
  required(errors, 'skillBody', state.skillBody)
  required(errors, 'rules', state.rules)
  required(errors, 'goal', state.goal)
  required(errors, 'acceptance', state.acceptance)
  required(errors, 'rollback', state.rollback)
  if (state.adapter === 'raw') required(errors, 'invocationTemplate', state.invocationTemplate)
  if (template === undefined || template.requiresConfiguration) {
    required(errors, 'verifyCommand', state.verifyCommand)
  }

  const maxTurns = parseBudget('maxTurns', state.maxTurns)
  const maxWritesPerMinute = parseBudget('maxWritesPerMinute', state.maxWritesPerMinute)
  if (maxTurns.error !== undefined) errors.push(maxTurns.error)
  if (maxWritesPerMinute.error !== undefined) errors.push(maxWritesPerMinute.error)
  if (errors.length > 0 || maxTurns.value === undefined || maxWritesPerMinute.value === undefined) {
    return { ok: false, errors }
  }

  const slug = state.slug.trim()
  const description = state.description.trim()
  const invocationTemplate = state.invocationTemplate.trim()
  const verifyCommand = state.verifyCommand.trim()
  const scope: HarnessScope = {
    goal: state.goal.trim(),
    allowedGlobs: normalizeLines(state.allowedGlobs, true),
    forbiddenGlobs: normalizeLines(state.forbiddenGlobs, true),
    acceptance: state.acceptance.trim(),
    rollback: state.rollback.trim()
  }
  const commonOverrides = {
    description,
    adapter: state.adapter,
    budgets: {
      maxTurns: maxTurns.value,
      maxWritesPerMinute: maxWritesPerMinute.value
    },
    skillBody: state.skillBody.trim(),
    rules: normalizeLines(state.rules, false).join('\n'),
    scope,
    ...(verifyCommand.length > 0 ? { verifyCommand } : {})
  } satisfies HarnessOverrides

  if (state.templateId !== undefined) {
    const overrides: HarnessOverrides = {
      ...commonOverrides,
      ...(state.adapter === 'raw' ? { invocationTemplate } : {})
    }
    return {
      ok: true,
      request: { template: state.templateId, slug, overrides }
    }
  }

  if (state.adapter === 'raw') {
    const overrides: BlankHarnessOverrides = {
      ...commonOverrides,
      adapter: 'raw',
      invocationTemplate,
      verifyCommand
    }
    return { ok: true, request: { slug, overrides } }
  }

  const overrides: BlankHarnessOverrides = {
    ...commonOverrides,
    adapter: state.adapter,
    verifyCommand
  }
  return { ok: true, request: { slug, overrides } }
}

export interface HarnessBuilderFeedback {
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly message: string
  readonly field?: HarnessBuilderField
  readonly file?: string
}

export interface HarnessBuilderEvaluation {
  readonly request: HarnessCreateRequest | null
  readonly preview: HarnessDraftBuildResult | null
  readonly errors: readonly HarnessBuilderFeedback[]
  readonly warnings: readonly HarnessBuilderFeedback[]
  readonly createDisabled: boolean
}

/**
 * Evaluate the exact request main will rebuild. Protected-glob union,
 * materialization, frontmatter round-trip, and linting all remain exclusively
 * in shared buildHarnessDraft.
 */
export function evaluateHarnessBuilder(state: HarnessBuilderState): HarnessBuilderEvaluation {
  const normalized = normalizeHarnessBuilderState(state)
  if (!normalized.ok) {
    const errors = normalized.errors.map(
      (error): HarnessBuilderFeedback => ({
        severity: 'error',
        code: `field-${error.field}`,
        field: error.field,
        message: error.message
      })
    )
    return { request: null, preview: null, errors, warnings: [], createDisabled: true }
  }

  const preview = buildHarnessDraft(
    normalized.request,
    `${TE_DIR}/agents/${normalized.request.slug}`
  )
  const diagnosticFeedback = preview.diagnostics.map(
    (diagnostic): HarnessBuilderFeedback => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      file: diagnostic.file
    })
  )
  const errors = diagnosticFeedback.filter((feedback) => feedback.severity === 'error')
  const warnings = diagnosticFeedback.filter((feedback) => feedback.severity === 'warning')

  if (!preview.ok && errors.length === 0) {
    errors.push({
      severity: 'error',
      code: 'draft-invalid',
      message: preview.error
    })
  }

  return {
    request: normalized.request,
    preview,
    errors,
    warnings,
    createDisabled: errors.length > 0
  }
}
