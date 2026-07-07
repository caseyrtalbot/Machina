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
 *   4. the created directory must canonicalize to EXACTLY
 *      `<root>/<TE_DIR>/agents/<slug>` before anything is written — a symlink
 *      at <TE_DIR> or <TE_DIR>/agents would redirect every write (verify.sh
 *      included) outside the watched root, where the approvals watcher
 *      (followSymlinks: false) and the protected-glob auto-reject can never
 *      see it. Realpath equality, not containment: an intra-root alias would
 *      still defeat the literal-relative-path glob matcher;
 *   5. verify.sh is written LAST, then chmod 0o555 (defense-in-depth, not a
 *      boundary — contracts §5).
 *
 * `listHarnesses` is skip-not-throw: malformed entries never break the list.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { TE_DIR } from '../../shared/constants'
import {
  isReservedHarnessSlug,
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
  if (isReservedHarnessSlug(slug)) {
    return {
      ok: false,
      error: `harness slug collides with an adapter identity (reserved): ${slug}`
    }
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

  // Invariant 4: symlinked-parent refusal, checked between mkdir and the
  // first write. workspaceRoot is canonical at open, but re-canonicalizing it
  // here is a cheap invariant (and keeps the check honest for callers that
  // pass a symlink-prefixed root, e.g. macOS tmpdirs in tests).
  let realDir: string
  let realRoot: string
  try {
    ;[realDir, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(workspaceRoot)])
  } catch (err) {
    await fs.rmdir(dir).catch(() => {})
    return { ok: false, error: `could not canonicalize harness directory: ${String(err)}` }
  }
  if (realDir !== path.join(realRoot, TE_DIR, 'agents', slug)) {
    // Remove ONLY the empty slug dir this call just made — never recursive
    // on this path: a recursive rm would delete through the symlink into the
    // outside target.
    await fs.rmdir(dir).catch(() => {})
    return {
      ok: false,
      error: `harness path escapes its contract location (symlinked parent?): ${slug}`
    }
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
    // Bounded, not recursive: delete exactly the entries this create writes,
    // so a raced parent-symlink swap can never steer a recursive delete
    // beyond files with these known names.
    await removePartialHarness(dir)
    return { ok: false, error: `harness create failed: ${String(err)}` }
  }
}

async function removePartialHarness(dir: string): Promise<void> {
  for (const file of [VERIFY_FILE, STATE_FILE, SCOPE_FILE, RULES_FILE, SKILL_FILE]) {
    await fs.rm(path.join(dir, file), { force: true }).catch(() => {})
  }
  await fs.rmdir(path.join(dir, HANDOFFS_DIR)).catch(() => {})
  await fs.rmdir(dir).catch(() => {})
}

export async function listHarnesses(workspaceRoot: string): Promise<HarnessSummary[]> {
  const root = agentsRoot(workspaceRoot)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return [] // no agents dir yet — an empty list, not an error
  }

  // Same symlinked-parent refusal as createHarness, skip-not-throw style: a
  // redirected agents dir lists nothing rather than laundering outside
  // content in as harnesses.
  try {
    const [realAgents, realRoot] = await Promise.all([
      fs.realpath(root),
      fs.realpath(workspaceRoot)
    ])
    if (realAgents !== path.join(realRoot, TE_DIR, 'agents')) return []
  } catch {
    return []
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
