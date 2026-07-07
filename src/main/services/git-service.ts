import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path'
import {
  MACHINA_TRAILER_PREFIX,
  SAFE_ID_RE,
  TRAILER_AGENT,
  TRAILER_REVERTS,
  TRAILER_SESSION
} from '@shared/git-types'
import type {
  AgentCommits,
  CommitApprovedOpts,
  GitFileState,
  GitOpResult,
  GitStatusEntry
} from '@shared/git-types'

const GIT_TIMEOUT_MS = 5000

export function isGitRepo(vaultRoot: string): boolean {
  return existsSync(join(vaultRoot, '.git'))
}

// ---------------------------------------------------------------------------
// Git substrate (workstation contracts §2, v1.1). Everything below is
// Result-style: no function throws across the service boundary.
// ---------------------------------------------------------------------------

/** Review diffs are truncated at this many bytes (huge agent writes stay reviewable). */
export const DIFF_MAX_BYTES = 2_000_000

const MAX_GIT_BUFFER_BYTES = 10 * 1024 * 1024

interface RunGitResult {
  readonly ok: boolean
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

/**
 * Run one git command against `root`. Never throws — failures (non-zero exit,
 * timeout, missing binary) come back as a structured result carrying whatever
 * stdout/stderr the command produced (load-bearing for `diff --no-index`,
 * which exits 1 on success-with-diff).
 */
function runGit(root: string, args: readonly string[]): RunGitResult {
  return runGitWithInput(root, args)
}

/**
 * runGit with optional stdin payload (NUL-delimited pathname lists for
 * `--stdin -z` plumbing like check-ignore). stdin is closed-empty when no
 * input is given, matching the previous 'ignore' behavior.
 */
function runGitWithInput(root: string, args: readonly string[], input?: string): RunGitResult {
  try {
    const stdout = execFileSync('git', [...args], {
      cwd: root,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BUFFER_BYTES,
      input: input ?? '',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { ok: true, code: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as Error & {
      status?: number | null
      stdout?: string | Buffer
      stderr?: string | Buffer
    }
    return {
      ok: false,
      code: typeof e.status === 'number' ? e.status : null,
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf-8') ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf-8') ?? ''),
      error: e.message
    }
  }
}

export function headSha(root: string): string | null {
  if (!isGitRepo(root)) return null
  const res = runGit(root, ['rev-parse', 'HEAD'])
  return res.ok ? res.stdout.trim() : null
}

/**
 * Shas reachable from `toSha` but not `fromSha` (`git rev-list from..to`),
 * newest first. Null on failure — including a `fromSha` made unreachable by
 * history rewriting, which callers must treat as suspicious, not clean.
 * Used by the headMoved tripwire to decide whether HEAD movement during a
 * turn is fully explained by the queue's own approval commits.
 */
export function commitsBetween(
  root: string,
  fromSha: string,
  toSha: string
): readonly string[] | null {
  if (!isGitRepo(root)) return null
  if (!/^[0-9a-f]{4,64}$/i.test(fromSha) || !/^[0-9a-f]{4,64}$/i.test(toSha)) return null
  const res = runGit(root, ['rev-list', `${fromSha}..${toSha}`])
  if (!res.ok) return null
  return res.stdout.split('\n').filter((s) => s.length > 0)
}

interface PorcelainEntry {
  readonly code: string
  readonly path: string
  readonly origPath?: string
}

/**
 * Parse `git status --porcelain -z --untracked-files=all`. In -z mode a
 * rename record is `XY <newPath>` followed by the ORIGINAL path as its own
 * NUL-separated field.
 */
function parsePorcelain(root: string): readonly PorcelainEntry[] {
  const res = runGit(root, ['status', '--porcelain', '-z', '--untracked-files=all'])
  if (!res.ok) return []
  const fields = res.stdout.split('\0')
  const entries: PorcelainEntry[] = []
  let i = 0
  while (i < fields.length) {
    const field = fields[i] ?? ''
    if (field.length < 4) {
      i += 1
      continue
    }
    const code = field.slice(0, 2)
    const path = field.slice(3)
    if (code.includes('R') || code.includes('C')) {
      const origPath = fields[i + 1] ?? ''
      entries.push({ code, path, origPath })
      i += 2
    } else {
      entries.push({ code, path })
      i += 1
    }
  }
  return entries
}

function stateForCode(code: string): GitFileState {
  if (code === '??') return 'added'
  if (code.includes('R') || code.includes('C')) return 'renamed'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

/** Porcelain v1 -z with --untracked-files=all; '??' maps to 'added'. Non-repo → []. */
export function status(root: string): readonly GitStatusEntry[] {
  if (!isGitRepo(root)) return []
  return parsePorcelain(root).map((e) =>
    e.origPath !== undefined
      ? { path: e.path, state: stateForCode(e.code), origPath: e.origPath }
      : { path: e.path, state: stateForCode(e.code) }
  )
}

function realPathIfExists(p: string): string | null {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

/**
 * True when `p` is a safe repo-relative path: relative, non-`-`-leading, and
 * resolving inside root AFTER following symlinks (contracts §2: lexical
 * containment alone lets `link/secret` under a symlinked directory read or
 * trash files outside the workspace). Nonexistent paths are checked via their
 * deepest existing ancestor.
 */
function isSafeRelPath(root: string, p: string): boolean {
  if (p.length === 0 || isAbsolute(p) || p.startsWith('-')) return false
  const canonicalRoot = realPathIfExists(resolve(root)) ?? resolve(root)
  const abs = resolve(canonicalRoot, p)
  if (abs === canonicalRoot || !abs.startsWith(canonicalRoot + sep)) return false
  let probe = abs
  for (;;) {
    const real = realPathIfExists(probe)
    if (real !== null) return real === canonicalRoot || real.startsWith(canonicalRoot + sep)
    const parent = dirname(probe)
    if (parent === probe) return false
    probe = parent
  }
}

/**
 * Validated paths are still git PATHSPECS after `--` (wildmatch + `:(magic)`
 * active): a path like `*` or `:/` would expand to the whole repo in
 * add/commit/restore/diff. `:(literal)` pins each one to an exact filename.
 */
function literalPathspecs(paths: readonly string[]): readonly string[] {
  return paths.map((p) => `:(literal)${p}`)
}

function findInvalidPath(root: string, paths: readonly string[]): string | null {
  for (const p of paths) {
    if (!isSafeRelPath(root, p)) return p
  }
  return null
}

/**
 * The truncation marker carries a sha256 of the FULL text so two diffs that
 * agree in the first DIFF_MAX_BYTES but diverge later still compare unequal —
 * the approval queue's stale-diff guard compares these strings verbatim.
 */
function truncateDiff(text: string): string {
  if (Buffer.byteLength(text, 'utf-8') <= DIFF_MAX_BYTES) return text
  const head = Buffer.from(text, 'utf-8').subarray(0, DIFF_MAX_BYTES).toString('utf-8')
  const digest = createHash('sha256').update(text, 'utf-8').digest('hex')
  return `${head}\n[diff truncated at ${DIFF_MAX_BYTES} bytes; full-diff sha256 ${digest}]\n`
}

/**
 * Full-content diff for a file git cannot diff against HEAD (untracked,
 * ignored, unborn HEAD, or non-repo). `git diff --no-index` exits 1 on
 * success-with-diff, so any failure that still produced stdout is a success —
 * including a maxBuffer/timeout kill, whose truncated stdout is load-bearing
 * (an oversized agent write must stay reviewable, never diff to ''). A failure
 * with NO output yields a visible marker instead of a silent empty review.
 */
function noIndexDiff(root: string, relPath: string): string {
  const res = runGit(root, ['diff', '--no-index', '--', '/dev/null', relPath])
  if (res.ok || res.stdout.length > 0) return res.stdout
  return `[diff unavailable: ${relPath}]\n`
}

/**
 * Review diff: paths known to git (index or HEAD) via `git diff HEAD`;
 * everything else — untracked AND gitignored files — via
 * `git diff --no-index /dev/null <path>` so agent-CREATED files never review
 * blind (contracts §4: a write to an ignored `.env` must not be invisible).
 * Unborn-HEAD repos and non-repos synthesize content diffs the same way.
 * Explicit paths are normalized (`./x` ≡ `x`). Output truncated at
 * DIFF_MAX_BYTES; a git failure yields a visible marker, never a silent ''.
 */
export function diff(root: string, paths?: readonly string[]): string {
  const safePaths = paths?.filter((p) => isSafeRelPath(root, p))
  if (!isGitRepo(root)) {
    return truncateDiff((safePaths ?? []).map((p) => noIndexDiff(root, p)).join(''))
  }

  if (headSha(root) === null) {
    // Unborn HEAD: every file is new relative to history — synthesize all.
    const targets = safePaths ?? parsePorcelain(root).map((e) => e.path)
    return truncateDiff(targets.map((p) => noIndexDiff(root, p)).join(''))
  }

  const parts: string[] = []
  if (safePaths !== undefined) {
    const requested = safePaths.map((p) => normalize(p))
    // Route on index/HEAD membership, NOT porcelain: ignored-but-present files
    // have no porcelain entry yet must never diff empty. On ls-files failure
    // the set is empty, which fails toward the visible no-index synthesis.
    const indexed = runGit(root, ['ls-files', '-z', '--', ...literalPathspecs(requested)])
    const indexSet = new Set(
      indexed.ok ? indexed.stdout.split('\0').filter((p) => p.length > 0) : []
    )
    const tracked: string[] = []
    const synthesized: string[] = []
    for (const p of requested) {
      const known = indexSet.has(p) || runGit(root, ['cat-file', '-e', `HEAD:${p}`]).ok
      if (known) tracked.push(p)
      else synthesized.push(p)
    }
    if (tracked.length > 0) {
      const res = runGit(root, ['diff', 'HEAD', '--', ...literalPathspecs(tracked)])
      if (res.ok || res.stdout.length > 0) parts.push(res.stdout)
      else parts.push(`[diff unavailable: ${tracked.join(', ')}]\n`)
    }
    for (const p of synthesized) parts.push(noIndexDiff(root, p))
  } else {
    const res = runGit(root, ['diff', 'HEAD'])
    if (res.ok || res.stdout.length > 0) parts.push(res.stdout)
    else parts.push('[diff unavailable]\n')
    const untracked = parsePorcelain(root).filter((e) => e.code === '??')
    for (const e of untracked) parts.push(noIndexDiff(root, e.path))
  }
  return truncateDiff(parts.join(''))
}

/**
 * Paths `git add` would REFUSE: gitignored and absent from both the index
 * and HEAD. Tracked-but-ignored files stage fine and are not returned.
 * The approve path must exclude these before commitApproved — `git add`
 * exits 1 on any ignored pathname while still staging the rest, which would
 * brick the whole item on retry (workstation step 3 review blocker).
 */
export function ignoredUntracked(root: string, paths: readonly string[]): readonly string[] {
  if (!isGitRepo(root) || paths.length === 0) return []
  const requested = paths.map((p) => normalize(p))
  // check-ignore treats input as pathnames (not pathspecs) — literal-safe.
  // `-z` REQUIRES `--stdin` (arg mode with -z is fatal exit 128), and -z is
  // non-negotiable: without it git C-quotes unusual pathnames in stdout and
  // the set lookups below would miss them. Exit 0 = some ignored, 1 = none;
  // any failure yields empty stdout, filtering nothing, so commitApproved
  // surfaces the real git failure instead of silently skipping paths.
  const ignored = runGitWithInput(
    root,
    ['check-ignore', '-z', '--stdin'],
    requested.join('\0') + '\0'
  )
  const ignoredSet = new Set(ignored.stdout.split('\0').filter((p) => p.length > 0))
  if (ignoredSet.size === 0) return []
  const indexed = runGit(root, ['ls-files', '-z', '--', ...literalPathspecs(requested)])
  const indexSet = new Set(indexed.ok ? indexed.stdout.split('\0').filter((p) => p.length > 0) : [])
  return requested.filter(
    (p) =>
      ignoredSet.has(p) && !indexSet.has(p) && !runGit(root, ['cat-file', '-e', `HEAD:${p}`]).ok
  )
}

/**
 * Commit exactly the approved paths with Machina attribution trailers.
 * Explicit user action. Staging is `git add -- <paths>` (never -A) and the commit is
 * pathspec-limited, so user-staged bystander files stay staged and untouched.
 */
export function commitApproved(root: string, opts: CommitApprovedOpts): GitOpResult {
  if (!isGitRepo(root)) return { ok: false, reason: 'not-a-git-repo' }
  if (!SAFE_ID_RE.test(opts.agentId)) return { ok: false, reason: 'invalid-agent-id' }
  if (!SAFE_ID_RE.test(opts.threadId)) return { ok: false, reason: 'invalid-thread-id' }
  if (opts.paths.length === 0) return { ok: false, reason: 'nothing-to-commit' }
  const bad = findInvalidPath(root, opts.paths)
  if (bad !== null) return { ok: false, reason: `invalid-path: ${bad}` }

  let subject = (opts.message.split('\n')[0] ?? '').trim()
  if (subject.length === 0) return { ok: false, reason: 'empty-message' }
  // A subject forged to look like an attribution trailer is neutralized.
  if (subject.startsWith(MACHINA_TRAILER_PREFIX)) subject = `(neutralized) ${subject}`

  const specs = literalPathspecs(opts.paths)
  const dirty = runGit(root, [
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=all',
    '--',
    ...specs
  ])
  if (!dirty.ok) return { ok: false, reason: 'git-failed' }
  if (dirty.stdout.length === 0) return { ok: false, reason: 'nothing-to-commit' }

  const add = runGit(root, ['add', '--', ...specs])
  if (!add.ok) return { ok: false, reason: 'git-failed' }

  const trailers = `${TRAILER_AGENT}: ${opts.agentId}\n${TRAILER_SESSION}: ${opts.threadId}`
  const commit = runGit(root, [
    'commit',
    '--no-verify',
    '-m',
    subject,
    '-m',
    trailers,
    '--',
    ...specs
  ])
  if (!commit.ok) return { ok: false, reason: 'git-failed' }

  const sha = headSha(root)
  return sha !== null ? { ok: true, sha } : { ok: true }
}

interface TrailerLogRecord {
  readonly sha: string
  /** ISO 8601 author date. */
  readonly date: string
  readonly subject: string
  /** Machina-Agent trailer values (one per trailer line). */
  readonly agentIds: readonly string[]
}

interface TrailerLog {
  /** Every commit, newest first (git log order). */
  readonly records: readonly TrailerLogRecord[]
  /** Shas named in any Machina-Reverts trailer — excluded from later reverts. */
  readonly reverted: ReadonlySet<string>
}

/** Only full 40-hex shas may enter the Machina-Reverts exclusion set (v1.2.7). */
const FULL_SHA_RE = /^[0-9a-f]{40}$/

/**
 * The one bounded git-log trailer walk (contracts §2, v1.2.5): shared by
 * revertAgent and listAgentCommits so both enumerate agent commits — and the
 * Machina-Reverts exclusions — identically. `%s` is the LAST field so a
 * subject containing the field separator re-joins intact. Null on failure.
 *
 * Injection-proof by construction (v1.2.7): trailer VALUES are the only
 * attacker-elastic fields, and a forged value carrying `\x1f` shifts every
 * later field. The Machina-Reverts field therefore comes BEFORE the agent
 * field — a separator smuggled into a Machina-Agent value can only push
 * content AWAY from the exclusion set (into the subject), never into it —
 * and each token is validated before use: exclusion-set entries must be full
 * 40-hex shas, agent ids must pass SAFE_ID_RE (every app-minted id did at
 * commit time; revertAgent refuses non-conforming ids anyway). Direct
 * Machina-Reverts forgery remains the accepted §4 shell-access residual.
 */
function readTrailerLog(root: string): TrailerLog | null {
  const log = runGit(root, [
    'log',
    '-z',
    `--format=%H%x1f%aI%x1f%(trailers:key=${TRAILER_REVERTS},valueonly)%x1f%(trailers:key=${TRAILER_AGENT},valueonly)%x1f%s`
  ])
  if (!log.ok) return null

  const records: TrailerLogRecord[] = []
  const reverted = new Set<string>()
  for (const record of log.stdout.split('\0')) {
    const fields = record.split('\x1f')
    const [sha, date, revertsField, agentField] = fields
    if (sha === undefined || sha.length === 0 || agentField === undefined) continue
    records.push({
      sha,
      date: date ?? '',
      subject: fields.slice(4).join('\x1f'),
      agentIds: agentField.split('\n').filter((v) => SAFE_ID_RE.test(v))
    })
    for (const value of (revertsField ?? '').split(/\s+/)) {
      if (FULL_SHA_RE.test(value)) reverted.add(value)
    }
  }
  return { records, reverted }
}

/**
 * Read-only twin of revertAgent's enumeration (contracts §2, v1.2.5): every
 * unreverted agent-attributed commit grouped by exact Machina-Agent trailer
 * value. Ids are trailer-sourced, so commits from a since-deleted harness
 * (or an adapter identity) stay listed and revertable. Shas newest first
 * within each group; group order follows each agent's newest commit.
 * Non-repo → [] (nothing to enumerate). Git-log FAILURE → null (v1.2.7): a
 * failed walk is NOT "no unreverted agent commits" — the IPC layer surfaces
 * it as a structured error instead of the false empty v1.2.5 forbids.
 */
export function listAgentCommits(root: string): readonly AgentCommits[] | null {
  if (!isGitRepo(root)) return []
  const log = readTrailerLog(root)
  if (log === null) return null

  const groups = new Map<string, { shas: string[]; lastSubject: string; lastDate: string }>()
  for (const record of log.records) {
    if (log.reverted.has(record.sha)) continue
    // De-duped: a commit carrying the same trailer twice adds its sha once.
    for (const agentId of new Set(record.agentIds)) {
      const group = groups.get(agentId)
      if (group === undefined) {
        groups.set(agentId, {
          shas: [record.sha],
          lastSubject: record.subject,
          lastDate: record.date
        })
      } else {
        group.shas.push(record.sha)
      }
    }
  }
  return [...groups.entries()].map(([agentId, group]) => ({
    agentId,
    shas: group.shas,
    lastSubject: group.lastSubject,
    lastDate: group.lastDate
  }))
}

/**
 * Revert every commit attributed to `agentId` (exact trailer value match, in
 * JS — no --grep injection/prefix collisions), newest first, as ONE revert
 * commit. The revert commit carries a Machina-Reverts trailer listing the
 * reverted shas (never Machina-Agent), so already-reverted commits are
 * excluded from a later revertAgent instead of being re-enumerated. On
 * conflict the whole sequence is aborted and the working tree is left clean.
 *
 * v1.2.7 hardening (post-merge review):
 *   - `onWillRevert(paths)` fires with the union of paths the revert will
 *     touch BEFORE the tree changes — the IPC layer suppresses the watcher's
 *     echo of the gate's own writes on exactly these paths, so a revert
 *     during a live turn is never attributed to the agent;
 *   - the final commit is PATHSPEC-LIMITED to those same paths (the
 *     commitApproved discipline): user-staged bystander files stay staged
 *     and untouched instead of being silently swept into the revert commit.
 */
export function revertAgent(
  root: string,
  agentId: string,
  onWillRevert?: (paths: readonly string[]) => void
): GitOpResult {
  if (!isGitRepo(root)) return { ok: false, reason: 'not-a-git-repo' }
  if (!SAFE_ID_RE.test(agentId)) return { ok: false, reason: 'invalid-agent-id' }

  const log = readTrailerLog(root)
  if (log === null) return { ok: false, reason: 'git-failed' }

  const shas = log.records
    .filter((r) => r.agentIds.some((v) => v === agentId) && !log.reverted.has(r.sha))
    .map((r) => r.sha)
  if (shas.length === 0) return { ok: false, reason: 'no-commits-for-agent' }

  // Union of paths the reverted commits touched, computed BEFORE any tree
  // change (fail-safe: a failed walk aborts with the tree untouched).
  // `--root` covers a root commit; `-z` keeps unusual filenames literal.
  const touched = new Set<string>()
  for (const sha of shas) {
    const tree = runGit(root, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      sha
    ])
    if (!tree.ok) return { ok: false, reason: 'git-failed' }
    for (const p of tree.stdout.split('\0')) {
      if (p.length > 0) touched.add(p)
    }
  }
  const paths = [...touched].sort()
  onWillRevert?.(paths)

  // git log order is newest-first; one sequencer run so --abort restores everything.
  const revert = runGit(root, ['revert', '--no-commit', '--no-edit', ...shas])
  if (!revert.ok) {
    runGit(root, ['revert', '--abort'])
    return { ok: false, reason: 'revert-conflict' }
  }

  // Pathspec-limited (v1.2.7): commits exactly the reverted paths' state.
  // --allow-empty keeps the net-zero case (mutually cancelling commits)
  // minting its Machina-Reverts marker commit, still without touching the
  // index entries of anything the user staged. --only is explicit for the
  // ZERO-paths edge (a forged empty agent commit): a bare `--` means "no
  // pathspec" and would sweep the staged index; --only with no paths mints
  // the empty marker commit instead (verified empirically).
  const commit = runGit(root, [
    'commit',
    '--no-verify',
    '--allow-empty',
    '--only',
    '-m',
    `Revert agent changes (${agentId})`,
    '-m',
    `${TRAILER_REVERTS}: ${shas.join(' ')}`,
    ...(paths.length > 0 ? ['--', ...literalPathspecs(paths)] : [])
  ])
  if (!commit.ok) {
    // Commit failed AFTER the reverse patches were applied: abort rewinds the
    // worktree/index to the pre-revert state instead of leaving them half-applied.
    runGit(root, ['revert', '--abort'])
    return { ok: false, reason: 'git-failed' }
  }
  // Clear any lingering sequencer state from the --no-commit run (best-effort).
  runGit(root, ['revert', '--quit'])

  const sha = headSha(root)
  return sha !== null ? { ok: true, sha } : { ok: true }
}

/**
 * Reject flow. Tracked paths are restored from HEAD (worktree + index);
 * untracked paths go through the injected `removeFile` callback — the IPC
 * layer wires `shell.trashItem` so deletion stays recoverable. Non-repo →
 * structured no-op (nothing to restore from).
 */
export async function discard(
  root: string,
  paths: readonly string[],
  removeFile: (absPath: string) => Promise<void>
): Promise<GitOpResult> {
  if (!isGitRepo(root)) return { ok: false, reason: 'not-a-git-repo' }
  if (paths.length === 0) return { ok: true }
  const bad = findInvalidPath(root, paths)
  if (bad !== null) return { ok: false, reason: `invalid-path: ${bad}` }

  // Normalized so `./x` matches ls-files' `x` — a mismatch would misroute a
  // tracked file to the trash path instead of restore-from-HEAD.
  const requested = paths.map((p) => normalize(p))
  const lsFiles = runGit(root, ['ls-files', '-z', '--', ...literalPathspecs(requested)])
  // Fail CLOSED: an empty tracked set on ls-files failure would trash tracked
  // files (removeFile) instead of restoring them from HEAD.
  if (!lsFiles.ok) return { ok: false, reason: 'git-failed' }
  const tracked = new Set(lsFiles.stdout.split('\0').filter((p) => p.length > 0))
  const trackedPaths = requested.filter((p) => tracked.has(p))
  const untrackedPaths = requested.filter((p) => !tracked.has(p))

  if (trackedPaths.length > 0) {
    const res = runGit(root, [
      'restore',
      '--source=HEAD',
      '--worktree',
      '--staged',
      '--',
      ...literalPathspecs(trackedPaths)
    ])
    if (!res.ok) return { ok: false, reason: 'git-failed' }
  }

  for (const p of untrackedPaths) {
    const abs = join(root, p)
    if (!existsSync(abs)) continue
    try {
      await removeFile(abs)
    } catch {
      return { ok: false, reason: `remove-failed: ${p}` }
    }
  }
  return { ok: true }
}
