/**
 * Built-app watcher-health probe (workstation step 2, contracts §4 v1.2.1).
 *
 * Standardized verification posture: chokidar death is not honestly
 * scriptable in the packaged app, so this probe asserts only what it can
 * force — `approvals:watcher-status` returns 'watching' on a healthy boot,
 * and a forced init failure (unreadable directory inside the workspace root,
 * which errors the watcher's initial scan) leaves the workspace live with
 * state 'down'. The recovery evidence lives in the real-chokidar integration
 * test (agent-write-watcher.test.ts); the UI evidence lives in the component
 * tests.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')

interface WatcherHealthShape {
  state: string
  since: string
  attempts: number
  reason?: string
}

async function launchWithWorkspace(
  workspacePath: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

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

  // Locator waits span the reload navigation; page.evaluate does not. Wait for
  // the app shell to be mounted post-reload before any evaluate-based polling.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

async function readWatcherState(page: Page): Promise<string> {
  try {
    const health = await page.evaluate(() => {
      const api = (
        window as unknown as {
          api: { approvals: { watcherStatus: () => Promise<WatcherHealthShape> } }
        }
      ).api
      return api.approvals.watcherStatus()
    })
    return health.state
  } catch {
    // Execution context destroyed by a boot-time navigation — retry on next poll.
    return 'context-not-ready'
  }
}

async function pollWatcherState(page: Page, expected: string): Promise<WatcherHealthShape> {
  await expect.poll(() => readWatcherState(page), { timeout: 20_000 }).toBe(expected)
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        api: { approvals: { watcherStatus: () => Promise<WatcherHealthShape> } }
      }
    ).api
    return api.approvals.watcherStatus()
  })
}

test.describe.serial('Agent-write-watcher health (built app)', () => {
  test('healthy boot: watcher-status reports watching', async () => {
    const { app, page } = await launchWithWorkspace(TEST_VAULT)
    try {
      const health = await pollWatcherState(page, 'watching')
      expect(health.attempts).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('forced init failure: workspace stays live with state down', async () => {
    // Fixture: a real workspace whose root contains an unreadable directory.
    // The vault indexer tolerates EACCES (per-dir catch → skipped), so the
    // workspace opens; the agent-write watcher's chokidar scan errors on it,
    // which the ready/error/timeout race turns into a thrown start → the
    // init catch marks the gate down while the app keeps running (OQ6).
    const root = mkdtempSync(path.join(tmpdir(), 'te-watcher-down-'))
    cpSync(TEST_VAULT, root, { recursive: true })
    const sealed = path.join(root, 'sealed')
    mkdirSync(sealed)
    writeFileSync(path.join(sealed, 'inside.md'), '# unreachable\n')
    chmodSync(sealed, 0o000)

    const { app, page } = await launchWithWorkspace(root)
    try {
      const health = await pollWatcherState(page, 'down')
      expect(health.state).toBe('down')

      // Workspace live: the renderer still runs and the approvals surface
      // (titlebar tray trigger) is mounted and interactive.
      await expect(page.locator('[data-testid="approvals-tray-button"]')).toBeVisible({
        timeout: 15_000
      })
      await expect(page.locator('[data-testid="approvals-watcher-warning"]')).toBeVisible()
    } finally {
      await app.close()
      chmodSync(sealed, 0o755)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
