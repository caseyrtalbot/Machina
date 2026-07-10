/**
 * Pure Step 8 harness draft assembly.
 *
 * Renderer preview and main creation pass the same request through this
 * function. Main still reconstructs the draft itself and never trusts
 * renderer-materialized files. No filesystem, Electron, or React imports.
 */
import { HARNESS_PROTECTED_GLOBS } from './constants'
import { validateRawInvocationTemplate } from './agent-adapters'
import { hasLintErrors, lintHarness, type Diagnostic } from './harness-lint'
import {
  isReservedHarnessSlug,
  isHarnessAdapter,
  isValidHarnessSlug,
  parseHarnessFrontmatter,
  serializeHarnessFrontmatter,
  validateHarnessBudgets,
  validateHarnessScopeContract,
  validateHarnessScope,
  type HarnessCreateRequest,
  type HarnessDraft,
  type HarnessFrontmatter,
  type HarnessMaterializedFiles,
  type HarnessOverrides,
  type HarnessScope,
  type HarnessTemplate
} from './harness-types'
import { HARNESS_TEMPLATES, materializeHarnessScope } from './harness-templates'

export type HarnessDraftBuildResult =
  | {
      readonly ok: true
      readonly draft: HarnessDraft
      readonly files: HarnessMaterializedFiles
      readonly diagnostics: readonly Diagnostic[]
    }
  | {
      readonly ok: false
      readonly error: string
      readonly diagnostics: readonly Diagnostic[]
      readonly draft?: HarnessDraft
      readonly files?: HarnessMaterializedFiles
    }

function fail(error: string): HarnessDraftBuildResult {
  return { ok: false, error, diagnostics: [] }
}

const CREATE_REQUEST_KEYS = new Set(['template', 'slug', 'overrides'])
const HARNESS_OVERRIDE_KEYS = new Set([
  'description',
  'adapter',
  'budgets',
  'invocationTemplate',
  'skillBody',
  'rules',
  'scope',
  'verifyCommand',
  'initialState'
])

function unknownKeys(value: object, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key))
}

function validateRuntimeRequest(request: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return { ok: false, error: 'harness create request must be an object' }
  }
  const unknownRequestKeys = unknownKeys(request, CREATE_REQUEST_KEYS)
  if (unknownRequestKeys.length > 0) {
    return {
      ok: false,
      error: `unknown harness create request field(s): ${unknownRequestKeys.join(', ')}`
    }
  }
  const candidate = request as Record<string, unknown>
  if (typeof candidate.slug !== 'string') {
    return { ok: false, error: 'harness slug must be a string' }
  }
  if (hasOwn(candidate, 'template') && typeof candidate.template !== 'string') {
    return { ok: false, error: 'template must be a string when present' }
  }
  const overrides = candidate.overrides
  if (!hasOwn(candidate, 'overrides')) return { ok: true }
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return { ok: false, error: 'harness overrides must be an object' }
  }
  const unknownOverrideKeys = unknownKeys(overrides, HARNESS_OVERRIDE_KEYS)
  if (unknownOverrideKeys.length > 0) {
    return {
      ok: false,
      error: `unknown harness override field(s): ${unknownOverrideKeys.join(', ')}`
    }
  }
  const runtimeError = validateOverrideRuntimeFields(overrides as Record<string, unknown>)
  if (runtimeError !== null) return { ok: false, error: runtimeError }
  return { ok: true }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function unionProtectedGlobs(scope: HarnessScope): HarnessScope {
  return {
    ...scope,
    forbiddenGlobs: [...new Set([...scope.forbiddenGlobs, ...HARNESS_PROTECTED_GLOBS])]
  }
}

function verifyScriptForCommand(command: string): string {
  return ['#!/bin/sh', 'set -eu', 'cd "$(dirname "$0")/../../.."', command, ''].join('\n')
}

