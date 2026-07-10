import type { HarnessTemplate } from '../harness-types'
import {
  DEFAULT_ROLLBACK,
  HARNESS_MEMORY_GLOBS,
  NO_CODE_FORBIDDEN_GLOBS,
  artifactVerifierScript,
  harnessLocalArtifactVerifierScript,
  initialStateFor,
  rulesFor
} from './common'

const ARCHITECTURE_MAPPER: HarnessTemplate = {
  id: 'architecture-mapper',
  label: 'Architecture mapper',
  category: 'Architecture',
  audience: ['systems-thinker', 'architect', 'seasoned-programmer'],
  description: 'Maps one current system slice with evidence-linked boundaries and flows.',
  adapter: 'claude',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 6, maxWritesPerMinute: 3 },
  requiresConfiguration: false,
  skillBody: [
    'Document one current architecture slice as it exists on disk.',
    '',
    '1. Identify the entry point, owners, state, boundaries, and downstream consumers.',
    '2. Trace important values or events end to end with file references.',
    '3. Write one map under docs/architecture/ using prose and a Mermaid diagram when useful.',
    '4. Separate verified behavior, inference, and unknowns.',
    '5. Run the verification gate and stop without proposing an implementation.'
  ].join('\n'),
  rules: rulesFor(
    '- [major] Describe current architecture only; keep redesign proposals in an explicit follow-up section.',
    '- [major] Every important boundary claim must name repository evidence.'
  ),
  scope: {
    goal: 'Produce an evidence-linked current-state architecture map for one system slice.',
    allowedGlobs: ['docs/architecture/**', ...HARNESS_MEMORY_GLOBS],
    forbiddenGlobs: [...NO_CODE_FORBIDDEN_GLOBS],
    acceptance: 'The map names entry points, owners, state, boundaries, flows, and unknowns.',
    rollback: DEFAULT_ROLLBACK
  },
  verifySh: artifactVerifierScript({
    requirements: [
      {
        label: 'architecture map',
        pathspecs: ['docs/architecture'],
        minNonEmpty: 1,
        maxNonEmpty: 1,
        patterns: [
          { regex: 'entry[[:space:]-]+points?', description: 'entry points' },
          { regex: 'owners?', description: 'ownership' },
          { regex: 'boundar(y|ies)', description: 'boundaries' },
          { regex: 'flows?', description: 'flows' },
          { regex: 'unknowns?', description: 'unknowns' }
        ]
      }
    ]
  }),
  initialState: initialStateFor('architecture mapping')
}

const BOUNDARY_AUDITOR: HarnessTemplate = {
  id: 'boundary-auditor',
  label: 'Boundary auditor',
  category: 'Architecture',
  audience: ['systems-thinker', 'architect', 'seasoned-programmer'],
  description: 'Performs a read-only boundary review and writes severity-ranked findings.',
  adapter: 'codex',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 6, maxWritesPerMinute: 2 },
  requiresConfiguration: false,
  skillBody: [
    'Audit one named process, trust, persistence, or ownership boundary without editing product files.',
    '',
    '1. Read the binding contracts and current implementation.',
    '2. Trace the value across every relevant process or persistence boundary.',
    '3. Look for authority confusion, stale state, injection, race, and degrade-path defects.',
    '4. Write findings to <dir>/handoffs/boundary-audit.md with severity and file:line evidence.',
    '5. State explicitly which requested focus areas are clean, run the gate, and stop.'
  ].join('\n'),
  rules: rulesFor(
    '- [critical] Do not edit any product, test, configuration, or documentation file.',
    '- [critical] Never edit or delete <dir>/handoffs/.boundary-audit.last-success.sha256; the verifier owns it.',
    '- [major] Report correctness and safety findings only; omit style preferences.'
  ),
  scope: {
    goal: 'Produce an evidence-grounded read-only audit of one system boundary.',
    allowedGlobs: [...HARNESS_MEMORY_GLOBS],
    forbiddenGlobs: [...NO_CODE_FORBIDDEN_GLOBS, 'docs/**', 'scripts/**', 'Makefile'],
    acceptance:
      '<dir>/handoffs/boundary-audit.md changed since its last successful gate and contains ranked findings with file:line evidence and clean-area statements.',
    rollback: DEFAULT_ROLLBACK
  },
  verifySh: harnessLocalArtifactVerifierScript({
    relativePath: 'handoffs/boundary-audit.md',
    markerPath: 'handoffs/.boundary-audit.last-success.sha256',
    label: 'Boundary audit report',
    patterns: [
      { regex: '^##[[:space:]]+Findings', description: 'a Findings section' },
      {
        regex: '(BLOCKER|MAJOR|MINOR|CRITICAL|HIGH|MEDIUM|LOW)',
        description: 'severity-ranked findings'
      },
      {
        regex: '[[:alnum:]_./-]+:[0-9]+',
        description: 'file:line evidence'
      },
      {
        regex: '(clean[[:space:]-]+areas?|areas?[[:space:]]+clean|no[[:space:]]+findings)',
        description: 'clean-area statements'
      }
    ]
  }),
  initialState: initialStateFor('boundary audit')
}

const MIGRATION_PLANNER: HarnessTemplate = {
  id: 'migration-planner',
  label: 'Migration planner',
  category: 'Architecture',
  audience: ['systems-thinker', 'architect'],
  description: 'Designs one phased migration with compatibility, rollback, and evidence gates.',
  adapter: 'claude',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 8, maxWritesPerMinute: 3 },
  requiresConfiguration: false,
  skillBody: [
    'Design one safe migration from the verified current state to a named target state.',
    '',
    '1. Establish current constraints and the target invariant from repository evidence.',
    '2. Identify compatibility seams, data/state transitions, and irreversible points.',
    '3. Write a phased plan under docs/migrations/ and an ADR only when a durable decision is required.',
    '4. Give every phase a rollback and observable validation gate.',
    '5. Run the verification gate and stop without implementing the migration.'
  ].join('\n'),
  rules: rulesFor(
    '- [major] Plan only; never implement the migration in this run.',
    '- [major] No phase may remove the old path before replacement coverage is verified.'
  ),
  scope: {
    goal: 'Produce a phased, reversible migration plan grounded in the current implementation.',
    allowedGlobs: ['docs/migrations/**', 'docs/adr/**', ...HARNESS_MEMORY_GLOBS],
    forbiddenGlobs: [...NO_CODE_FORBIDDEN_GLOBS],
    acceptance:
      'The plan names phases, compatibility, rollback, validation gates, and irreversible points.',
    rollback: DEFAULT_ROLLBACK
  },
  verifySh: artifactVerifierScript({
    requirements: [
      {
        label: 'migration plan',
        pathspecs: ['docs/migrations'],
        minNonEmpty: 1,
        maxNonEmpty: 1,
        patterns: [
          { regex: 'phases?', description: 'phases' },
          { regex: 'compatib', description: 'compatibility' },
          { regex: 'rollback', description: 'rollback' },
          { regex: 'validation', description: 'validation gates' },
          { regex: 'irreversible', description: 'irreversible points' }
        ]
      }
    ]
  }),
  initialState: initialStateFor('migration planning')
}

export const ARCHITECTURE_TEMPLATES = [
  ARCHITECTURE_MAPPER,
  BOUNDARY_AUDITOR,
  MIGRATION_PLANNER
] as const
