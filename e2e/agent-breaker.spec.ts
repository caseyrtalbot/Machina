/**
 * Built-app circuit-breaker probe (workstation Phase 2 step 6, contracts §5
 * v1.2.6). Exit-bar path on a throwaway repo:
 *
 *   1. an agent turn running a scripted write loop ⇒ the velocity breaker
 *      trips (consecutive limiter-exceeded batches) ⇒ the PTY is DEAD
 *      OS-side (lsof/ps evidence, same mechanism as the projection probe),
 *      and the UI shows the tripped state (tray notice row + header chip);
 *   2. manual kill: a fresh thread with a live long-running turn ⇒ pressing
 *      the header kill switch ⇒ the PTY dies mid-output.
 *
 * NOT RUN in the step-6 landing session (parallel e2e runs collide on the
 * shared ~/Library/Application Support/Electron/ dir) — the orchestrator
 * executes it sequentially post-merge.
 *
 * Requires the `claude` binary installed AND authed (the spawner probes for
 * the binary), same as agent-projection.spec.ts. cli-thread:input formats
 * the text into a real `claude --print` invocation, so the write loop is
 * driven by asking claude to run one explicit one-line bash command; the
 * assertions poll with generous timeouts, and nothing beyond "many files
 * appear quickly" / "output keeps flowing" is load-bearing about the model's
 * reply. The velocity threshold uses the DEFAULT budget (10 writes/min for
 * unbound ad-hoc threads): 40 writes STAGGERED ~50ms apart exceed it on many
 * consecutive watcher batches (VELOCITY_TRIP_CONSECUTIVE = 3). The stagger
 * is load-bearing (v1.2.7 probe fix): an un-staggered burst can coalesce
 * into fewer than 3 batches under awaitWriteFinish (~300ms stability) +
 * 50ms batching, and the trip requires CONSECUTIVE exceeded batches.
 *
 * The workspace root is DELIBERATELY passed to cli-thread:input exactly as
 * mkdtempSync returns it (`/var/folders/...`, a symlink alias of
 * `/private/var/...`) — do not realpath it. This pins the v1.2.7 turn-
 * attribution fix: the agent-write watcher roots at the canonical path
 * (WorkspaceService realpaths), and the turn registry must match the alias
 * cwd by PATH identity, not string identity. Pre-fix, every write this probe
 * produced was audited "write outside any turn window", the breaker never
 * received a velocity signal, and the PTY survived the full 90s poll (the
 * 2026-07-07 e2e failure — root-caused from the audit log).
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

  // Boot-settle guard (see agent-projection.spec.ts): wait for the app shell
  // OR FirstRunScreen before seeding lastWorkspacePath, so the first-boot
  // null-write cannot clobber the seed.
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

  // Locator waits span the reload; evaluate does not — wait for the shell.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

const SHELL_COMM_RE = /^-?(zsh|bash|fish|sh|dash|ksh|tcsh)$/

/**
 * PIDs of the thread's PTY shell(s) for `workspace` — cwd-based lsof match
 * (PTY shells have an EMPTY argv; `pgrep -f <path>` sees nothing), then
 * filtered to top-level shell binaries. Copied from agent-projection.spec.ts.
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
  // Same guard as the lsof call above: `ps -p` exits non-zero when ANY listed
  // pid is already gone (the exact race a successful breaker/manual kill
  // creates between lsof and ps) but still prints the survivors to stdout.
  let psOut = ''
  try {
    psOut = execSync(`ps -o pid=,ppid=,comm= -p ${cwdRoot.join(',')}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (err) {
    psOut = (err as { stdout?: Buffer | string }).stdout?.toString() ?? ''
  }
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

/** Create a CLI thread and send one turn via IPC; returns the threadId. */
async function startTurn(page: Page, ws: string, title: string, text: string): Promise<string> {
  return page.evaluate(
    async ({ ws, title, text }) => {
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
      const t = await w.api.thread.create(ws, 'cli-claude', 'default', title)
      await w.api.cliThread.input({ threadId: t.id, identity: 'cli-claude', text, cwd: ws })
      return t.id
    },
    { ws, title, text }
  )
}

interface BreakerStatusShape {
  trips: Array<{ threadId: string; reason: string; action: string }>
  signalsDegraded: boolean
}