function validateVerifyCommand(command: unknown): { ok: true } | { ok: false; error: string } {
  if (!isNonEmptyString(command)) return { ok: false, error: 'verifyCommand is required' }
  if (command.includes('\0') || /[\r\n]/.test(command)) {
    return { ok: false, error: 'verifyCommand must be a single line without NUL bytes' }
  }
  // The generated wrapper uses portable POSIX `set -eu`, which cannot make a
  // pipeline or command list reliably propagate an earlier failure. Permit
  // `&&` (every gate must pass), but reject constructs that can turn a red
  // command into a green final status or execute hidden substitutions.
  if (
    command.includes('|') ||
    command.includes(';') ||
    command.includes('`') ||
    command.includes('$(') ||
    /(^|[^&])&([^&]|$)/.test(command) ||
    /(^|&&)[\t ]*!(?=[\t ]|$)/.test(command.trim())
  ) {
    return {
      ok: false,
      error:
        'verifyCommand must not use pipelines, command lists, background jobs, or command substitution; join required gates with &&'
    }
  }
  return { ok: true }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function validateOverrideRuntimeFields(overrides: Record<string, unknown>): string | null {
  const stringFields = [
    'description',
    'invocationTemplate',
    'skillBody',
    'rules',
    'verifyCommand',
    'initialState'
  ] as const
  for (const key of stringFields) {
    if (hasOwn(overrides, key) && typeof overrides[key] !== 'string') {
      return `${key} must be a string when present`
    }
  }
  if (hasOwn(overrides, 'adapter') && !isHarnessAdapter(overrides.adapter)) {
    return 'adapter must name a supported harness adapter when present'
  }
  if (hasOwn(overrides, 'budgets')) {
    const checked = validateHarnessBudgets(overrides.budgets)
    if (!checked.ok) return checked.error
  }
  if (hasOwn(overrides, 'scope')) {
    const checked = validateHarnessScopeContract(overrides.scope)
    if (!checked.ok) return checked.error
  }
  return null
}

function frontmatterEquals(a: HarnessFrontmatter, b: HarnessFrontmatter): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.adapter === b.adapter &&
    a.permissionMode === b.permissionMode &&
    a.budgets.maxTurns === b.budgets.maxTurns &&
    a.budgets.maxWritesPerMinute === b.budgets.maxWritesPerMinute &&
    a.invocationTemplate === b.invocationTemplate
  )
}

function requireConfigOverrides(
  template: HarnessTemplate,
  overrides: HarnessOverrides | undefined
): string | null {
  if (!template.requiresConfiguration) return null
  const missing = (['invocationTemplate', 'scope', 'verifyCommand'] as const).filter(
    (key) => overrides === undefined || !hasOwn(overrides, key)
  )
  if (missing.length > 0) {
    return `template "${template.id}" requires configuration: ${missing.join(', ')}`
  }
  const suppliedScope = overrides?.scope
  if (suppliedScope !== undefined && suppliedScope.goal.trim() === template.scope.goal.trim()) {
    return `template "${template.id}" requires a deliberate concrete scope goal`
  }
  return null
}

/**
 * Build the exact candidate files for preview or creation.
 *
 * Merge precedence is field-atomic: a present override replaces the complete
 * template field; absent fields inherit. `overrides !== undefined`, including
 * `{}`, is the caller-intent signal that constructively unions protected globs.
 * Template-only requests retain refuse-to-emit semantics and are never repaired.
 */
