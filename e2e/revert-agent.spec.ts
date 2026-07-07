/**
 * Built-app per-agent revert probe (workstation Phase 2 step 5, contracts
 * §2/§4/§6 v1.2.5).
 *
 * Exit evidence for the step: on a throwaway repo carrying commits from TWO
 * agents, the tray's RevertAgentSection groups both; a UI revert of agent A
 * (arm → §4-framed confirm → confirm) produces a Machina-Reverts commit,
 * leaves agent B's commits and files intact, and the refreshed list excludes
 * the reverted shas. This is the Phase-1 tracer assertion, now via UI instead
 * of the DevTools console.
 *
 * Written in the step-5 worktree session and NOT executed there (parallel
 * sessions share ~/Library/Application Support/Electron — the orchestrator
 * runs all e2e sequentially post-merge). Uses the boot-settle guard pattern
 * from watcher-health.spec.ts.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')

const AGENT_A = 'probe-fixer'
const AGENT_B = 'probe-writer'

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

/** Throwaway repo with an initial commit and local identity. */
function initThrowawayRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'te-revert-agent-'))
  git(dir, 'init', '--quiet')
  git(dir, 'config', 'user.email', 'probe@example.com')
  git(dir, 'config', 'user.name', 'Probe')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(path.join(dir, 'README.md'), '# throwaway\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '--quiet', '--no-verify', '-m', 'initial')
  return dir
}

/** Commit one file with Machina attribution trailers (agent-shaped history). */
function agentCommit(dir: string, agentId: string, file: string, content: string): string {
  writeFileSync(path.join(dir, file), content)
  git(dir, 'add', '--', file)
  git(
    dir,
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    `agent writes ${file}`,
    '-m',
    `Machina-Agent: ${agentId}\nMachina-Session: th-probe-01`
  )
  return git(dir, 'rev-parse', 'HEAD')
}

async function launchWithWorkspace(
  workspacePath: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Boot-settle guard (step-4 lesson): wait for the first boot to resolve
  // (app shell OR FirstRunScreen) before seeding lastWorkspacePath, or the
  // app's own null-write for a stale stored path clobbers the seed.
  await page
    .locator('[data-testid="approvals-tray-button"]')
    .or(page.getByRole('button', { name: 'Open Folder' }))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })

  await app.evaluate(async ({ BrowserWindow }, wsPath) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      const escapedPath = JSON.stringify(wsPath)
      await win.webContents.executeJavaScript(`
        (async () => {
          await window.api.config.write('app', 'lastWorkspacePath', ${escapedPath})
          location.reload()
        })()
      `)
    }
  }, workspacePath)

  // Locator waits span the reload; evaluate does not — wait for the app shell
  // post-reload before touching the page again.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

test.describe.serial('Per-agent revert UI (built app)', () => {
  test('two agents grouped; UI revert of A leaves B intact; list refreshes to exclude reverted shas', async () => {
    const repo = initThrowawayRepo()
    const shaA1 = agentCommit(repo, AGENT_A, 'fa1.txt', 'fixer change one\n')
    const shaA2 = agentCommit(repo, AGENT_A, 'fa2.txt', 'fixer change two\n')
    const shaB1 = agentCommit(repo, AGENT_B, 'fb1.txt', 'writer change\n')

    const { app, page } = await launchWithWorkspace(repo)
    try {
      // Open the tray popover and expand the (collapsed-by-default) section.
      await page.locator('[data-testid="approvals-tray-button"]').click()
      await page.locator('[data-testid="revert-agent-toggle"]').click()

      // Both agents' commits are grouped, with per-agent counts.
      const rowA = page.locator(`[data-testid="revert-agent-row-${AGENT_A}"]`)
      const rowB = page.locator(`[data-testid="revert-agent-row-${AGENT_B}"]`)
      await expect(rowA).toBeVisible({ timeout: 15_000 })
      await expect(rowA).toContainText('2 commits')
      await expect(rowB).toBeVisible()
      await expect(rowB).toContainText('1 commit')

      // Arm the confirm for agent A: revert happens ONLY after the §4-framed
      // confirm (creates new commits, deletes no history, not protection).
      await page.locator(`[data-testid="revert-agent-arm-${AGENT_A}"]`).click()
      const confirm = page.locator('[data-testid="revert-agent-confirm"]')
      await expect(confirm).toContainText('creates new commits')
      await expect(confirm).toContainText('history is not deleted')
      await page.locator('[data-testid="revert-agent-confirm-button"]').click()

      // The list re-enumerates: A's group is gone (its shas are named in the
      // Machina-Reverts trailer now), B's group is untouched.
      await expect(rowA).toHaveCount(0, { timeout: 15_000 })
      await expect(rowB).toBeVisible()
      await expect(rowB).toContainText('1 commit')
      await expect(page.locator('[data-testid="revert-agent-notice"]')).toContainText(
        `Reverted 2 commits by ${AGENT_A}`
      )

      // Git-level evidence, read off the repo itself.
      const revertsTrailer = git(
        repo,
        'log',
        '-1',
        '--format=%(trailers:key=Machina-Reverts,valueonly)'
      )
      expect(revertsTrailer.split(/\s+/).sort()).toEqual([shaA1, shaA2].sort())
      // The revert commit carries NO Machina-Agent trailer (never re-enumerated).
      expect(git(repo, 'log', '-1', '--format=%(trailers:key=Machina-Agent,valueonly)')).toBe('')

      // A's files are gone from the worktree; B's commit and file are intact.
      expect(existsSync(path.join(repo, 'fa1.txt'))).toBe(false)
      expect(existsSync(path.join(repo, 'fa2.txt'))).toBe(false)
      expect(existsSync(path.join(repo, 'fb1.txt'))).toBe(true)
      expect(git(repo, 'cat-file', '-t', shaB1)).toBe('commit')

      // Worktree clean EXCEPT the app's own untracked TE_DIR scaffold (app
      // state, not an agent write — the step-5 P2 transcript gotcha).
      const dirty = git(repo, 'status', '--porcelain')
        .split('\n')
        .filter((line) => line.length > 0)
        .filter((line) => !/\.machina(-dev)?\/?/.test(line))
      expect(dirty).toEqual([])
    } finally {
      await app.close()
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
