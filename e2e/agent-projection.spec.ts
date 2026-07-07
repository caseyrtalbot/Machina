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
 * Sends go through `cli-thread:input` with identity `cli-claude`, so this probe
 * DOES require the `claude` binary installed: the spawner runs
 * `detectInstalledAgents` and refuses the turn otherwise (cli-thread-spawner.ts
 * spawn), and on an authed machine the echoed text is executed as a real
 * `claude --print` turn (the adapter formats it into that invocation). What the
 * probe deliberately avoids is depending on the turn's SEMANTIC output — the
 * projection plumbing under test (session store, reattach, dead state,
 * no-respawn) is exercised the same whether the model replies or not. The
 * thread's shell is counted OS-side by its cwd (see `shellPidsFor`), not its
 * command line.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execSync } from 'child_process'
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'fs'
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

  // Let the initial boot SETTLE before seeding. App.tsx's checkSavedVault
  // writes lastWorkspacePath=null when the stored path is missing (a stale
  // temp dir from a prior run); that null-write races the config.write below
  // and can clobber our seed → FirstRunScreen, so the app shell never mounts.
  // Waiting for the boot to resolve (app shell OR first-run) guarantees the
  // null-write is done before we seed.
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

  // Locator waits span the reload navigation; page.evaluate does not. Wait
  // for the app shell post-reload before any evaluate-based polling.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

const SHELL_COMM_RE = /^-?(zsh|bash|fish|sh|dash|ksh|tcsh)$/

/**
 * PIDs of the thread's PTY shell(s) for `workspace`. The spawner launches the
 * shell with EMPTY argv (`spawn(shell, [], { cwd, env })` in pty-service.ts) —
 * the workspace path is only the process cwd, never the command line, so
 * `pgrep -f` cannot see it. Match on cwd via lsof instead (the spec's "ps/lsof
 * shows one shell for the thread").
 *
 * The agent (e.g. `claude`) runs UNDER this shell, so its whole subprocess tree
 * (claude → npm → node …) inherits the same cwd and TE_SESSION_ID env. We want
 * only the PTY shell, not that tree: it is the unique cwd=root process that is a
 * shell binary AND whose parent is the node-pty helper (outside the cwd=root
 * set). Top-level + is-shell also keeps a kill clean — the shell's children
 * reparent to launchd but are not shells, so a dead PTY yields [].
 */
function shellPidsFor(workspace: string): number[] {
  const target = realpathSync(workspace)
  let lsofOut = ''
  try {
    lsofOut = execSync('lsof -a -d cwd -Fpn', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (err) {
    // lsof exits non-zero when some fds are unreadable but still prints the
    // rest on stdout — use whatever it emitted.
    lsofOut = (err as { stdout?: Buffer | string }).stdout?.toString() ?? ''
  }
  const cwdRoot: number[] = []
  let pid: number | null = null
  for (const line of lsofOut.split('\n')) {
    if (line[0] === 'p') pid = Number.parseInt(line.slice(1), 10)
    else if (line[0] === 'n' && pid !== null) {
      const name = line.slice(1)
      if (name === target || name === workspace) cwdRoot.push(pid)
    }
  }
  if (cwdRoot.length === 0) return []

  const rootSet = new Set(cwdRoot)
  const psOut = execSync(`ps -o pid=,ppid=,comm= -p ${cwdRoot.join(',')}`, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const shells: number[] = []
  for (const line of psOut.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    const [, pidStr, ppidStr, comm] = m
    const commBase = comm.trim().split('/').pop() ?? ''
    if (!rootSet.has(Number.parseInt(ppidStr, 10)) && SHELL_COMM_RE.test(commBase)) {
      shells.push(Number.parseInt(pidStr, 10))
    }
  }
  return shells
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
      // (WebGL) has no queryable text DOM, so read xterm's renderer-independent
      // buffer via the guest's __terminalText test hook. Reattaching to the
      // SAME live session replays its ring buffer, so the turn's echoed command
      // is present in the raw view's scrollback.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const wv = document.querySelector('webview') as
                | (HTMLElement & { executeJavaScript?: (code: string) => Promise<string> })
                | null
              if (!wv?.executeJavaScript) return ''
              return wv.executeJavaScript('window.__terminalText ? window.__terminalText() : ""')
            }),
          { timeout: 15_000 }
        )
        .toContain('projection-probe-turn')

      // ── 3. Toggle back: structured thread projection restored ─────────
      // The echo turn is a raw PTY command and the fixture shell has no
      // block-protocol hooks, so the structured view has no parsed message to
      // render — the ring-buffer replay above is the turn-content proof. Here
      // we prove the round-trip returns to the structured projection intact:
      // the raw webview unmounts, the toggle is active on 'thread', and the raw
      // dead state is absent.
      await page.locator('[data-testid="projection-thread"]').click()
      await expect(page.locator('webview')).toHaveCount(0)
      await expect(page.locator('[data-testid="projection-thread"]')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(page.locator('[data-testid="raw-projection-dead"]')).toHaveCount(0)

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
