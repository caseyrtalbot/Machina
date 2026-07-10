import type { HarnessTemplate } from '../harness-types'
import {
  BASE_FORBIDDEN_GLOBS,
  DEFAULT_ROLLBACK,
  HARNESS_MEMORY_GLOBS,
  NO_CODE_FORBIDDEN_GLOBS,
  artifactVerifierScript,
  initialStateFor,
  rulesFor
} from './common'

const IDEA_TO_SPEC: HarnessTemplate = {
  id: 'idea-to-spec',
  label: 'Idea to spec',
  category: 'Guided',
  audience: ['non-engineer', 'low-code-user'],
  description: 'Turns a plain-language product idea into one buildable requirements brief.',
  adapter: 'claude',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 4, maxWritesPerMinute: 2 },
  requiresConfiguration: false,
  skillBody: [
    'Turn one product idea into a concise implementation-ready specification.',
    '',
    '1. Restate the user and the outcome in plain language.',
    '2. Inspect only enough repository context to use its real terms and constraints.',
    '3. Write one document under docs/specs/ with users, scope, acceptance criteria, constraints, and open questions.',
    '4. Do not edit source code, tests, configuration, or dependency files.',
    '5. Run the verification gate, summarize the document, and stop.'
  ].join('\n'),
  rules: rulesFor(
    '- [major] Produce exactly one requirements brief and do not implement it.',
    '- [major] Mark assumptions and unresolved choices explicitly instead of inventing decisions.'
  ),
  scope: {
    goal: 'Produce one evidence-grounded, buildable requirements brief.',
    allowedGlobs: ['docs/specs/**', ...HARNESS_MEMORY_GLOBS],
    forbiddenGlobs: [...NO_CODE_FORBIDDEN_GLOBS],
    acceptance:
      'One non-empty spec states users, scope, acceptance criteria, constraints, and open questions.',
    rollback: DEFAULT_ROLLBACK
  },
  verifySh: artifactVerifierScript({
    requirements: [
      {
        label: 'requirements brief',
        pathspecs: ['docs/specs'],
        minNonEmpty: 1,
        maxNonEmpty: 1,
        patterns: [
          { regex: '(^|[^[:alpha:]])users?([^[:alpha:]]|$)', description: 'the users' },
          { regex: '(^|[^[:alpha:]])scope([^[:alpha:]]|$)', description: 'scope' },
          {
            regex: 'acceptance([[:space:]]+criteria)?',
            description: 'acceptance criteria'
          },
          { regex: 'constraints?', description: 'constraints' },
          { regex: 'open[[:space:]]+questions?', description: 'open questions' }
        ]
      }
    ]
  }),
  initialState: initialStateFor('idea-to-spec')
}

const DOCS_MAINTAINER: HarnessTemplate = {
  id: 'docs-maintainer',
  label: 'Docs maintainer',
  category: 'Guided',
  audience: ['non-engineer', 'low-code-user', 'seasoned-programmer'],
  description: 'Reconciles one documentation gap against current repository evidence.',
  adapter: 'claude',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 6, maxWritesPerMinute: 4 },
  requiresConfiguration: false,
  skillBody: [
    'Repair one named documentation gap without changing product behavior.',
    '',
    '1. Locate the source-of-truth code, tests, or configuration for the claim.',
    '2. Identify exactly what the current documentation gets wrong or omits.',
    '3. Edit only README markdown or files under docs/.',
    '4. Check links and examples against the repository; never fabricate commands or results.',
    '5. Run the verification gate, report the reconciled claim, and stop.'
  ].join('\n'),
  rules: rulesFor(
    '- [major] Change documentation only; never make code agree with stale prose.',
    '- [major] Finish one coherent documentation gap per run.'
  ),
  scope: {
    goal: 'Make one documentation surface accurately describe the current repository.',
    allowedGlobs: ['README*.md', 'docs/**', ...HARNESS_MEMORY_GLOBS],
    forbiddenGlobs: [...NO_CODE_FORBIDDEN_GLOBS],
    acceptance:
      'The named documentation gap is corrected and markdown has no diff whitespace errors.',
    rollback: DEFAULT_ROLLBACK
  },
  verifySh: artifactVerifierScript({
    requirements: [
      {
        label: 'documentation',
        pathspecs: [':(glob)README*.md', 'docs'],
        minNonEmpty: 1
      }
    ]
  }),
  initialState: initialStateFor('documentation')
}

const AUTOMATION_BUILDER: HarnessTemplate = {
  id: 'automation-builder',
  label: 'Automation builder',
  category: 'Guided',
  audience: ['low-code-user', 'seasoned-programmer'],
  description: 'Builds one transparent shell or Make automation with a short runbook.',
  adapter: 'codex',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 8, maxWritesPerMinute: 6 },
  requiresConfiguration: false,
  skillBody: [
    'Build one small, reviewable repository automation.',
    '',
    '1. Confirm the manual workflow and its inputs, outputs, and failure behavior.',
    '2. Implement it under scripts/ or as a Makefile target without adding dependencies.',
    '3. Add or update one concise runbook under docs/runbooks/.',
    '4. Exercise only through a dry run or an isolated disposable fixture. If neither is safe, ask the operator for explicit confirmation and stop until it is given.',
    '5. Run the verification gate, report usage, and stop.'
  ].join('\n'),
  rules: rulesFor(
    '- [critical] Never execute generated automation against live data or systems without explicit operator confirmation.',
    '- [major] Build exactly one automation and keep every destructive operation opt-in.',
    '- [major] Do not edit application source, tests, package manifests, or lockfiles.'
  ),
  scope: {
    goal: 'Replace one repetitive manual workflow with a transparent repository automation.',
    allowedGlobs: ['scripts/**', 'Makefile', 'docs/runbooks/**', ...HARNESS_MEMORY_GLOBS],
    forbiddenGlobs: [
      ...BASE_FORBIDDEN_GLOBS,
      'src/**',
      'test/**',
      'tests/**',
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock'
    ],
    acceptance: 'The automation is syntax-valid, documented, and demonstrates its narrow workflow.',
    rollback: DEFAULT_ROLLBACK
  },
  verifySh: artifactVerifierScript({
    requirements: [
      {
        label: 'automation implementation',
        pathspecs: ['scripts', 'Makefile'],
        minNonEmpty: 1
      },
      {
        label: 'automation runbook',
        pathspecs: ['docs/runbooks'],
        minNonEmpty: 1,
        patterns: [
          { regex: '(^|[^[:alpha:]])usage([^[:alpha:]]|$)', description: 'usage instructions' },
          {
            regex: 'fail(ure|ures|ing)?',
            description: 'failure behavior'
          }
        ]
      }
    ],
    shellSyntaxPathspecs: [':(glob)scripts/*.sh', ':(glob)scripts/**/*.sh']
  }),
  initialState: initialStateFor('automation')
}

export const GUIDED_TEMPLATES = [IDEA_TO_SPEC, DOCS_MAINTAINER, AUTOMATION_BUILDER] as const
