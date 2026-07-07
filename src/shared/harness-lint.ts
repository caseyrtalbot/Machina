/**
 * Harness linter — pure content lints (workstation contracts §5, Phase 2
 * step 7, v1.2.4).
 *
 * The linter's job is everything create-time validation cannot see:
 * scope.json is never re-validated after create (a hand-edit can strip
 * HARNESS_PROTECTED_GLOBS undetected), and malformed harnesses used to
 * vanish from the palette silently. `lintHarness` checks CONTENT it is
 * handed — missing/unreadable files and filesystem facts (verify.sh mode,
 * handoffs/ presence, symlink ancestry) are main-side lints in
 * harness-service.ts, which COMPOSES these shared checks with its fs checks
 * and never reimplements one.
 *
 * Pure and dependency-free: renderer-importable (step 8's wizard previews
 * diagnostics on a would-be harness) and table-testable.
 *
 * Diagnostic is deliberately minimal — { severity, code, message, file },
 * two severities only. Severity-taxonomy creep is the classic linter
 * failure mode; grow this contract only through a contracts amendment.
 */
import { parseHarnessFrontmatter, validateHarnessScope, type HarnessScope } from './harness-types'

export const DIAGNOSTIC_SEVERITIES = ['error', 'warning'] as const
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number]

export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  readonly code: string
  readonly message: string
  /** Harness-dir-relative file the finding anchors to; `.` = the dir itself. */
  readonly file: string
}

/** True when any diagnostic is error severity — the run-disable predicate. */
export function hasLintErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}

/**
 * File CONTENTS of one harness. `undefined` = missing or unreadable — those
 * are flagged by the main-side presence lints, not here, so a partial input
 * (e.g. the step-8 wizard previewing only a scope draft) lints cleanly on
 * the files it omits.
 */
export interface HarnessLintInput {
  readonly slug: string
  readonly skillMd?: string
  readonly rulesMd?: string
  readonly scopeJson?: string
  readonly verifySh?: string
}

/** The `- [severity] text` convention rules.md lines carry (contracts §5). */
const RULE_LINE_RE = /^- \[[a-z]+\] \S/

export function lintHarness(input: HarnessLintInput): Diagnostic[] {
  const out: Diagnostic[] = []

  if (input.skillMd !== undefined) {
    const parsed = parseHarnessFrontmatter(input.skillMd)
    if (!parsed.ok) {
      // Surface the parser's reason verbatim — "skipped" without a why is
      // exactly the silent vanishing this step retires.
      out.push({
        severity: 'error',
        code: 'frontmatter-invalid',
        message: `SKILL.md frontmatter unreadable: ${parsed.error}`,
        file: 'SKILL.md'
      })
    } else if (parsed.value.name !== input.slug) {
      // name is display-only (v1.2.2 demoted it from attribution), so a
      // mismatch is a tamper/drift signal, not a broken run.
      out.push({
        severity: 'warning',
        code: 'name-mismatch',
        message: `frontmatter name "${parsed.value.name}" does not match directory slug "${input.slug}"`,
        file: 'SKILL.md'
      })
    }
  }

  if (input.rulesMd !== undefined) {
    const badLines = input.rulesMd
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !RULE_LINE_RE.test(line))
    if (badLines.length > 0) {
      out.push({
        severity: 'warning',
        code: 'rules-format',
        message: `${badLines.length} rules.md line(s) missing the "- [severity] text" tag format (first: ${JSON.stringify(badLines[0])})`,
        file: 'rules.md'
      })
    }
  }

  if (input.scopeJson !== undefined) {
    out.push(...lintScope(input.scopeJson))
  }

  if (input.verifySh !== undefined && !input.verifySh.startsWith('#!')) {
    out.push({
      severity: 'warning',
      code: 'verify-shebang',
      message: 'verify.sh does not start with a shebang line',
      file: 'verify.sh'
    })
  }

  return out
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function lintScope(scopeJson: string): Diagnostic[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(scopeJson)
  } catch (err) {
    return [
      {
        severity: 'error',
        code: 'scope-unparseable',
        message: `scope.json is not valid JSON: ${String(err)}`,
        file: 'scope.json'
      }
    ]
  }
  const scope = parsed as Partial<HarnessScope> | null
  if (
    scope === null ||
    typeof scope !== 'object' ||
    !isStringArray(scope.allowedGlobs) ||
    !isStringArray(scope.forbiddenGlobs)
  ) {
    return [
      {
        severity: 'error',
        code: 'scope-unparseable',
        message: 'scope.json is not a scope contract object (allowedGlobs/forbiddenGlobs missing)',
        file: 'scope.json'
      }
    ]
  }

  const out: Diagnostic[] = []

  // Required scalar fields: a hand-edit that guts goal/acceptance/rollback
  // leaves allowedGlobs/forbiddenGlobs intact (so the structural guard above
  // passes) yet composes a broken first-turn prompt. The create-time cast never
  // re-checked these; the lint does.
  const missingFields = (['goal', 'acceptance', 'rollback'] as const).filter(
    (key) => typeof scope[key] !== 'string'
  )
  if (missingFields.length > 0) {
    out.push({
      severity: 'error',
      code: 'scope-fields',
      message: `scope.json is missing required string field(s): ${missingFields.join(', ')}`,
      file: 'scope.json'
    })
  }

  // The exit-bar check: re-run the create-time superset validation on the
  // on-disk contract. Reuses validateHarnessScope — never reimplemented.
  // validateHarnessScope consults only forbiddenGlobs (validated above), so the
  // argument is built from the validated arrays plus empty placeholders for the
  // fields it never reads — no unsound `as HarnessScope` cast smuggling
  // unchecked shapes past the compiler.
  const supersetCheck = validateHarnessScope({
    goal: '',
    acceptance: '',
    rollback: '',
    allowedGlobs: scope.allowedGlobs,
    forbiddenGlobs: scope.forbiddenGlobs
  })
  if (!supersetCheck.ok) {
    out.push({
      severity: 'error',
      code: 'scope-protected-globs',
      message: supersetCheck.error,
      file: 'scope.json'
    })
  }

  // A `<dir>` placeholder in a materialized scope means the contract on disk
  // was never materialized (hand-restored template, or a create-path bug).
  // Warning, not error: containment is unaffected — the watcher auto-reject
  // matches HARNESS_PROTECTED_GLOBS literals, not scope.json.
  const leaked = [...scope.allowedGlobs, ...scope.forbiddenGlobs].filter((glob) =>
    glob.includes('<dir>')
  )
  if (leaked.length > 0) {
    out.push({
      severity: 'warning',
      code: 'scope-placeholder',
      message: `unmaterialized <dir> placeholder in scope globs: ${leaked.join(', ')}`,
      file: 'scope.json'
    })
  }

  return out
}
