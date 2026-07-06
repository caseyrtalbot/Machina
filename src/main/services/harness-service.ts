/**
 * Harness generator + lister (workstation contracts §5/§6, Phase 1 step 6).
 *
 * `createHarness` materializes a template into
 * `<root>/<TE_DIR>/agents/<slug>/` with the six on-disk entries. Invariants,
 * in order:
 *   1. slug is validated against HARNESS_SLUG_RE (no traversal — the slug is
 *      a path segment);
 *   2. the materialized scope contract passes `validateHarnessScope` BEFORE
 *      any write (refuse-to-emit: a contract missing the protected globs is
 *      never emitted);
 *   3. create never overwrites, ever — an existing dir (or file) at the slug
 *      path is a structured error, and a failed create cleans up the partial
 *      dir it made;
 *   4. verify.sh is written LAST, then chmod 0o555 (defense-in-depth, not a
 *      boundary — contracts §5).
 *
 * `listHarnesses` is skip-not-throw: malformed entries never break the list.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { TE_DIR } from '../../shared/constants'
import {
  isValidHarnessSlug,
  parseHarnessFrontmatter,
  validateHarnessScope,
  type HarnessCreateResult,
  type HarnessSummary
} from '../../shared/harness-types'
import { frontmatterFor, HARNESS_TEMPLATES, materializeScope } from '../../shared/harness-templates'

const SKILL_FILE = 'SKILL.md'
const RULES_FILE = 'rules.md'
const SCOPE_FILE = 'scope.json'
const VERIFY_FILE = 'verify.sh'
const STATE_FILE = 'state.md'
const HANDOFFS_DIR = 'handoffs'

function agentsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, TE_DIR, 'agents')
}

export async function createHarness(
  workspaceRoot: string,
  templateId: string,
  slug: string
): Promise<HarnessCreateResult> {
  if (!isValidHarnessSlug(slug)) {
    return { ok: false, error: `invalid harness slug: ${JSON.stringify(slug)}` }
  }
  const template = HARNESS_TEMPLATES[templateId]
  if (template === undefined) {
    return { ok: false, error: `unknown harness template: ${JSON.stringify(templateId)}` }
  }

  // Refuse-to-emit: validate the exact scope contract that would be written,
  // before any directory or file exists.
  const harnessDirRel = `${TE_DIR}/agents/${slug}`
  const scope = materializeScope(template, harnessDirRel)
  const scopeCheck = validateHarnessScope(scope)
  if (!scopeCheck.ok) {
    return { ok: false, error: scopeCheck.error }
  }

  const dir = path.join(agentsRoot(workspaceRoot), slug)
  try {
    await fs.mkdir(agentsRoot(workspaceRoot), { recursive: true })
    // Non-recursive mkdir is the no-overwrite check: EEXIST (dir OR file
    // squatting on the path) means an existing harness we must never touch.
    await fs.mkdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, error: `harness already exists: ${slug} (create never overwrites)` }
    }
    return { ok: false, error: `could not create harness directory: ${String(err)}` }
  }

  try {
    await fs.writeFile(
      path.join(dir, SKILL_FILE),
      frontmatterFor(template, slug) + '\n' + template.skillBody + '\n',
      'utf8'
    )
    await fs.writeFile(path.join(dir, RULES_FILE), template.rules + '\n', 'utf8')
    await fs.writeFile(path.join(dir, SCOPE_FILE), JSON.stringify(scope, null, 2) + '\n', 'utf8')
    await fs.writeFile(path.join(dir, STATE_FILE), template.initialState, 'utf8')
    await fs.mkdir(path.join(dir, HANDOFFS_DIR))
    // verify.sh LAST: a harness folder with a verify.sh is a complete harness;
    // one without is visibly partial. Then lock it down.
    const verifyPath = path.join(dir, VERIFY_FILE)
    await fs.writeFile(verifyPath, template.verifySh, 'utf8')
    await fs.chmod(verifyPath, 0o555)
    return { ok: true, root: dir }
  } catch (err) {
    // Cleanup the partial dir this create made — never leave a half-harness
    // that a later create would refuse to repair (no-overwrite is absolute).
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: `harness create failed: ${String(err)}` }
  }
}

export async function listHarnesses(workspaceRoot: string): Promise<HarnessSummary[]> {
  const root = agentsRoot(workspaceRoot)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return [] // no agents dir yet — an empty list, not an error
  }

  const summaries: HarnessSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidHarnessSlug(entry.name)) continue
    let skillMd: string
    try {
      skillMd = await fs.readFile(path.join(root, entry.name, SKILL_FILE), 'utf8')
    } catch {
      continue // skip-not-throw: no SKILL.md, not a harness
    }
    const parsed = parseHarnessFrontmatter(skillMd)
    if (!parsed.ok) continue // skip-not-throw: malformed frontmatter
    summaries.push({
      slug: entry.name,
      name: parsed.value.name,
      description: parsed.value.description,
      adapter: parsed.value.adapter
    })
  }
  return summaries.sort((a, b) => a.slug.localeCompare(b.slug))
}
