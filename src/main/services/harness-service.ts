/**
 * Harness generator + lister (workstation contracts §5/§6, Phase 1 step 6).
 *
 * `createHarness` materializes a validated template/blank draft into
 * `<root>/<TE_DIR>/agents/<slug>/` with the six on-disk entries. Invariants,
 * in order:
 *   1. shared `buildHarnessDraft` validates/merges/materializes the complete
 *      request BEFORE mkdir, including slug, scope, frontmatter round-trip,
 *      raw invocation, budgets, and content lint;
 *   2. create never overwrites, ever — an existing dir (or file) at the slug
 *      path is a structured error, and a failed create cleans up the partial
 *      dir it made;
 *   3. the created directory must canonicalize to EXACTLY
 *      `<root>/<TE_DIR>/agents/<slug>` before anything is written — a symlink
 *      at <TE_DIR> or <TE_DIR>/agents would redirect every write (verify.sh
 *      included) outside the watched root, where the approvals watcher
 *      (followSymlinks: false) and the protected-glob auto-reject can never
 *      see it. Realpath equality, not containment: an intra-root alias would
 *      still defeat the literal-relative-path glob matcher;
 *   4. verify.sh is written LAST, then chmod 0o555 (defense-in-depth, not a
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
import type { Stats } from 'node:fs'
import { TE_DIR } from '../../shared/constants'
import { buildHarnessDraft } from '../../shared/harness-draft'
import { lintHarness, type Diagnostic } from '../../shared/harness-lint'
import {
  isReservedHarnessSlug,
  isValidHarnessSlug,
  parseHarnessFrontmatter,
  type HarnessCreateRequest,
  type HarnessCreateResult,
  type HarnessFrontmatter,
  type HarnessScope,
  type HarnessSummary
} from '../../shared/harness-types'

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
  request: HarnessCreateRequest
): Promise<HarnessCreateResult> {
  // Pure shared authority first: renderer preview and main creation assemble
  // byte-identical files, but main reconstructs them from the request and does
  // not trust renderer-provided materialization. No mkdir happens on refusal.
  const requestValue: unknown = request
  const requestedSlug =
    typeof requestValue === 'object' &&
    requestValue !== null &&
    'slug' in requestValue &&
    typeof requestValue.slug === 'string'
      ? requestValue.slug
      : ''
  const built = buildHarnessDraft(request, `${TE_DIR}/agents/${requestedSlug}`)
  if (!built.ok) return { ok: false, error: built.error }

  const { slug } = built.draft
  const files = built.files

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

  // Invariant 3: symlinked-parent refusal, checked between mkdir and the
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
    await fs.writeFile(path.join(dir, SKILL_FILE), files.skillMd, 'utf8')
    await fs.writeFile(path.join(dir, RULES_FILE), files.rulesMd, 'utf8')
    await fs.writeFile(path.join(dir, SCOPE_FILE), files.scopeJson, 'utf8')
    await fs.writeFile(path.join(dir, STATE_FILE), files.stateMd, 'utf8')
    await fs.mkdir(path.join(dir, HANDOFFS_DIR))
    // verify.sh LAST: a harness folder with a verify.sh is a complete harness;
    // one without is visibly partial. Then lock it down.
    const verifyPath = path.join(dir, VERIFY_FILE)
    await fs.writeFile(verifyPath, files.verifySh, 'utf8')
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
    const { diagnostics, frontmatter, scope } = await inspectHarnessOnDisk(
      workspaceRoot,
      entry.name
    )
    summaries.push({
      slug: entry.name,
      name: frontmatter?.name ?? entry.name,
      description: frontmatter?.description ?? '',
      adapter: frontmatter?.adapter ?? null,
      diagnostics,
      // Budgets ride the summary (step 6, v1.2.6): what the next run would
      // snapshot at bind. Omitted when the frontmatter is unreadable.
      ...(frontmatter !== null ? { budgets: frontmatter.budgets } : {}),
      // The launch dialog must show the installed contract, never a same-slug
      // catalog default that overrides may have replaced.
      ...(scope !== undefined ? { scope } : {})
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
  const { diagnostics } = await inspectHarnessOnDisk(workspaceRoot, slug)
  return [...diagnostics]
}

export interface HarnessInspectionFiles {
  readonly skillMd: string
  readonly rulesMd: string
  readonly scopeJson: string
  readonly stateMd: string
  readonly verifySh: string
}

export interface HarnessInspection {
  readonly diagnostics: readonly Diagnostic[]
  /** Parsed SKILL.md frontmatter, null when missing or unreadable. */
  readonly frontmatter: HarnessFrontmatter | null
  /** Parsed effective scope, omitted when missing or malformed. */
  readonly scope?: HarnessScope
  /**
   * One stable, regular-file snapshot of every run-critical byte. Omitted
   * when any required leaf is missing, non-regular, symlinked, or replaced
   * during its read.
   */
  readonly files?: HarnessInspectionFiles
}

