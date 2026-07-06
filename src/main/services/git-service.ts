import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path'
import { TE_DIR } from '@shared/constants'
import {
  MACHINA_TRAILER_PREFIX,
  SAFE_ID_RE,
  TRAILER_AGENT,
  TRAILER_REVERTS,
  TRAILER_SESSION
} from '@shared/git-types'
import type {
  CommitApprovedOpts,
  GitFileState,
  GitOpResult,
  GitStatusEntry
} from '@shared/git-types'

const GIT_TIMEOUT_MS = 5000

/** Presence of this file disables auto-commit for the vault. */
const OPT_OUT_FLAG = 'no-auto-commit'

interface PreAgentCommitResult {
  readonly committed: boolean
  readonly reason?: 'not-a-git-repo' | 'opted-out' | 'nothing-to-commit' | 'git-failed'
  readonly error?: string
}

export function isGitRepo(vaultRoot: string): boolean {
  return existsSync(join(vaultRoot, '.git'))
}

export function isAutoCommitOptedOut(vaultRoot: string): boolean {
  return existsSync(join(vaultRoot, TE_DIR, OPT_OUT_FLAG))
}

/**
 * Snapshot the vault before an agent run so the user can roll back with
 * `git reset --hard HEAD~1` if the agent misbehaves. No-op when the vault
 * is not a git repo, when opted out via `.te/no-auto-commit`, or when
 * there are no changes to commit. Never throws — on failure returns a
 * structured reason so the caller can log but proceed with the spawn.
 */
export function commitPreAgentSnapshot(vaultRoot: string, sessionId: string): PreAgentCommitResult {
  if (!isGitRepo(vaultRoot)) return { committed: false, reason: 'not-a-git-repo' }
  if (isAutoCommitOptedOut(vaultRoot)) return { committed: false, reason: 'opted-out' }

  const opts = {
    cwd: vaultRoot,
    encoding: 'utf-8' as const,
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe']
  }

  try {
    const status = execFileSync('git', ['status', '--porcelain'], opts).trim()
    if (status.length === 0) return { committed: false, reason: 'nothing-to-commit' }

    execFileSync('git', ['add', '-A'], opts)
    execFileSync(
      'git',
      ['commit', '-m', `pre-agent snapshot (${sessionId.slice(0, 8)})`, '--no-verify'],
      opts
    )
    return { committed: true }
  } catch (err) {
    return {
      committed: false,
      reason: 'git-failed',
      error: err instanceof Error ? err.message : String(err)
    }
  }
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
  try {
    const stdout = execFileSync('git', [...args], {
      cwd: root,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe']
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
 * Commit exactly the approved paths with Machina attribution trailers.
 * Explicit user action — proceeds regardless of the no-auto-commit opt-out.
 * Staging is `git add -- <paths>` (never -A) and the commit is
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

/**
 * Revert every commit attributed to `agentId` (exact trailer value match, in
 * JS — no --grep injection/prefix collisions), newest first, as ONE revert
 * commit. The revert commit carries a Machina-Reverts trailer listing the
 * reverted shas (never Machina-Agent), so already-reverted commits are
 * excluded from a later revertAgent instead of being re-enumerated. On
 * conflict the whole sequence is aborted and the working tree is left clean.
 */
export function revertAgent(root: string, agentId: string): GitOpResult {
  if (!isGitRepo(root)) return { ok: false, reason: 'not-a-git-repo' }
  if (!SAFE_ID_RE.test(agentId)) return { ok: false, reason: 'invalid-agent-id' }

  const log = runGit(root, [
    'log',
    '-z',
    `--format=%H%x1f%(trailers:key=${TRAILER_AGENT},valueonly)%x1f%(trailers:key=${TRAILER_REVERTS},valueonly)`
  ])
  if (!log.ok) return { ok: false, reason: 'git-failed' }

  const candidates: string[] = []
  const alreadyReverted = new Set<string>()
  for (const record of log.stdout.split('\0')) {
    const [sha, agentField, revertsField] = record.split('\x1f')
    if (sha === undefined || agentField === undefined) continue
    const agentValues = agentField.split('\n').filter((v) => v.length > 0)
    if (agentValues.some((v) => v === agentId)) candidates.push(sha)
    for (const value of (revertsField ?? '').split(/\s+/)) {
      if (value.length > 0) alreadyReverted.add(value)
    }
  }
  const shas = candidates.filter((sha) => !alreadyReverted.has(sha))
  if (shas.length === 0) return { ok: false, reason: 'no-commits-for-agent' }

  // git log order is newest-first; one sequencer run so --abort restores everything.
  const revert = runGit(root, ['revert', '--no-commit', '--no-edit', ...shas])
  if (!revert.ok) {
    runGit(root, ['revert', '--abort'])
    return { ok: false, reason: 'revert-conflict' }
  }

  const commit = runGit(root, [
    'commit',
    '--no-verify',
    '--allow-empty',
    '-m',
    `Revert agent changes (${agentId})`,
    '-m',
    `${TRAILER_REVERTS}: ${shas.join(' ')}`
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