export function buildHarnessDraft(
  request: HarnessCreateRequest,
  harnessDir: string
): HarnessDraftBuildResult {
  const runtimeCheck = validateRuntimeRequest(request)
  if (!runtimeCheck.ok) return fail(runtimeCheck.error)
  if (!isValidHarnessSlug(request.slug)) {
    return fail(`invalid harness slug: ${JSON.stringify(request.slug)}`)
  }
  if (isReservedHarnessSlug(request.slug)) {
    return fail(`harness slug collides with an adapter identity (reserved): ${request.slug}`)
  }

  const template = request.template === undefined ? undefined : HARNESS_TEMPLATES[request.template]
  if (request.template !== undefined && template === undefined) {
    return fail(`unknown harness template: ${JSON.stringify(request.template)}`)
  }
  const overrides = request.overrides as HarnessOverrides | undefined
  if (template === undefined && overrides === undefined) {
    return fail('blank harness creation requires complete overrides')
  }
  if (template !== undefined) {
    const configError = requireConfigOverrides(template, overrides)
    if (configError !== null) return fail(configError)
  }

  const description =
    overrides !== undefined && hasOwn(overrides, 'description')
      ? overrides.description
      : template?.description
  const adapter =
    overrides !== undefined && hasOwn(overrides, 'adapter') ? overrides.adapter : template?.adapter
  const budgets =
    overrides !== undefined && hasOwn(overrides, 'budgets') ? overrides.budgets : template?.budgets
  const invocationTemplate =
    overrides !== undefined && hasOwn(overrides, 'invocationTemplate')
      ? overrides.invocationTemplate
      : template?.invocationTemplate
  const skillBody =
    overrides !== undefined && hasOwn(overrides, 'skillBody')
      ? overrides.skillBody
      : template?.skillBody
  const rules =
    overrides !== undefined && hasOwn(overrides, 'rules') ? overrides.rules : template?.rules
  const rawScope =
    overrides !== undefined && hasOwn(overrides, 'scope') ? overrides.scope : template?.scope
  const initialState =
    overrides !== undefined && hasOwn(overrides, 'initialState')
      ? overrides.initialState
      : (template?.initialState ??
        '# Repo memory\n\nNo runs recorded yet. Append durable repository facts here.\n')

  if (!isNonEmptyString(description)) return fail('description is required')
  if (adapter === undefined) return fail('adapter is required')
  if (budgets === undefined) return fail('budgets are required')
  const budgetCheck = validateHarnessBudgets(budgets)
  if (!budgetCheck.ok) return fail(budgetCheck.error)
  if (!isNonEmptyString(skillBody)) return fail('skillBody is required')
  if (!isNonEmptyString(rules)) return fail('rules are required')
  const scopeShape = validateHarnessScopeContract(rawScope)
  if (!scopeShape.ok) return fail(scopeShape.error)
  if (!isNonEmptyString(initialState)) return fail('initialState must not be empty')

  let verifySh: string | undefined
  if (overrides?.verifyCommand !== undefined) {
    const verifyCheck = validateVerifyCommand(overrides.verifyCommand)
    if (!verifyCheck.ok) return fail(verifyCheck.error)
    verifySh = verifyScriptForCommand(overrides.verifyCommand)
  } else {
    verifySh = template?.verifySh
  }
  if (!isNonEmptyString(verifySh)) return fail('verifyCommand is required')

  if (adapter === 'raw') {
    const rawCheck = validateRawInvocationTemplate(invocationTemplate)
    if (!rawCheck.ok) return fail(rawCheck.error)
  } else if (invocationTemplate !== undefined) {
    return fail('invocationTemplate is only valid for raw adapter')
  }

  const callerSuppliedOverrides = request.overrides !== undefined
  const mergedScope = callerSuppliedOverrides
    ? unionProtectedGlobs(scopeShape.value)
    : scopeShape.value
  const scope = materializeHarnessScope(mergedScope, harnessDir)
  const scopeCheck = validateHarnessScope(scope)
  if (!scopeCheck.ok) return fail(scopeCheck.error)

  const frontmatter: HarnessFrontmatter = {
    name: request.slug,
    description,
    adapter,
    permissionMode: 'queue-all-writes',
    budgets,
    ...(invocationTemplate !== undefined ? { invocationTemplate } : {})
  }
  const serializedFrontmatter = serializeHarnessFrontmatter(frontmatter)
  const reparsed = parseHarnessFrontmatter(serializedFrontmatter)
  if (!reparsed.ok) return fail(`frontmatter round-trip failed: ${reparsed.error}`)
  if (!frontmatterEquals(frontmatter, reparsed.value)) {
    return fail('frontmatter round-trip changed a user-supplied value')
  }

  const draft: HarnessDraft = {
    ...(template !== undefined ? { templateId: template.id } : {}),
    slug: request.slug,
    description,
    adapter,
    permissionMode: 'queue-all-writes',
    budgets,
    ...(invocationTemplate !== undefined ? { invocationTemplate } : {}),
    skillBody,
    rules,
    scope,
    verifySh,
    initialState
  }
  const files: HarnessMaterializedFiles = {
    skillMd: `${serializedFrontmatter}\n${skillBody}\n`,
    rulesMd: rules.endsWith('\n') ? rules : `${rules}\n`,
    scopeJson: `${JSON.stringify(scope, null, 2)}\n`,
    stateMd: initialState.endsWith('\n') ? initialState : `${initialState}\n`,
    verifySh
  }
  const diagnostics = lintHarness({
    slug: request.slug,
    skillMd: files.skillMd,
    rulesMd: files.rulesMd,
    scopeJson: files.scopeJson,
    verifySh: files.verifySh
  })
  if (hasLintErrors(diagnostics)) {
    const first = diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    return {
      ok: false,
      error: `harness draft has blocking diagnostics: ${first?.message ?? 'unknown error'}`,
      diagnostics,
      draft,
      files
    }
  }
  return { ok: true, draft, files, diagnostics }
}
