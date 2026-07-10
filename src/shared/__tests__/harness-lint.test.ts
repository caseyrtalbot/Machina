/**
 * Pure lint table (workstation step 7, contracts v1.2.4): one case per
 * check, headlined by the Phase-2 exit-bar case — a scope.json with
 * HARNESS_PROTECTED_GLOBS stripped must produce an error diagnostic.
 */
import { describe, it, expect } from 'vitest'
import { hasLintErrors, lintHarness, type Diagnostic } from '../harness-lint'
import { HARNESS_PROTECTED_GLOBS } from '../harness-types'
import { frontmatterFor, HARNESS_TEMPLATES, materializeScope } from '../harness-templates'

const TEMPLATE = HARNESS_TEMPLATES['test-fixer']
const DIR = '.machina/agents/test-fixer'

/** File contents exactly as createHarness materializes them. */
function cleanInput(slug = 'test-fixer') {
  return {
    slug,
    skillMd: frontmatterFor(TEMPLATE, slug) + '\n' + TEMPLATE.skillBody + '\n',
    rulesMd: TEMPLATE.rules + '\n',
    scopeJson: JSON.stringify(materializeScope(TEMPLATE, DIR), null, 2) + '\n',
    verifySh: TEMPLATE.verifySh
  }
}

const codes = (diags: readonly Diagnostic[]): string[] => diags.map((d) => d.code)

describe('lintHarness', () => {
  it('a freshly-materialized template harness lints clean', () => {
    expect(lintHarness(cleanInput())).toEqual([])
  })

  it('EXIT BAR: scope.json with HARNESS_PROTECTED_GLOBS stripped ⇒ error diagnostic', () => {
    const scope = materializeScope(TEMPLATE, DIR)
    const stripped = {
      ...scope,
      forbiddenGlobs: scope.forbiddenGlobs.filter(
        (g) => !(HARNESS_PROTECTED_GLOBS as readonly string[]).includes(g)
      )
    }
    const diags = lintHarness({ ...cleanInput(), scopeJson: JSON.stringify(stripped) })
    const finding = diags.find((d) => d.code === 'scope-protected-globs')
    expect(finding).toBeDefined()
    expect(finding).toMatchObject({ severity: 'error', file: 'scope.json' })
    expect(finding!.message).toContain('missing protected forbiddenGlobs')
    expect(hasLintErrors(diags)).toBe(true)
  })

  it('stripping even ONE protected glob is an error (superset, not any-of)', () => {
    const scope = materializeScope(TEMPLATE, DIR)
    const stripped = {
      ...scope,
      forbiddenGlobs: scope.forbiddenGlobs.filter((g) => g !== HARNESS_PROTECTED_GLOBS[0])
    }
    const diags = lintHarness({ ...cleanInput(), scopeJson: JSON.stringify(stripped) })
    expect(codes(diags)).toContain('scope-protected-globs')
  })

  it('unparseable scope.json ⇒ error with the parse reason', () => {
    const diags = lintHarness({ ...cleanInput(), scopeJson: '{ not json' })
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'error',
      code: 'scope-unparseable',
      file: 'scope.json'
    })
  })

  it('scope.json that parses but is not a scope contract ⇒ error', () => {
    for (const bad of ['null', '[]', '"scope"', '{"allowedGlobs": "src/**"}']) {
      const diags = lintHarness({ ...cleanInput(), scopeJson: bad })
      expect(codes(diags)).toContain('scope-unparseable')
    }
  })

  it('scope.json missing a required scalar field (rollback) ⇒ error naming it', () => {
    const scope = materializeScope(TEMPLATE, DIR) as unknown as Record<string, unknown>
    delete scope.rollback
    const diags = lintHarness({ ...cleanInput(), scopeJson: JSON.stringify(scope) })
    const finding = diags.find((d) => d.code === 'scope-fields')
    expect(finding).toMatchObject({ severity: 'error', file: 'scope.json' })
    expect(finding!.message).toContain('rollback')
    expect(hasLintErrors(diags)).toBe(true)
  })

  it('blank scope scalar fields are blocking errors', () => {
    for (const field of ['goal', 'acceptance', 'rollback'] as const) {
      const scope = { ...materializeScope(TEMPLATE, DIR), [field]: '   ' }
      const diags = lintHarness({ ...cleanInput(), scopeJson: JSON.stringify(scope) })
      expect(diags).toContainEqual(
        expect.objectContaining({ severity: 'error', code: 'scope-fields', file: 'scope.json' })
      )
    }
  })

  it('<dir> placeholder leaked into materialized scope globs ⇒ warning naming the globs', () => {
    const scope = {
      ...materializeScope(TEMPLATE, DIR),
      allowedGlobs: ['src/**', '<dir>/state.md']
    }
    const diags = lintHarness({ ...cleanInput(), scopeJson: JSON.stringify(scope) })
    const finding = diags.find((d) => d.code === 'scope-placeholder')
    expect(finding).toMatchObject({ severity: 'warning', file: 'scope.json' })
    expect(finding!.message).toContain('<dir>/state.md')
  })

  it('rules.md line without the "- [severity] text" tag ⇒ warning naming the first bad line', () => {
    const diags = lintHarness({
      ...cleanInput(),
      rulesMd: '- [critical] Fine rule.\nNever do bad things (untagged)\n- also untagged\n'
    })
    const finding = diags.find((d) => d.code === 'rules-format')
    expect(finding).toMatchObject({ severity: 'warning', file: 'rules.md' })
    expect(finding!.message).toContain('2 rules.md line(s)')
    expect(finding!.message).toContain('Never do bad things')
  })

  it('unreadable frontmatter ⇒ error carrying the parser reason', () => {
    const diags = lintHarness({ ...cleanInput(), skillMd: 'no frontmatter here' })
    const finding = diags.find((d) => d.code === 'frontmatter-invalid')
    expect(finding).toMatchObject({ severity: 'error', file: 'SKILL.md' })
    expect(finding!.message).toContain('missing frontmatter block')
  })

  it('frontmatter name vs directory slug mismatch ⇒ warning', () => {
    // Frontmatter written for one slug, sitting in another slug's directory.
    const diags = lintHarness({
      ...cleanInput(),
      skillMd: frontmatterFor(TEMPLATE, 'renamed-fixer') + '\n' + TEMPLATE.skillBody + '\n'
    })
    const finding = diags.find((d) => d.code === 'name-mismatch')
    expect(finding).toMatchObject({ severity: 'warning', file: 'SKILL.md' })
    expect(finding!.message).toContain('renamed-fixer')
    // Display-only field: a mismatch alone never disables run.
    expect(hasLintErrors(diags)).toBe(false)
  })

  it('empty skill body and rules are blocking errors', () => {
    const frontmatterOnly = frontmatterFor(TEMPLATE, 'test-fixer')
    expect(lintHarness({ ...cleanInput(), skillMd: frontmatterOnly })).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'skill-body-empty' })
    )
    expect(lintHarness({ ...cleanInput(), rulesMd: ' \n' })).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'rules-empty' })
    )
  })

  it('empty or shebang-less verify.sh is a blocking error', () => {
    expect(lintHarness({ ...cleanInput(), verifySh: '' })).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'verify-empty', file: 'verify.sh' })
    )
    const diags = lintHarness({ ...cleanInput(), verifySh: 'npm test\n' })
    expect(diags).toEqual([
      expect.objectContaining({ severity: 'error', code: 'verify-shebang', file: 'verify.sh' })
    ])
  })

  it('omitted files lint clean — presence is the main-side fs lints’ job', () => {
    expect(lintHarness({ slug: 'test-fixer' })).toEqual([])
  })
})
