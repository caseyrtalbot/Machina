// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  commitPreAgentSnapshot,
  isGitRepo,
  isAutoCommitOptedOut
} from '../../src/main/services/vault-git'
import { TE_DIR } from '../../src/shared/constants'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'machina-vault-git-test-'))
}

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, stdio: 'ignore' } as const
  execFileSync('git', ['init', '--quiet'], opts)
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts)
  execFileSync('git', ['config', 'user.name', 'Test'], opts)
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts)
  // Seed an initial commit so HEAD exists — otherwise status/commit UX differs
  writeFileSync(join(dir, '.gitkeep'), '')
  execFileSync('git', ['add', '.'], opts)
  execFileSync('git', ['commit', '-m', 'initial', '--quiet', '--no-verify'], opts)
}

function lastCommitMessage(dir: string): string {
  return execFileSync('git', ['log', '-1', '--pretty=%B'], {
    cwd: dir,
    encoding: 'utf-8'
  }).trim()
}

describe('vault-git', () => {
  let vaultRoot: string

  beforeEach(() => {
    vaultRoot = makeTempDir()
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
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

  describe('isAutoCommitOptedOut', () => {
    it('returns false by default', () => {
      expect(isAutoCommitOptedOut(vaultRoot)).toBe(false)
    })

    it('returns true when .te/no-auto-commit exists', () => {
      mkdirSync(join(vaultRoot, TE_DIR), { recursive: true })
      writeFileSync(join(vaultRoot, TE_DIR, 'no-auto-commit'), '')
      expect(isAutoCommitOptedOut(vaultRoot)).toBe(true)
    })
  })

  describe('commitPreAgentSnapshot', () => {
    it('returns not-a-git-repo when vault is not a git repo', () => {
      const result = commitPreAgentSnapshot(vaultRoot, 'abcd1234-...')
      expect(result).toEqual({ committed: false, reason: 'not-a-git-repo' })
    })

    it('returns opted-out when .te/no-auto-commit is present', () => {
      initGitRepo(vaultRoot)
      mkdirSync(join(vaultRoot, TE_DIR), { recursive: true })
      writeFileSync(join(vaultRoot, TE_DIR, 'no-auto-commit'), '')

      const result = commitPreAgentSnapshot(vaultRoot, 'abcd1234-...')
      expect(result).toEqual({ committed: false, reason: 'opted-out' })
    })

    it('returns nothing-to-commit on a clean repo', () => {
      initGitRepo(vaultRoot)
      const result = commitPreAgentSnapshot(vaultRoot, 'abcd1234-...')
      expect(result).toEqual({ committed: false, reason: 'nothing-to-commit' })
    })

    it('commits dirty changes with a session-scoped message', () => {
      initGitRepo(vaultRoot)
      writeFileSync(join(vaultRoot, 'note.md'), '# hello')

      const result = commitPreAgentSnapshot(vaultRoot, 'abcd1234-efgh-5678')
      expect(result.committed).toBe(true)

      const msg = lastCommitMessage(vaultRoot)
      expect(msg).toBe('pre-agent snapshot (abcd1234)')
    })
  })
})
