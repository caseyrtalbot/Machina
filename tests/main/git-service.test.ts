// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  symlinkSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  isGitRepo,
  headSha,
  status,
  diff,
  commitApproved,
  revertAgent,
  listAgentCommits,
  discard
} from '../../src/main/services/git-service'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'machina-git-service-test-'))
}

/** git init + local identity, but NO initial commit (unborn HEAD). */
function initUnbornRepo(dir: string): void {
  const opts = { cwd: dir, stdio: 'ignore' } as const
  execFileSync('git', ['init', '--quiet'], opts)
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts)
  execFileSync('git', ['config', 'user.name', 'Test'], opts)
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts)
}

function initGitRepo(dir: string): void {
  initUnbornRepo(dir)
  const opts = { cwd: dir, stdio: 'ignore' } as const
  // Seed an initial commit so HEAD exists — otherwise status/commit UX differs
  writeFileSync(join(dir, '.gitkeep'), '')
  execFileSync('git', ['add', '.'], opts)
  execFileSync('git', ['commit', '-m', 'initial', '--quiet', '--no-verify'], opts)
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

/** Write + commit a file directly (plain user commit, no trailers). */
function userCommit(dir: string, file: string, content: string, message: string): void {
  writeFileSync(join(dir, file), content)
  git(dir, 'add', '--', file)
  git(dir, 'commit', '--no-verify', '-m', message)
}

/** Write a file and commit it through commitApproved (carries agent trailers). */
function agentCommit(dir: string, agentId: string, file: string, content: string): string {
  writeFileSync(join(dir, file), content)
  const result = commitApproved(dir, {
    agentId,
    threadId: 'th-00000001',
    paths: [file],
    message: `agent writes ${file}`
  })
  expect(result.ok).toBe(true)
  return git(dir, 'rev-parse', 'HEAD')
}

describe('git-service', () => {
  let vaultRoot: string
  let outsideRoot: string | null = null

  beforeEach(() => {
    vaultRoot = makeTempDir()
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
    if (outsideRoot !== null) {
      rmSync(outsideRoot, { recursive: true, force: true })
      outsideRoot = null
    }
  })

  describe('isGitRepo', () => {
    it('returns false when .git directory is absent', () => {
      expect(isGitRepo(vaultRoot)).toBe(false)
    })

    it('returns true when .git directory exists', () => {
      initGitRepo(vaultRoot)
      expect(isGitRepo(vaultRoot)).toBe(true)
    })
  })

  describe('headSha', () => {
    it('returns null for a non-repo', () => {
      expect(headSha(vaultRoot)).toBeNull()
    })

    it('returns null for an unborn HEAD', () => {
      initUnbornRepo(vaultRoot)
      expect(headSha(vaultRoot)).toBeNull()
    })

    it('returns the current HEAD sha', () => {
      initGitRepo(vaultRoot)
      const sha = headSha(vaultRoot)
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
      expect(sha).toBe(git(vaultRoot, 'rev-parse', 'HEAD'))
    })
  })

  describe('status', () => {
    it('returns empty entries for a non-repo', () => {
      expect(status(vaultRoot)).toEqual([])
    })

    it('maps all five porcelain codes, including rename with origPath', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'mod.txt', 'original', 'add mod')
      userCommit(vaultRoot, 'del.txt', 'doomed', 'add del')
      userCommit(vaultRoot, 'ren-old.txt', 'moving', 'add ren')

      writeFileSync(join(vaultRoot, 'mod.txt'), 'changed') // M
      rmSync(join(vaultRoot, 'del.txt')) // D
      git(vaultRoot, 'mv', 'ren-old.txt', 'ren-new.txt') // R (staged)
      writeFileSync(join(vaultRoot, 'staged.txt'), 'new staged')
      git(vaultRoot, 'add', '--', 'staged.txt') // A
      writeFileSync(join(vaultRoot, 'untracked.txt'), 'new loose') // ??

      const entries = status(vaultRoot)
      const byPath = new Map(entries.map((e) => [e.path, e]))

      expect(byPath.get('mod.txt')?.state).toBe('modified')
      expect(byPath.get('del.txt')?.state).toBe('deleted')
      expect(byPath.get('staged.txt')?.state).toBe('added')
      expect(byPath.get('untracked.txt')?.state).toBe('added')
      const renamed = byPath.get('ren-new.txt')
      expect(renamed?.state).toBe('renamed')
      expect(renamed?.origPath).toBe('ren-old.txt')
    })
  })

  describe('diff', () => {
    it('produces a non-empty diff for an untracked file (the load-bearing case)', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'fresh.md'), 'brand new agent file\n')

      const explicit = diff(vaultRoot, ['fresh.md'])
      expect(explicit).toContain('fresh.md')
      expect(explicit).toContain('+brand new agent file')

      const all = diff(vaultRoot)
      expect(all).toContain('+brand new agent file')
    })

    it('diffs tracked modifications against HEAD', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'doc.md', 'old line\n', 'add doc')
      writeFileSync(join(vaultRoot, 'doc.md'), 'new line\n')

      const out = diff(vaultRoot, ['doc.md'])
      expect(out).toContain('-old line')
      expect(out).toContain('+new line')
    })

    it('combines tracked and untracked diffs in one call', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'doc.md', 'old line\n', 'add doc')
      writeFileSync(join(vaultRoot, 'doc.md'), 'new line\n')
      writeFileSync(join(vaultRoot, 'fresh.md'), 'fresh content\n')

      const out = diff(vaultRoot, ['doc.md', 'fresh.md'])
      expect(out).toContain('+new line')
      expect(out).toContain('+fresh content')
    })

    it('synthesizes content diffs on an unborn HEAD', () => {
      initUnbornRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'first.md'), 'unborn repo file\n')

      const out = diff(vaultRoot)
      expect(out).toContain('first.md')
      expect(out).toContain('+unborn repo file')
    })

    it('synthesizes content diffs in a non-repo when paths are given', () => {
      writeFileSync(join(vaultRoot, 'plain.md'), 'no repo here\n')

      const out = diff(vaultRoot, ['plain.md'])
      expect(out).toContain('plain.md')
      expect(out).toContain('+no repo here')
    })

    it('returns empty for a non-repo without paths', () => {
      expect(diff(vaultRoot)).toBe('')
    })

    it('produces a non-empty diff for a gitignored file (agent writes to .env must not be invisible)', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, '.gitignore', 'secret.env\n', 'add gitignore')
      writeFileSync(join(vaultRoot, 'secret.env'), 'SECRET=1\n')

      const out = diff(vaultRoot, ['secret.env'])
      expect(out).toContain('secret.env')
      expect(out).toContain('+SECRET=1')
    })

    it('normalizes ./-prefixed paths so untracked files still synthesize a content diff', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'fresh.md'), 'brand new agent file\n')

      const out = diff(vaultRoot, ['./fresh.md'])
      expect(out).toContain('+brand new agent file')
    })

    it('does not read files outside the root through a symlinked directory', () => {
      initGitRepo(vaultRoot)
      outsideRoot = makeTempDir()
      writeFileSync(join(outsideRoot, 'secret.txt'), 'TOP-SECRET\n')
      symlinkSync(outsideRoot, join(vaultRoot, 'link'))

      const out = diff(vaultRoot, ['link/secret.txt'])
      expect(out).not.toContain('TOP-SECRET')
    })

    it('truncated diffs still differ when the change lands beyond the truncation cutoff', () => {
      initGitRepo(vaultRoot)
      const prefix = 'x'.repeat(3_000_000)
      writeFileSync(join(vaultRoot, 'big.txt'), `${prefix}TAIL-A\n`)
      const first = diff(vaultRoot, ['big.txt'])
      expect(first).toContain('[diff truncated at')

      writeFileSync(join(vaultRoot, 'big.txt'), `${prefix}TAIL-B\n`)
      const second = diff(vaultRoot, ['big.txt'])
      expect(second).toContain('[diff truncated at')
      // The stale-diff guard compares these strings: they must not collide.
      expect(second).not.toBe(first)
    })

    it('a diff larger than the git output buffer stays reviewable (never empty)', () => {
      initGitRepo(vaultRoot)
      // 11MB > MAX_GIT_BUFFER_BYTES (10MB): execFileSync kills the child, the
      // truncated stdout must still be captured and truncated, not dropped.
      writeFileSync(join(vaultRoot, 'huge.txt'), 'y'.repeat(11 * 1024 * 1024))

      const out = diff(vaultRoot, ['huge.txt'])
      expect(out.length).toBeGreaterThan(0)
      expect(out).toContain('[diff truncated at')
    })
  })

  describe('commitApproved', () => {
    const opts = (
      over: Partial<Parameters<typeof commitApproved>[1]> = {}
    ): Parameters<typeof commitApproved>[1] => ({
      agentId: 'test-fixer',
      threadId: 'th-9f2c41aa',
      paths: ['note.md'],
      message: 'fix: correct the note',
      ...over
    })

    it('round-trips both trailers through git log', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'note.md'), 'content')

      const result = commitApproved(vaultRoot, opts())
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.sha).toBe(git(vaultRoot, 'rev-parse', 'HEAD'))

      const agent = git(vaultRoot, 'log', '-1', '--format=%(trailers:key=Machina-Agent,valueonly)')
      const session = git(
        vaultRoot,
        'log',
        '-1',
        '--format=%(trailers:key=Machina-Session,valueonly)'
      )
      expect(agent).toBe('test-fixer')
      expect(session).toBe('th-9f2c41aa')
      expect(git(vaultRoot, 'log', '-1', '--format=%s')).toBe('fix: correct the note')
    })

    it('stages exactly the given paths — bystander dirty and user-staged files untouched', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'bystander.txt', 'base', 'add bystander')
      userCommit(vaultRoot, 'userstaged.txt', 'base', 'add userstaged')

      writeFileSync(join(vaultRoot, 'bystander.txt'), 'dirty edit') // unstaged
      writeFileSync(join(vaultRoot, 'userstaged.txt'), 'user staged edit')
      git(vaultRoot, 'add', '--', 'userstaged.txt') // staged by the user
      writeFileSync(join(vaultRoot, 'agentfile.txt'), 'agent output')

      const result = commitApproved(vaultRoot, opts({ paths: ['agentfile.txt'] }))
      expect(result.ok).toBe(true)

      const committed = git(vaultRoot, 'show', '--name-only', '--format=', 'HEAD')
      expect(committed).toBe('agentfile.txt')

      // Untrimmed: the leading space of ' M' is significant in porcelain output.
      const porcelain = execFileSync('git', ['status', '--porcelain'], {
        cwd: vaultRoot,
        encoding: 'utf-8'
      })
      expect(porcelain).toContain(' M bystander.txt')
      expect(porcelain).toContain('M  userstaged.txt')
    })

    it('rejects unsafe agentId and threadId', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'note.md'), 'content')

      expect(commitApproved(vaultRoot, opts({ agentId: 'bad id!' }))).toEqual({
        ok: false,
        reason: 'invalid-agent-id'
      })
      expect(commitApproved(vaultRoot, opts({ agentId: '-lead' }))).toEqual({
        ok: false,
        reason: 'invalid-agent-id'
      })
      expect(commitApproved(vaultRoot, opts({ threadId: 'th 1; rm -rf' }))).toEqual({
        ok: false,
        reason: 'invalid-thread-id'
      })
    })

    it('rejects absolute, dash-leading, and root-escaping paths', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'note.md'), 'content')

      for (const bad of [join(vaultRoot, 'note.md'), '-note.md', '../escape.md']) {
        const result = commitApproved(vaultRoot, opts({ paths: [bad] }))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toContain('invalid-path')
      }
    })

    it('returns structured errors for non-repo, empty paths, and clean paths', () => {
      expect(commitApproved(vaultRoot, opts())).toEqual({ ok: false, reason: 'not-a-git-repo' })

      initGitRepo(vaultRoot)
      expect(commitApproved(vaultRoot, opts({ paths: [] }))).toEqual({
        ok: false,
        reason: 'nothing-to-commit'
      })

      userCommit(vaultRoot, 'clean.txt', 'committed', 'add clean')
      expect(commitApproved(vaultRoot, opts({ paths: ['clean.txt'] }))).toEqual({
        ok: false,
        reason: 'nothing-to-commit'
      })
    })

    it('treats pathspec metacharacters literally — * commits nothing, bystanders untouched', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'user.txt', 'base', 'add user file')
      writeFileSync(join(vaultRoot, 'user.txt'), 'uncommitted user edit')
      writeFileSync(join(vaultRoot, 'agent.txt'), 'agent output')
      const before = git(vaultRoot, 'rev-list', '--count', 'HEAD')

      for (const magic of ['*', ':/']) {
        const result = commitApproved(vaultRoot, opts({ paths: [magic] }))
        expect(result).toEqual({ ok: false, reason: 'nothing-to-commit' })
      }

      expect(git(vaultRoot, 'rev-list', '--count', 'HEAD')).toBe(before)
      const porcelain = git(vaultRoot, 'status', '--porcelain')
      expect(porcelain).toContain('user.txt')
      expect(porcelain).toContain('agent.txt')
    })

    it('rejects paths that escape the root through a symlinked directory', () => {
      initGitRepo(vaultRoot)
      outsideRoot = makeTempDir()
      writeFileSync(join(outsideRoot, 'secret.txt'), 'TOP-SECRET\n')
      symlinkSync(outsideRoot, join(vaultRoot, 'link'))

      const result = commitApproved(vaultRoot, opts({ paths: ['link/secret.txt'] }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('invalid-path')
    })

    it('neutralizes a subject line forged as a Machina- trailer', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'note.md'), 'content')

      const result = commitApproved(
        vaultRoot,
        opts({ agentId: 'real-agent', message: 'Machina-Agent: evil' })
      )
      expect(result.ok).toBe(true)

      const subject = git(vaultRoot, 'log', '-1', '--format=%s')
      expect(subject.startsWith('Machina-')).toBe(false)

      const agent = git(vaultRoot, 'log', '-1', '--format=%(trailers:key=Machina-Agent,valueonly)')
      expect(agent).toBe('real-agent')
    })
  })

  describe('revertAgent', () => {
    it('reverts only the named agent across multiple agents (A,A,B ⇒ revert A only)', () => {
      initGitRepo(vaultRoot)
      const shaA1 = agentCommit(vaultRoot, 'alpha', 'a1.txt', 'alpha one')
      const shaA2 = agentCommit(vaultRoot, 'alpha', 'a2.txt', 'alpha two')
      agentCommit(vaultRoot, 'beta', 'b1.txt', 'beta one')

      const result = revertAgent(vaultRoot, 'alpha')
      expect(result.ok).toBe(true)

      expect(existsSync(join(vaultRoot, 'a1.txt'))).toBe(false)
      expect(existsSync(join(vaultRoot, 'a2.txt'))).toBe(false)
      expect(existsSync(join(vaultRoot, 'b1.txt'))).toBe(true)

      const reverts = git(
        vaultRoot,
        'log',
        '-1',
        '--format=%(trailers:key=Machina-Reverts,valueonly)'
      )
      const agent = git(vaultRoot, 'log', '-1', '--format=%(trailers:key=Machina-Agent,valueonly)')
      expect(reverts.split(/\s+/).sort()).toEqual([shaA1, shaA2].sort())
      expect(agent).toBe('')
    })

    it('matches agent ids exactly — fixer does not match fixer-2', () => {
      initGitRepo(vaultRoot)
      agentCommit(vaultRoot, 'fixer', 'f1.txt', 'by fixer')
      agentCommit(vaultRoot, 'fixer-2', 'f2.txt', 'by fixer-2')

      const result = revertAgent(vaultRoot, 'fixer')
      expect(result.ok).toBe(true)
      expect(existsSync(join(vaultRoot, 'f1.txt'))).toBe(false)
      expect(existsSync(join(vaultRoot, 'f2.txt'))).toBe(true)
    })

    it('reverts stacked commits on the same file (requires newest-first ordering)', () => {
      initGitRepo(vaultRoot)
      // C1 creates f.txt, C2 edits it: reverting oldest-first conflicts
      // (modify/delete); only the spec'd newest-first sequence succeeds.
      agentCommit(vaultRoot, 'alpha', 'f.txt', 'v1')
      agentCommit(vaultRoot, 'alpha', 'f.txt', 'v2')

      const result = revertAgent(vaultRoot, 'alpha')
      expect(result.ok).toBe(true)
      expect(existsSync(join(vaultRoot, 'f.txt'))).toBe(false)
      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
    })

    it('restores the pre-revert state when the final commit fails', () => {
      initGitRepo(vaultRoot)
      agentCommit(vaultRoot, 'alpha', 'a1.txt', 'alpha content')
      const before = git(vaultRoot, 'rev-list', '--count', 'HEAD')
      // Break ONLY commit-object creation (signing): revert --no-commit still
      // applies cleanly, then the revert commit itself fails.
      git(vaultRoot, 'config', 'commit.gpgsign', 'true')
      git(vaultRoot, 'config', 'gpg.program', '/nonexistent-gpg-binary')

      const result = revertAgent(vaultRoot, 'alpha')
      expect(result).toEqual({ ok: false, reason: 'git-failed' })

      // No half-applied reverse patches: worktree clean, agent file intact.
      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
      expect(readFileSync(join(vaultRoot, 'a1.txt'), 'utf-8')).toBe('alpha content')
      expect(git(vaultRoot, 'rev-list', '--count', 'HEAD')).toBe(before)
    })

    it('does not re-enumerate revert commits on a second call', () => {
      initGitRepo(vaultRoot)
      agentCommit(vaultRoot, 'alpha', 'a1.txt', 'alpha one')

      expect(revertAgent(vaultRoot, 'alpha').ok).toBe(true)
      const countAfterFirst = git(vaultRoot, 'rev-list', '--count', 'HEAD')

      const second = revertAgent(vaultRoot, 'alpha')
      expect(second).toEqual({ ok: false, reason: 'no-commits-for-agent' })
      expect(git(vaultRoot, 'rev-list', '--count', 'HEAD')).toBe(countAfterFirst)
    })

    it('aborts on conflict and leaves the working tree clean', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'shared.txt', 'line1\n', 'base')
      agentCommit(vaultRoot, 'alpha', 'shared.txt', 'agent version\n')
      userCommit(vaultRoot, 'shared.txt', 'user version\n', 'user follow-up')

      const result = revertAgent(vaultRoot, 'alpha')
      expect(result).toEqual({ ok: false, reason: 'revert-conflict' })

      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
      expect(readFileSync(join(vaultRoot, 'shared.txt'), 'utf-8')).toBe('user version\n')
    })

    it('returns structured errors for non-repo and unsafe agent id', () => {
      expect(revertAgent(vaultRoot, 'alpha')).toEqual({ ok: false, reason: 'not-a-git-repo' })
      initGitRepo(vaultRoot)
      expect(revertAgent(vaultRoot, 'bad id!')).toEqual({ ok: false, reason: 'invalid-agent-id' })
    })

    it('returns no-commits-for-agent for an id that never appears in any trailer', () => {
      // Trailer enumeration IS the id validation (contracts §4 v1.2.2):
      // registry membership is deliberately not consulted, so a well-formed
      // but never-committed id gets the structured error, not a throw.
      initGitRepo(vaultRoot)
      agentCommit(vaultRoot, 'alpha', 'a1.txt', 'alpha one')
      expect(revertAgent(vaultRoot, 'ghost')).toEqual({ ok: false, reason: 'no-commits-for-agent' })
      expect(existsSync(join(vaultRoot, 'a1.txt'))).toBe(true)
    })

    it('post-tamper commits carry adapter identity, so the forged slug scopes to nothing (v1.2.2)', () => {
      // The frontmatter-tamper repro's revert half: pre-tamper turns committed
      // as the bound slug; after the tamper, binding validation degrades the
      // turn to adapter identity, so the forged slug never enters a trailer.
      initGitRepo(vaultRoot)
      const preTamper = agentCommit(vaultRoot, 'agent-x', 'x1.txt', 'bound turn')
      // Tampered turn: attribution fell back to the adapter identity.
      agentCommit(vaultRoot, 'cli-claude', 'x2.txt', 'post-tamper turn')

      expect(revertAgent(vaultRoot, 'agent-y')).toEqual({
        ok: false,
        reason: 'no-commits-for-agent'
      })
      expect(existsSync(join(vaultRoot, 'x1.txt'))).toBe(true)
      expect(existsSync(join(vaultRoot, 'x2.txt'))).toBe(true)

      // revertAgent('agent-x') still finds exactly the pre-tamper commit.
      const result = revertAgent(vaultRoot, 'agent-x')
      expect(result.ok).toBe(true)
      expect(existsSync(join(vaultRoot, 'x1.txt'))).toBe(false)
      expect(existsSync(join(vaultRoot, 'x2.txt'))).toBe(true)
      const reverts = git(
        vaultRoot,
        'log',
        '-1',
        '--format=%(trailers:key=Machina-Reverts,valueonly)'
      )
      expect(reverts).toBe(preTamper)
    })

    it('approve-then-revertAgent restores the exact pre-agent tree (modified + created)', () => {
      // Step-5 evidence gate G2: the flow that replaces the pre-agent snapshot
      // (approve → revertAgent) must land a tree byte-identical to the
      // pre-agent state — the same guarantee `git reset --hard HEAD~1` gave.
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'doc.md', 'original content\n', 'add doc')
      const preAgentTree = git(vaultRoot, 'rev-parse', 'HEAD^{tree}')

      // Agent modifies a tracked file AND creates a new one; user approves both.
      writeFileSync(join(vaultRoot, 'doc.md'), 'agent rewrite\n')
      writeFileSync(join(vaultRoot, 'new.txt'), 'agent addition\n')
      const approved = commitApproved(vaultRoot, {
        agentId: 'fixer',
        threadId: 'th-00000001',
        paths: ['doc.md', 'new.txt'],
        message: 'feat: agent change'
      })
      expect(approved.ok).toBe(true)

      const reverted = revertAgent(vaultRoot, 'fixer')
      expect(reverted.ok).toBe(true)
      expect(git(vaultRoot, 'rev-parse', 'HEAD^{tree}')).toBe(preAgentTree)
      expect(readFileSync(join(vaultRoot, 'doc.md'), 'utf-8')).toBe('original content\n')
      expect(existsSync(join(vaultRoot, 'new.txt'))).toBe(false)
      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
    })
  })

  describe('listAgentCommits (workstation step 5, contracts §2 v1.2.5)', () => {
    it('groups commits per agent, shas newest first, with last subject and date', () => {
      initGitRepo(vaultRoot)
      const shaA1 = agentCommit(vaultRoot, 'alpha', 'a1.txt', 'alpha one')
      const shaB1 = agentCommit(vaultRoot, 'beta', 'b1.txt', 'beta one')
      const shaA2 = agentCommit(vaultRoot, 'alpha', 'a2.txt', 'alpha two')

      const groups = listAgentCommits(vaultRoot)
      // Group order follows each agent's newest commit (alpha committed last).
      expect(groups.map((g) => g.agentId)).toEqual(['alpha', 'beta'])

      const alpha = groups.find((g) => g.agentId === 'alpha')!
      expect(alpha.shas).toEqual([shaA2, shaA1])
      expect(alpha.lastSubject).toBe('agent writes a2.txt')
      expect(Number.isNaN(Date.parse(alpha.lastDate))).toBe(false)

      const beta = groups.find((g) => g.agentId === 'beta')!
      expect(beta.shas).toEqual([shaB1])
      expect(beta.lastSubject).toBe('agent writes b1.txt')
    })

    it('excludes shas named in a Machina-Reverts trailer and never lists the revert commit', () => {
      initGitRepo(vaultRoot)
      agentCommit(vaultRoot, 'alpha', 'a1.txt', 'alpha one')
      const shaB = agentCommit(vaultRoot, 'beta', 'b1.txt', 'beta one')
      expect(revertAgent(vaultRoot, 'alpha').ok).toBe(true)

      const groups = listAgentCommits(vaultRoot)
      expect(groups.map((g) => g.agentId)).toEqual(['beta'])
      expect(groups[0].shas).toEqual([shaB])
    })

    it('matches ids exactly — fixer and fixer-2 are separate groups', () => {
      initGitRepo(vaultRoot)
      const shaFixer = agentCommit(vaultRoot, 'fixer', 'f1.txt', 'by fixer')
      const shaFixer2 = agentCommit(vaultRoot, 'fixer-2', 'f2.txt', 'by fixer-2')

      const groups = listAgentCommits(vaultRoot)
      expect(groups.find((g) => g.agentId === 'fixer')?.shas).toEqual([shaFixer])
      expect(groups.find((g) => g.agentId === 'fixer-2')?.shas).toEqual([shaFixer2])
    })

    it('lists ids that are not registry-known — a deleted harness stays revertable', () => {
      // Trailer enumeration is the only source (judge graft, step-5 spec): no
      // registry lookup exists on this path, so a slug whose harness dir was
      // deleted keeps its group AND revertAgent accepts the same id.
      initGitRepo(vaultRoot)
      const sha = agentCommit(vaultRoot, 'deleted-harness', 'd.txt', 'orphan commit')

      const groups = listAgentCommits(vaultRoot)
      expect(groups).toHaveLength(1)
      expect(groups[0].agentId).toBe('deleted-harness')
      expect(groups[0].shas).toEqual([sha])
      expect(revertAgent(vaultRoot, 'deleted-harness').ok).toBe(true)
      expect(listAgentCommits(vaultRoot)).toEqual([])
    })

    it('ignores commits without Machina-Agent trailers', () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'u.txt', 'user\n', 'plain user commit')
      expect(listAgentCommits(vaultRoot)).toEqual([])
    })

    it('returns [] for a non-repo (list semantics)', () => {
      expect(listAgentCommits(vaultRoot)).toEqual([])
    })
  })

  describe('discard', () => {
    it('restores tracked paths from HEAD without calling removeFile', async () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 't.txt', 'original', 'add t')
      writeFileSync(join(vaultRoot, 't.txt'), 'dirty')
      git(vaultRoot, 'add', '--', 't.txt')

      const removeFile = vi.fn(async () => {})
      const result = await discard(vaultRoot, ['t.txt'], removeFile)

      expect(result).toEqual({ ok: true })
      expect(readFileSync(join(vaultRoot, 't.txt'), 'utf-8')).toBe('original')
      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
      expect(removeFile).not.toHaveBeenCalled()
    })

    it('routes untracked paths through the injected removeFile callback', async () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'u.txt'), 'loose')

      const removeFile = vi.fn(async (abs: string) => {
        rmSync(abs)
      })
      const result = await discard(vaultRoot, ['u.txt'], removeFile)

      expect(result).toEqual({ ok: true })
      expect(removeFile).toHaveBeenCalledWith(join(vaultRoot, 'u.txt'))
      expect(existsSync(join(vaultRoot, 'u.txt'))).toBe(false)
      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
    })

    it('handles mixed tracked and untracked paths in one call', async () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 't.txt', 'original', 'add t')
      writeFileSync(join(vaultRoot, 't.txt'), 'dirty')
      writeFileSync(join(vaultRoot, 'u.txt'), 'loose')

      const removeFile = vi.fn(async (abs: string) => {
        rmSync(abs)
      })
      const result = await discard(vaultRoot, ['t.txt', 'u.txt'], removeFile)

      expect(result).toEqual({ ok: true })
      expect(readFileSync(join(vaultRoot, 't.txt'), 'utf-8')).toBe('original')
      expect(existsSync(join(vaultRoot, 'u.txt'))).toBe(false)
      expect(git(vaultRoot, 'status', '--porcelain')).toBe('')
    })

    it('treats pathspec metacharacters literally — * discards nothing', async () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 'user.txt', 'original', 'add user file')
      writeFileSync(join(vaultRoot, 'user.txt'), 'uncommitted user edit')
      writeFileSync(join(vaultRoot, 'loose.txt'), 'untracked')

      const removeFile = vi.fn(async () => {})
      const result = await discard(vaultRoot, ['*'], removeFile)

      expect(result).toEqual({ ok: true })
      expect(removeFile).not.toHaveBeenCalled()
      expect(readFileSync(join(vaultRoot, 'user.txt'), 'utf-8')).toBe('uncommitted user edit')
      expect(existsSync(join(vaultRoot, 'loose.txt'))).toBe(true)
    })

    it('normalizes ./-prefixed paths so tracked files restore instead of trash', async () => {
      initGitRepo(vaultRoot)
      userCommit(vaultRoot, 't.txt', 'original', 'add t')
      writeFileSync(join(vaultRoot, 't.txt'), 'dirty')

      const removeFile = vi.fn(async () => {})
      const result = await discard(vaultRoot, ['./t.txt'], removeFile)

      expect(result).toEqual({ ok: true })
      expect(removeFile).not.toHaveBeenCalled()
      expect(readFileSync(join(vaultRoot, 't.txt'), 'utf-8')).toBe('original')
    })

    it('rejects paths that escape the root through a symlinked directory', async () => {
      initGitRepo(vaultRoot)
      outsideRoot = makeTempDir()
      writeFileSync(join(outsideRoot, 'secret.txt'), 'TOP-SECRET\n')
      symlinkSync(outsideRoot, join(vaultRoot, 'link'))

      const removeFile = vi.fn(async () => {})
      const result = await discard(vaultRoot, ['link/secret.txt'], removeFile)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('invalid-path')
      expect(removeFile).not.toHaveBeenCalled()
      expect(existsSync(join(outsideRoot, 'secret.txt'))).toBe(true)
    })

    it('fails closed when git ls-files fails instead of trashing tracked files', async () => {
      // A .git DIRECTORY that is not a valid repo: isGitRepo passes, ls-files fails.
      mkdirSync(join(vaultRoot, '.git'))
      writeFileSync(join(vaultRoot, 't.txt'), 'content')

      const removeFile = vi.fn(async () => {})
      const result = await discard(vaultRoot, ['t.txt'], removeFile)

      expect(result).toEqual({ ok: false, reason: 'git-failed' })
      expect(removeFile).not.toHaveBeenCalled()
      expect(existsSync(join(vaultRoot, 't.txt'))).toBe(true)
    })

    it('is a structured no-op in a non-repo', async () => {
      writeFileSync(join(vaultRoot, 'plain.txt'), 'content')

      const removeFile = vi.fn(async () => {})
      const result = await discard(vaultRoot, ['plain.txt'], removeFile)

      expect(result).toEqual({ ok: false, reason: 'not-a-git-repo' })
      expect(removeFile).not.toHaveBeenCalled()
      expect(existsSync(join(vaultRoot, 'plain.txt'))).toBe(true)
    })
  })
})
