import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { TE_DIR } from '@shared/constants'

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