function parseScopeSummary(scopeJson: string | undefined): HarnessScope | undefined {
  if (scopeJson === undefined) return undefined
  try {
    const parsed = JSON.parse(scopeJson) as Partial<HarnessScope> | null
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.goal !== 'string' ||
      !Array.isArray(parsed.allowedGlobs) ||
      !parsed.allowedGlobs.every((item) => typeof item === 'string') ||
      !Array.isArray(parsed.forbiddenGlobs) ||
      !parsed.forbiddenGlobs.every((item) => typeof item === 'string') ||
      typeof parsed.acceptance !== 'string' ||
      typeof parsed.rollback !== 'string'
    ) {
      return undefined
    }
    return parsed as HarnessScope
  } catch {
    return undefined
  }
}

type ExactFileRead =
  | {
      readonly ok: true
      readonly content: string
      readonly initialStat: Stats
      readonly stat: Stats
    }
  | { readonly ok: false; readonly diagnostic: Diagnostic }

async function readExactRegularFile(
  dir: string,
  realDir: string,
  name: string
): Promise<ExactFileRead> {
  const filePath = path.join(dir, name)
  let before: Stats
  let beforeReal: string
  try {
    before = await fs.lstat(filePath)
    if (before.isSymbolicLink()) {
      return {
        ok: false,
        diagnostic: symlinkAncestryDiagnostic(`${name} must not be a symbolic link`, name)
      }
    }
    if (!before.isFile()) {
      return {
        ok: false,
        diagnostic: {
          severity: 'error',
          code: 'file-missing',
          message: `${name} is not a regular file`,
          file: name
        }
      }
    }
    beforeReal = await fs.realpath(filePath)
  } catch {
    return {
      ok: false,
      diagnostic: {
        severity: 'error',
        code: 'file-missing',
        message: `${name} is missing or unreadable`,
        file: name
      }
    }
  }
  if (beforeReal !== path.join(realDir, name)) {
    return {
      ok: false,
      diagnostic: symlinkAncestryDiagnostic(
        `${name} does not canonicalize to its literal harness path`,
        name
      )
    }
  }

  let content: string
  let after: Stats
  let afterReal: string
  try {
    content = await fs.readFile(filePath, 'utf8')
    ;[after, afterReal] = await Promise.all([fs.lstat(filePath), fs.realpath(filePath)])
  } catch {
    return {
      ok: false,
      diagnostic: {
        severity: 'error',
        code: 'file-missing',
        message: `${name} changed or became unreadable during inspection`,
        file: name
      }
    }
  }
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    afterReal !== beforeReal ||
    after.dev !== before.dev ||
    after.ino !== before.ino
  ) {
    return {
      ok: false,
      diagnostic: symlinkAncestryDiagnostic(
        `${name} changed identity during inspection; run refused`,
        name
      )
    }
  }
  return { ok: true, content, initialStat: before, stat: after }
}

async function inspectHandoffsDirectory(dir: string, realDir: string): Promise<Diagnostic | null> {
  const handoffsPath = path.join(dir, HANDOFFS_DIR)
  let stat: Stats
  try {
    stat = await fs.lstat(handoffsPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return symlinkAncestryDiagnostic(
        `could not inspect ${HANDOFFS_DIR}/: ${String(error)}`,
        `${HANDOFFS_DIR}/`
      )
    }
    return {
      severity: 'warning',
      code: 'file-missing',
      message: `${HANDOFFS_DIR}/ directory is missing`,
      file: `${HANDOFFS_DIR}/`
    }
  }
  if (stat.isSymbolicLink()) {
    return symlinkAncestryDiagnostic(
      `${HANDOFFS_DIR}/ must not be a symbolic link`,
      `${HANDOFFS_DIR}/`
    )
  }
  if (!stat.isDirectory()) {
    return {
      severity: 'warning',
      code: 'file-missing',
      message: `${HANDOFFS_DIR}/ directory is missing`,
      file: `${HANDOFFS_DIR}/`
    }
  }
  try {
    const real = await fs.realpath(handoffsPath)
    return real === path.join(realDir, HANDOFFS_DIR)
      ? null
      : symlinkAncestryDiagnostic(
          `${HANDOFFS_DIR}/ does not canonicalize to its literal harness path`,
          `${HANDOFFS_DIR}/`
        )
  } catch (error) {
    return symlinkAncestryDiagnostic(
      `could not canonicalize ${HANDOFFS_DIR}/: ${String(error)}`,
      `${HANDOFFS_DIR}/`
    )
  }
}

