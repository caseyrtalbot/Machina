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
 * `listHarnesses` is skip-not-throw for non-harness entries (stray files,
 * invalid-slug names), but since step 7 (contracts v1.2.4) every valid-slug
 * directory IS listed, carrying lint diagnostics — malformed harnesses stop
 * silently vanishing. The main-side fs lints here (file presence, verify.sh
 * mode drift, handoffs/ presence, symlink-in-ancestry realpath equality —
 * discharging v1.1.5 residual #2) are COMPOSED with the shared content lints
 * (`lintHarness`, harness-lint.ts); no shared check is reimplemented here.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { TE_DIR } from '../../shared/constants'
import { lintHarness, type Diagnostic } from '../../shared/harness-lint'
import {
  isReservedHarnessSlug,
  isValidHarnessSlug,
  parseHarnessFrontmatter,
  validateHarnessScope,
  type HarnessCreateResult,
  type HarnessFrontmatter,
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

  const summaries: HarnessSummary[] = []
  for (const entry of entries) {
    // Stray files and invalid-slug names are not addressable as harnesses —
    // still skipped. Symlinked slug entries ARE listed: the ancestry lint
    // inside inspectHarness flags them (they used to vanish silently).
    if (!isValidHarnessSlug(entry.name)) continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const { diagnostics, frontmatter } = await inspectHarness(workspaceRoot, entry.name)
    summaries.push({
      slug: entry.name,
      name: frontmatter?.name ?? entry.name,
      description: frontmatter?.description ?? '',
      adapter: frontmatter?.adapter ?? null,
      diagnostics
    })
  }
  return summaries.sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * Lint one on-disk harness (the `harness:lint` service path, v1.2.4):
 * main-side fs lints composed with the shared content lints. Also the
 * engine behind every `listHarnesses` summary's diagnostics.
 */
export async function lintHarnessOnDisk(
  workspaceRoot: string,
  slug: string
): Promise<Diagnostic[]> {
  if (!isValidHarnessSlug(slug)) {
    return [
      {
        severity: 'error',
        code: 'invalid-slug',
        message: `invalid harness slug: ${JSON.stringify(slug)}`,
        file: '.'
      }
    ]
  }
  const { diagnostics } = await inspectHarness(workspaceRoot, slug)
  return [...diagnostics]
}

interface HarnessInspection {
  readonly diagnostics: readonly Diagnostic[]
  /** Parsed SKILL.md frontmatter, null when missing or unreadable. */
  readonly frontmatter: HarnessFrontmatter | null
}

/** Caller guarantees `slug` passed isValidHarnessSlug. */
async function inspectHarness(workspaceRoot: string, slug: string): Promise<HarnessInspection> {
  const dir = path.join(agentsRoot(workspaceRoot), slug)
  const diagnostics: Diagnostic[] = []

  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) throw new Error('not a directory')
  } catch {
    // A dangling symlink at the slug path is an ancestry finding, not a
    // missing harness — stat followed the link and found nothing.
    const isLink = await fs.lstat(dir).then(
      (s) => s.isSymbolicLink(),
      () => false
    )
    return {
      diagnostics: [
        isLink
          ? symlinkAncestryDiagnostic(`${slug} is a symlink with no readable target`)
          : {
              severity: 'error',
              code: 'file-missing',
              message: `harness directory not found: ${slug}`,
              file: '.'
            }
      ],
      frontmatter: null
    }
  }

  // Symlink-in-ancestry realpath check (v1.1.5 residual #2, discharged
  // here): the slug dir must canonicalize to EXACTLY its literal path — one
  // equality covers a symlinked <TE_DIR>, agents dir, or slug dir, because
  // realpath resolves the whole ancestor chain. A redirected harness sits
  // outside the watcher and the protected-glob auto-reject. Checked FIRST and
  // returned on failure with NO content read: reading SKILL.md/scope.json
  // through the symlink would leak outside-workspace file content (frontmatter
  // name/description, scope) into the palette. The entry stays listed (greyed
  // with the ancestry reason); with no frontmatter read, name falls back to the
  // slug and adapter is null — fs facts only.
  try {
    const [realDir, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(workspaceRoot)])
    if (realDir !== path.join(realRoot, TE_DIR, 'agents', slug)) {
      return {
        diagnostics: [
          symlinkAncestryDiagnostic(
            `harness path does not canonicalize to its literal location (symlinked ancestry?): ${slug}`
          )
        ],
        frontmatter: null
      }
    }
  } catch (err) {
    return {
      diagnostics: [
        symlinkAncestryDiagnostic(`could not canonicalize harness path: ${String(err)}`)
      ],
      frontmatter: null
    }
  }

  // Reserved slug: a hand-created adapter-identity directory (e.g. cli-claude)
  // lints clean otherwise and would render run-enabled, but harness:run always
  // refuses it — its trailers would be indistinguishable from the adapter
  // fallback. Surface it as an error so the palette greys it with a reason
  // instead of an error toast on run. Reuses isReservedHarnessSlug.
  if (isReservedHarnessSlug(slug)) {
    diagnostics.push({
      severity: 'error',
      code: 'reserved-slug',
      message: `harness slug collides with an adapter identity (reserved): ${slug}`,
      file: '.'
    })
  }

  // File presence: harness:run reads SKILL.md/rules.md/scope.json/state.md
  // and verify.sh is the gate — a missing one breaks the run (error).
  // handoffs/ is not needed to run (warning).
  const read = (name: string): Promise<string | undefined> =>
    fs.readFile(path.join(dir, name), 'utf8').then(
      (content) => content,
      () => undefined
    )
  const [skillMd, rulesMd, scopeJson, verifySh] = await Promise.all([
    read(SKILL_FILE),
    read(RULES_FILE),
    read(SCOPE_FILE),
    read(VERIFY_FILE)
  ])
  const stateExists = await fs.access(path.join(dir, STATE_FILE)).then(
    () => true,
    () => false
  )
  const requiredPresence: ReadonlyArray<readonly [string, boolean]> = [
    [SKILL_FILE, skillMd !== undefined],
    [RULES_FILE, rulesMd !== undefined],
    [SCOPE_FILE, scopeJson !== undefined],
    [STATE_FILE, stateExists],
    [VERIFY_FILE, verifySh !== undefined]
  ]
  for (const [file, present] of requiredPresence) {
    if (!present) {
      diagnostics.push({
        severity: 'error',
        code: 'file-missing',
        message: `${file} is missing or unreadable`,
        file
      })
    }
  }
  const handoffsIsDir = await fs.stat(path.join(dir, HANDOFFS_DIR)).then(
    (s) => s.isDirectory(),
    () => false
  )
  if (!handoffsIsDir) {
    diagnostics.push({
      severity: 'warning',
      code: 'file-missing',
      message: `${HANDOFFS_DIR}/ directory is missing`,
      file: `${HANDOFFS_DIR}/`
    })
  }

  // verify.sh mode drift: created 0o555, never agent-writable. Drift is a
  // tamper signal but not a boundary (contracts §5) — warning.
  if (verifySh !== undefined) {
    try {
      // 0o7777, not 0o777: a narrower mask hides setuid/setgid/sticky drift
      // (e.g. 0o4555 would read as an unchanged 0o555).
      const mode = (await fs.stat(path.join(dir, VERIFY_FILE))).mode & 0o7777
      if (mode !== 0o555) {
        diagnostics.push({
          severity: 'warning',
          code: 'verify-mode',
          message: `verify.sh mode drifted to 0o${mode.toString(8)} (created 0o555)`,
          file: VERIFY_FILE
        })
      }
    } catch {
      // Raced deletion between read and stat: the presence lint above (or
      // the next list) owns it.
    }
  }

  // Compose the shared content lints — never reimplemented here.
  diagnostics.push(...lintHarness({ slug, skillMd, rulesMd, scopeJson, verifySh }))

  let frontmatter: HarnessFrontmatter | null = null
  if (skillMd !== undefined) {
    const parsed = parseHarnessFrontmatter(skillMd)
    if (parsed.ok) frontmatter = parsed.value
  }
  return { diagnostics, frontmatter }
}

function symlinkAncestryDiagnostic(message: string): Diagnostic {
  return { severity: 'error', code: 'symlink-ancestry', message, file: '.' }
}
