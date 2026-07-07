/**
 * Built-app two-projection probe (workstation Phase 2 step 4, contracts
 * §3/§4/§6). Exit-bar path: run a CLI agent turn → toggle to raw ⇒ the
 * webview attaches to the SAME PTY (one shell for the thread; ring-buffer
 * replay shows the turn's output) → toggle back ⇒ structured thread intact →
 * kill the PTY ⇒ raw side shows the dead state and ps confirms NO respawn.
 *
 * NOT RUN in the step-4 landing session (parallel e2e runs collide on the
 * shared ~/Library/Application Support/Electron/ dir) — the orchestrator
 * executes it sequentially post-merge.
 *
 * Sends use `cli-thread:input` directly (spawn-on-demand) rather than a real
 * `claude` turn so the probe does not depend on an installed/authed CLI: the
 * projection plumbing under test (session store, reattach, dead state,
 * no-respawn) is identical either way. `pgrep -f` on the workspace path
 * counts the thread's shells OS-side.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execSync } from 'child_process'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')

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

  // Locator waits span the reload navigation; page.evaluate does not. Wait
  // for the app shell post-reload before any evaluate-based polling.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

/** PIDs of shells whose command line mentions the workspace (the thread PTYs). */
function shellPidsFor(workspace: string): number[] {
  try {
    const out = execSync(`pgrep -f ${JSON.stringify(workspace)}`, { encoding: 'utf-8' })
    return out
      .split('\n')
      .map((l) => Number.parseInt(l.trim(), 10))
      .filter((n) => Number.isFinite(n))
  } catch {
    return [] // pgrep exits 1 on zero matches
  }
}

interface SessionShape {
  sessionId: string
  live: boolean
}

async function getThreadSession(page: Page, threadId: string): Promise<SessionShape | null> {
  return page.evaluate((id) => {
    const api = (
      window as unknown as {
        api: { cliThread: { getSession: (t: string) => Promise<SessionShape | null> } }
      }
    ).api
    return api.cliThread.getSession(id)
  }, threadId)
}

test.describe.serial('Two-projection agent view (built app)', () => {
  test('raw attaches to the SAME PTY, survives the round-trip, and a killed PTY dead-states without respawn', async () => {
    test.setTimeout(120_000)
    const root = mkdtempSync(path.join(tmpdir(), 'te-projection-'))
    cpSync(TEST_VAULT, root, { recursive: true })

    const { app, page } = await launchWithWorkspace(root)
    try {
      // ── 1. Create a CLI thread and send one turn (spawn-on-demand) ────
      const threadId: string = await page.evaluate(async (ws) => {
        const w = window as unknown as {
          api: {
            thread: {
              create: (
                v: string,
                agent: string,
                model: string,
                title?: string
              ) => Promise<{ id: string }>
            }
            cliThread: {
              input: (req: {
                threadId: string
                identity: string
                text: string
                cwd: string
              }) => Promise<{ ok: boolean }>
            }
          }
        }
        const t = await w.api.thread.create(ws, 'cli-claude', 'default', 'projection probe')
        await w.api.cliThread.input({
          threadId: t.id,
          identity: 'cli-claude',
          text: 'echo projection-probe-turn',
          cwd: ws
        })
        return t.id
      }, root)

      // Main-side authority knows the PTY and it is alive.
      let session: SessionShape | null = null
      await expect
        .poll(
          async () => {
            session = await getThreadSession(page, threadId)
            return session?.live ?? false
          },
          { timeout: 20_000 }
        )
        .toBe(true)
      const boundSessionId = session!.sessionId
      const pidsAfterTurn = shellPidsFor(root)
      expect(pidsAfterTurn.length).toBeGreaterThan(0)

      // ── 2. Activate the thread in the UI and toggle to raw ────────────
      // The thread was created via IPC, so reload to let the renderer list it.
      await page.evaluate(() => location.reload())
      await page.locator('[data-testid="approvals-tray-button"]').waitFor({
        state: 'visible',
        timeout: 15_000
      })
      await page.getByText('projection probe').first().click()
      await page.locator('[data-testid="projection-toggle"]').waitFor({ timeout: 10_000 })
      await page.locator('[data-testid="projection-raw"]').click()

      // The raw view mounts a reattach-only webview on the SAME sessionId.
      const webview = page.locator('webview')
      await expect(webview).toBeVisible({ timeout: 10_000 })
      const src = await webview.getAttribute('src')
      expect(src).toContain(`sessionId=${boundSessionId}`)
      expect(src).toContain('reattachOnly=1')
      expect(src).not.toContain('cwd=')

      // Same PTY OS-side: attaching spawned NO new shell for the thread.
      expect(shellPidsFor(root).sort()).toEqual(pidsAfterTurn.sort())

      // Ring-buffer replay shows the earlier turn's output. The xterm canvas
      // is not DOM-queryable from the host; the guest keeps a DOM copy of
      // the scrollback in its accessibility tree — assert via the guest.
      // (If this proves flaky, the PID assertions above already pin the
      // same-PTY claim; treat this as the visual half.)
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const wv = document.querySelector('webview') as
                | (HTMLElement & { executeJavaScript?: (code: string) => Promise<string> })
                | null
              if (!wv?.executeJavaScript) return ''
              return wv.executeJavaScript('document.body.innerText')
            }),
          { timeout: 15_000 }
        )
        .toContain('projection-probe-turn')

      // ── 3. Toggle back: structured thread intact ──────────────────────
      await page.locator('[data-testid="projection-thread"]').click()
      await expect(page.locator('webview')).toHaveCount(0)
      await expect(page.getByText('echo projection-probe-turn').first()).toBeVisible({
        timeout: 10_000
      })

      // ── 4. Kill the PTY: dead state, and ps confirms NO respawn ───────
      for (const pid of pidsAfterTurn) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      await expect
        .poll(async () => (await getThreadSession(page, threadId))?.live ?? false, {
          timeout: 15_000
        })
        .toBe(false)

      await page.locator('[data-testid="projection-raw"]').click()
      await expect(page.locator('[data-testid="raw-projection-dead"]')).toBeVisible({
        timeout: 10_000
      })
      // The hard rule: NO webview mounted, NO fresh shell in the thread cwd.
      await expect(page.locator('webview')).toHaveCount(0)
      expect(shellPidsFor(root)).toEqual([])
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