test.describe.serial('Agent circuit breaker (built app)', () => {
  test('a scripted write loop trips the velocity breaker: PTY dead, UI shows tripped', async () => {
    test.setTimeout(180_000)
    const root = mkdtempSync(path.join(tmpdir(), 'te-breaker-'))
    cpSync(TEST_VAULT, root, { recursive: true })

    const { app, page } = await launchWithWorkspace(root)
    try {
      // One explicit bash instruction: 40 staggered writes (~50ms apart, ~2s
      // total) exceed the default 10-writes/min limiter from write #11 on,
      // spreading across MANY consecutive watcher batches (the trip needs 3).
      const threadId = await startTurn(
        page,
        root,
        'breaker probe',
        'Run exactly this bash command and nothing else: for i in $(seq 1 40); do echo x > "runaway-$i.txt"; sleep 0.05; done'
      )

      // The PTY spawned and is live before the loop lands.
      await expect
        .poll(async () => (await getThreadSession(page, threadId))?.live ?? false, {
          timeout: 30_000
        })
        .toBe(true)
      expect(shellPidsFor(root).length).toBeGreaterThan(0)

      // Velocity trip ⇒ main kills the PTY (spawner.close). Poll the
      // main-side authority first, then the OS-level evidence. PROBE FIX
      // (v1.2.7): spawner.close UNBINDS the session, so a killed thread's
      // get-session returns null — null IS the dead state. The original
      // predicate (`?.live ?? true`) coerced null to alive and could never
      // observe the kill.
      await expect
        .poll(
          async () => {
            const session = await getThreadSession(page, threadId)
            return session !== null && session.live
          },
          { timeout: 90_000 }
        )
        .toBe(false)
      await expect.poll(() => shellPidsFor(root).length, { timeout: 15_000 }).toBe(0)

      // Breaker status records the trip as killed velocity containment.
      const status = await page.evaluate(() =>
        (
          window as unknown as {
            api: { breaker: { status: () => Promise<BreakerStatusShape> } }
          }
        ).api.breaker.status()
      )
      const tripRecord = status.trips.find((t) => t.threadId === threadId)
      expect(tripRecord).toBeDefined()
      expect(tripRecord?.reason).toBe('velocity')
      expect(tripRecord?.action).toBe('killed')

      // UI: tray popover shows the breaker notice row…
      await page.locator('[data-testid="approvals-tray-button"]').click()
      await expect(page.locator('[data-testid="breaker-notice"]').first()).toBeVisible({
        timeout: 10_000
      })
      await page.keyboard.press('Escape')

      // …and the thread header shows the tripped chip. The thread was
      // created via IPC, so reload to let the renderer list it.
      await page.evaluate(() => location.reload())
      await page.locator('[data-testid="approvals-tray-button"]').waitFor({
        state: 'visible',
        timeout: 15_000
      })
      await page.getByText('breaker probe').first().click()
      await expect(page.locator('[data-testid="breaker-tripped-chip"]')).toBeVisible({
        timeout: 10_000
      })
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('manual kill: the header kill switch halts a live turn mid-output', async () => {
    test.setTimeout(120_000)
    const root = mkdtempSync(path.join(tmpdir(), 'te-breaker-kill-'))
    cpSync(TEST_VAULT, root, { recursive: true })

    const { app, page } = await launchWithWorkspace(root)
    try {
      // A long-running turn: the sleep keeps the invocation (and PTY) busy
      // well past the kill click.
      const threadId = await startTurn(
        page,
        root,
        'kill probe',
        'Run exactly this bash command and nothing else: for i in $(seq 1 120); do echo "tick $i"; sleep 1; done'
      )
      await expect
        .poll(async () => (await getThreadSession(page, threadId))?.live ?? false, {
          timeout: 30_000
        })
        .toBe(true)
      const pidsBefore = shellPidsFor(root)
      expect(pidsBefore.length).toBeGreaterThan(0)

      // Surface the thread in the UI and press the kill switch.
      await page.evaluate(() => location.reload())
      await page.locator('[data-testid="approvals-tray-button"]').waitFor({
        state: 'visible',
        timeout: 15_000
      })
      await page.getByText('kill probe').first().click()
      await page.locator('[data-testid="agent-kill-switch"]').click({ timeout: 15_000 })

      // Hard stop: main-side authority reports dead, and the OS agrees —
      // no shell remains in the workspace cwd. Same probe fix as above:
      // close() unbinds the session, so null IS the dead state.
      await expect
        .poll(
          async () => {
            const session = await getThreadSession(page, threadId)
            return session !== null && session.live
          },
          { timeout: 15_000 }
        )
        .toBe(false)
      await expect.poll(() => shellPidsFor(root).length, { timeout: 15_000 }).toBe(0)
      // The kill switch drops with the dead PTY (reattach-only semantics:
      // nothing offers to respawn).
      await expect(page.locator('[data-testid="agent-kill-switch"]')).toHaveCount(0)
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
