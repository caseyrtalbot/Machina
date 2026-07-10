// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HARNESS_TEMPLATES } from '../harness-templates'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-verifier-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'verifier@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Verifier Test'], { cwd: root })
  return root
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

async function installVerifier(root: string, templateId: string): Promise<string> {
  const template = HARNESS_TEMPLATES[templateId]
  const relativePath = `.machina/agents/${templateId}/verify.sh`
  await write(root, relativePath, template.verifySh)
  await fs.mkdir(path.join(root, '.machina', 'agents', templateId, 'handoffs'), {
    recursive: true
  })
  await fs.chmod(path.join(root, relativePath), 0o555)
  return relativePath
}

function runVerifier(
  root: string,
  relativePath: string
): { readonly status: number | null; readonly output: string } {
  const result = spawnSync('sh', [relativePath], { cwd: root, encoding: 'utf8' })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`
  }
}

function stage(root: string, ...relativePaths: string[]): void {
  execFileSync('git', ['add', '--', ...relativePaths], { cwd: root })
}

const ARTIFACT_TEMPLATE_IDS = [
  'idea-to-spec',
  'docs-maintainer',
  'automation-builder',
  'architecture-mapper',
  'migration-planner'
] as const

describe('artifact template verifier execution', () => {
  it('rejects zero-work runs in a fresh Git repository for every artifact role', async () => {
    for (const templateId of ARTIFACT_TEMPLATE_IDS) {
      const root = await makeRepo()
      const verifier = await installVerifier(root, templateId)
      const result = runVerifier(root, verifier)
      expect(result.status, `${templateId}: ${result.output}`).not.toBe(0)
      expect(result.output, templateId).toContain('No current')
    }
  })

  it('accepts one untracked, structured idea brief and rejects missing structure', async () => {
    const root = await makeRepo()
    const verifier = await installVerifier(root, 'idea-to-spec')
    await write(root, 'docs/specs/widget.md', '# Widget\n\nA short document.\n')

    const missing = runVerifier(root, verifier)
    expect(missing.status).not.toBe(0)
    expect(missing.output).toContain('the users')

    await write(
      root,
      'docs/specs/widget.md',
      [
        '# Widget',
        '',
        '## Users',
        'Operators.',
        '## Scope',
        'One workflow.',
        '## Acceptance criteria',
        'The workflow is observable.',
        '## Constraints',
        'No new dependency.',
        '## Open questions',
        'Which environment?',
        ''
      ].join('\n')
    )

    expect(runVerifier(root, verifier)).toMatchObject({ status: 0 })
  })

  it('accepts a staged README variant, not only README.md', async () => {
    const root = await makeRepo()
    const verifier = await installVerifier(root, 'docs-maintainer')
    await write(root, 'README-operators.md', '# Operators\n\nCurrent command behavior.\n')
    stage(root, 'README-operators.md')

    expect(runVerifier(root, verifier)).toMatchObject({ status: 0 })
  })

  it('requires both automation and runbook, and syntax-checks only changed shell files', async () => {
    const root = await makeRepo()
    const verifier = await installVerifier(root, 'automation-builder')
    await write(root, 'scripts/report.sh', '#!/bin/sh\nprintf "%s\\n" report\n')

    const noRunbook = runVerifier(root, verifier)
    expect(noRunbook.status).not.toBe(0)
    expect(noRunbook.output).toContain('automation runbook')

    await write(
      root,
      'docs/runbooks/report.md',
      '# Report automation\n\n## Usage\nRun in dry-run mode.\n\n## Failure behavior\nIt exits non-zero.\n'
    )
    expect(runVerifier(root, verifier)).toMatchObject({ status: 0 })

    await write(root, 'scripts/report.sh', '#!/bin/sh\nif then\n')
    const badSyntax = runVerifier(root, verifier)
    expect(badSyntax.status).not.toBe(0)
    expect(badSyntax.output).toContain('invalid syntax')
  })

  it('accepts a structured architecture map and a staged structured migration plan', async () => {
    const architectureRoot = await makeRepo()
    const architectureVerifier = await installVerifier(architectureRoot, 'architecture-mapper')
    await write(
      architectureRoot,
      'docs/architecture/worker.md',
      '# Worker\n\nEntry point: main.\nOwner: service.\nBoundary: IPC.\nFlow: request to result.\nUnknowns: retry ownership.\n'
    )
    expect(runVerifier(architectureRoot, architectureVerifier)).toMatchObject({ status: 0 })

    const migrationRoot = await makeRepo()
    const migrationVerifier = await installVerifier(migrationRoot, 'migration-planner')
    await write(
      migrationRoot,
      'docs/migrations/storage.md',
      '# Storage migration\n\nPhases preserve compatibility. Each phase has rollback and a validation gate. The irreversible point is named.\n'
    )
    stage(migrationRoot, 'docs/migrations/storage.md')
    expect(runVerifier(migrationRoot, migrationVerifier)).toMatchObject({ status: 0 })
  })

  it('rejects whitespace errors in an untracked artifact', async () => {
    const root = await makeRepo()
    const verifier = await installVerifier(root, 'docs-maintainer')
    await write(root, 'docs/guide.md', '# Guide   \n')

    expect(runVerifier(root, verifier).status).not.toBe(0)
  })

  it('rejects a changed artifact symlink even when its target has valid structure', async () => {
    const root = await makeRepo()
    const verifier = await installVerifier(root, 'idea-to-spec')
    await write(
      root,
      'reference.md',
      '# Reference\n\nUsers. Scope. Acceptance criteria. Constraints. Open questions.\n'
    )
    stage(root, 'reference.md')
    execFileSync('git', ['commit', '-qm', 'reference'], { cwd: root })
    await fs.mkdir(path.join(root, 'docs/specs'), { recursive: true })
    await fs.symlink('../../reference.md', path.join(root, 'docs/specs/widget.md'))

    const result = runVerifier(root, verifier)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('must not be a symlink')
  })
})

describe('boundary-auditor verifier execution', () => {
  const validReport = [
    '# Boundary audit',
    '',
    '## Findings',
    '',
    '- [MAJOR] src/main/ipc/example.ts:42 — authority mismatch.',
    '',
    '## Clean areas',
    '',
    'The persistence focus area is clean.',
    ''
  ].join('\n')

  it('updates its marker only after semantic checks pass', async () => {
    const root = await makeRepo()
    const verifier = await installVerifier(root, 'boundary-auditor')
    const report = '.machina/agents/boundary-auditor/handoffs/boundary-audit.md'
    const marker = '.machina/agents/boundary-auditor/handoffs/.boundary-audit.last-success.sha256'
    await write(root, report, '# Boundary audit\n\n## Findings\n\nNo evidence yet.\n')

    const invalid = runVerifier(root, verifier)
    expect(invalid.status).not.toBe(0)
    await expect(fs.stat(path.join(root, marker))).rejects.toThrow()

    await write(root, report, validReport)
    const first = runVerifier(root, verifier)
    expect(first.status, first.output).toBe(0)
    expect(first.output).toContain('not current-turn attribution')
    await expect(fs.stat(path.join(root, marker))).resolves.toBeDefined()

    const unchanged = runVerifier(root, verifier)
    expect(unchanged.status).not.toBe(0)
    expect(unchanged.output).toContain('unchanged since its last successful verification')

    await fs.appendFile(
      path.join(root, report),
      '\nAdditional checked boundary: src/shared/x.ts:9.\n'
    )
    const changed = runVerifier(root, verifier)
    expect(changed.status, changed.output).toBe(0)
  })

  it('rejects a symlink report and a symlink handoffs parent', async () => {
    const report = '.machina/agents/boundary-auditor/handoffs/boundary-audit.md'

    const linkedReportRoot = await makeRepo()
    const linkedReportVerifier = await installVerifier(linkedReportRoot, 'boundary-auditor')
    await write(linkedReportRoot, 'reference-audit.md', validReport)
    await fs.symlink('../../../../reference-audit.md', path.join(linkedReportRoot, report))
    const linkedReport = runVerifier(linkedReportRoot, linkedReportVerifier)
    expect(linkedReport.status).not.toBe(0)
    expect(linkedReport.output).toContain('must not be a symlink')

    const linkedParentRoot = await makeRepo()
    const linkedParentVerifier = await installVerifier(linkedParentRoot, 'boundary-auditor')
    await write(linkedParentRoot, 'outside-handoffs/boundary-audit.md', validReport)
    const handoffs = path.join(linkedParentRoot, '.machina/agents/boundary-auditor/handoffs')
    await fs.rmdir(handoffs)
    await fs.symlink('../../../outside-handoffs', handoffs)
    const linkedParent = runVerifier(linkedParentRoot, linkedParentVerifier)
    expect(linkedParent.status).not.toBe(0)
    expect(linkedParent.output).toContain('parent must not be a symlink')
  })
})

describe('catalog safety instructions', () => {
  it('propagates the common no-input, read-only-git, advisory-scope, and blocked-stop rules', () => {
    for (const template of Object.values(HARNESS_TEMPLATES)) {
      expect(template.rules, template.id).toContain('ask one focused question')
      expect(template.rules, template.id).toContain('Git is read-only')
      expect(template.rules, template.id).toContain('Scope globs are instructions, not a sandbox')
      expect(template.rules, template.id).toContain('report the blocker and stop')
    }
  })

  it('requires automation dry-run isolation or explicit operator confirmation', () => {
    const template = HARNESS_TEMPLATES['automation-builder']
    expect(template.skillBody).toContain('dry run or an isolated disposable fixture')
    expect(template.rules).toContain('without explicit operator confirmation')
  })

  it('uses one boundary report path consistently', () => {
    const template = HARNESS_TEMPLATES['boundary-auditor']
    expect(template.skillBody).toContain('<dir>/handoffs/boundary-audit.md')
    expect(template.scope.acceptance).toContain('<dir>/handoffs/boundary-audit.md')
    expect(template.scope.allowedGlobs).toContain('<dir>/handoffs/**')
  })
})