/** Caller guarantees `slug` passed isValidHarnessSlug. */
export async function inspectHarnessOnDisk(
  workspaceRoot: string,
  slug: string
): Promise<HarnessInspection> {
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
  let realDir: string
  let realRoot: string
  try {
    ;[realDir, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(workspaceRoot)])
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

  // Read every run-critical leaf once, rejecting symlinks and replacement
  // races before exposing any bytes to prompt composition.
  const [skill, rules, scopeFile, state, verify, handoffsDiagnostic] = await Promise.all([
    readExactRegularFile(dir, realDir, SKILL_FILE),
    readExactRegularFile(dir, realDir, RULES_FILE),
    readExactRegularFile(dir, realDir, SCOPE_FILE),
    readExactRegularFile(dir, realDir, STATE_FILE),
    readExactRegularFile(dir, realDir, VERIFY_FILE),
    inspectHandoffsDirectory(dir, realDir)
  ])
  const reads = [skill, rules, scopeFile, state, verify] as const
  for (const read of reads) if (!read.ok) diagnostics.push(read.diagnostic)
  if (handoffsDiagnostic !== null) diagnostics.push(handoffsDiagnostic)

  let parentStable = true
  try {
    const [realDirAfter, realRootAfter] = await Promise.all([
      fs.realpath(dir),
      fs.realpath(workspaceRoot)
    ])
    parentStable = realDirAfter === realDir && realRootAfter === realRoot
  } catch {
    parentStable = false
  }
  if (!parentStable) {
    diagnostics.push(
      symlinkAncestryDiagnostic('harness ancestry changed during inspection; run refused')
    )
  }

  const skillMd = skill.ok ? skill.content : undefined
  const rulesMd = rules.ok ? rules.content : undefined
  const scopeJson = scopeFile.ok ? scopeFile.content : undefined
  const verifySh = verify.ok ? verify.content : undefined

  // verify.sh mode drift: created 0o555, never agent-writable. Drift is a
  // tamper signal but not a boundary (contracts §5) — warning.
  if (verify.ok) {
    // 0o7777, not 0o777: a narrower mask hides setuid/setgid/sticky drift.
    // Flag either side of the stable-byte read. Some filesystems/security
    // tooling can clear special mode bits asynchronously after chmod; seeing
    // the drift at inspection open is still a tamper signal.
    const initialMode = verify.initialStat.mode & 0o7777
    const finalMode = verify.stat.mode & 0o7777
    const mode = initialMode !== 0o555 ? initialMode : finalMode
    if (mode !== 0o555) {
      diagnostics.push({
        severity: 'warning',
        code: 'verify-mode',
        message: `verify.sh mode drifted to 0o${mode.toString(8)} (created 0o555)`,
        file: VERIFY_FILE
      })
    }
  }

  // Compose the shared content lints — never reimplemented here.
  diagnostics.push(...lintHarness({ slug, skillMd, rulesMd, scopeJson, verifySh }))

  let frontmatter: HarnessFrontmatter | null = null
  if (skillMd !== undefined) {
    const parsed = parseHarnessFrontmatter(skillMd)
    if (parsed.ok) frontmatter = parsed.value
  }
  const scopeHasError = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error' && diagnostic.file === SCOPE_FILE
  )
  const scope = scopeHasError ? undefined : parseScopeSummary(scopeJson)
  const files =
    parentStable && skill.ok && rules.ok && scopeFile.ok && state.ok && verify.ok
      ? {
          skillMd: skill.content,
          rulesMd: rules.content,
          scopeJson: scopeFile.content,
          stateMd: state.content,
          verifySh: verify.content
        }
      : undefined
  return {
    diagnostics,
    frontmatter,
    ...(scope !== undefined ? { scope } : {}),
    ...(files !== undefined ? { files } : {})
  }
}

function symlinkAncestryDiagnostic(message: string, file = '.'): Diagnostic {
  return { severity: 'error', code: 'symlink-ancestry', message, file }
}
