/**
 * Built-in harness templates (workstation contracts §5, Phase 1 step 6).
 *
 * Phase 1 ships exactly one template: 'test-fixer'. The Phase 2 wizard edits
 * frontmatter; Phase 1 materializes these defaults verbatim.
 *
 * `<dir>` inside scope globs is a placeholder for the harness's own
 * workspace-root-relative directory (`<TE_DIR>/agents/<slug>`) — substituted
 * at create time by `materializeScope`, because the slug and runtime TE_DIR
 * are not known until then.
 */
import { HARNESS_PROTECTED_GLOBS, type HarnessAdapter, type HarnessScope } from './harness-types'

export interface HarnessTemplate {
  readonly id: string
  readonly description: string
  readonly adapter: HarnessAdapter
  readonly permissionMode: 'queue-all-writes'
  readonly budgets: { readonly maxTurns: number; readonly maxWritesPerMinute: number }
  /** SKILL.md body (below the frontmatter): the numbered procedure. */
  readonly skillBody: string
  /** rules.md contents: one rule per line item, severity-tagged. */
  readonly rules: string
  /** scope.json contents, with `<dir>` placeholders (see module doc). */
  readonly scope: HarnessScope
  /** verify.sh contents. Written last, mode 0o555, never agent-writable. */
  readonly verifySh: string
  /** Initial state.md contents (repo memory, prompt-composition only in Phase 1). */
  readonly initialState: string
}

const TEST_FIXER: HarnessTemplate = {
  id: 'test-fixer',
  description: 'Runs the test suite, fixes the first failure, stops.',
  adapter: 'claude',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 10, maxWritesPerMinute: 10 },
  skillBody: [
    'Fix exactly one failing test, verify the fix, and stop.',
    '',
    '1. Run the test suite (`npm test`) and read the output.',
    '2. If every test passes, report "all tests passing" and stop — do not invent work.',
    '3. Identify the FIRST failing test in the output. Ignore the rest for this run.',
    '4. Read the failing test and the code under test. Diagnose the root cause before editing.',
    '5. Make the smallest change that fixes the root cause. Fix the code under test unless the test itself is provably wrong; say which you changed and why.',
    '6. Run the verification gate (see the Verification section of your instructions) and report its full output.',
    '7. Summarize: the failure, the root cause, the fix, and the verification result. Then stop — one failure per run.'
  ].join('\n'),
  rules: [
    '- [critical] Never edit, chmod, or delete verify.sh or rules.md in any .machina/agents/ or .machina-dev/agents/ directory.',
    '- [critical] Never run destructive git commands (reset --hard, clean -f, push --force) or rewrite history.',
    '- [critical] Never touch files matching the forbiddenGlobs in scope.json (.git internals, .env files, harness gate files).',
    '- [major] Stay inside the allowedGlobs in scope.json: source, tests, and your own state.md/handoffs.',
    '- [major] Fix one failing test per run. Do not batch fixes or refactor beyond the failure.',
    '- [major] Do not add, remove, or upgrade dependencies.',
    '- [minor] Do not reformat code you did not change.',
    '- [minor] Record what you learned about this repository in state.md before stopping.'
  ].join('\n'),
  scope: {
    goal: 'Make the failing test pass without breaking any other test.',
    allowedGlobs: ['src/**', 'tests/**', '<dir>/state.md', '<dir>/handoffs/**'],
    forbiddenGlobs: [...HARNESS_PROTECTED_GLOBS, '.git/**', '.env*'],
    acceptance: 'verify.sh exits 0 (the full test suite passes).',
    rollback:
      'Reject the pending change in the approvals tray, or revert the agent commits by their Machina-Agent trailer.'
  },
  verifySh: ['#!/bin/sh', 'set -e', 'cd "$(dirname "$0")/../../.."', 'npm test', ''].join('\n'),
  initialState: [
    '# Repo memory',
    '',
    'No runs recorded yet. Append what you learn about this repository',
    '(test layout, flaky suites, build quirks) at the end of each run.',
    ''
  ].join('\n')
}

export const HARNESS_TEMPLATES: Readonly<Record<string, HarnessTemplate>> = {
  'test-fixer': TEST_FIXER
}

/**
 * Materialize a template's scope contract for a concrete harness instance:
 * `<dir>` placeholders become the workspace-root-relative harness directory.
 * forbiddenGlobs carry no placeholders — they are the dual-variant protected
 * literals plus template extras, verbatim.
 */
export function materializeScope(template: HarnessTemplate, harnessDir: string): HarnessScope {
  return {
    ...template.scope,
    allowedGlobs: template.scope.allowedGlobs.map((glob) => glob.replace('<dir>', harnessDir))
  }
}

/** SKILL.md frontmatter block for a harness instance (contracts §5 defaults). */
export function frontmatterFor(template: HarnessTemplate, slug: string): string {
  return [
    '---',
    `name: ${slug}`,
    `description: ${template.description}`,
    `adapter: ${template.adapter}`,
    `permissionMode: ${template.permissionMode} # immutable default (Q9)`,
    `budgets: { maxTurns: ${template.budgets.maxTurns}, maxWritesPerMinute: ${template.budgets.maxWritesPerMinute} }`,
    '---',
    ''
  ].join('\n')
}
