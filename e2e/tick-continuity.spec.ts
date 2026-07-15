/**
 * Built-app tick-counter continuity probe (workstation Phase 3 step 3,
 * contracts §3 v1.3.2). Automated pre-verification of the Phase-1 step-4
 * acceptance that is verbatim Phase 3's exit bar 2: a live strip terminal
 * running a tick loop migrates strip→canvas→strip without losing scrollback,
 * with consecutive tick numbers across both hops, exactly ONE mounted webview
 * per hop (the single-projection invariant), the same OS shell PID throughout,
 * and a PTY that still answers Ctrl+C + echo at the end.
 *
 * What this does NOT replace: Casey's observed run of the same script stays
 * the formal acceptance (no programmatic Electron screenshots — this probe
 * asserts on xterm buffer text via the guest's __terminalText hook and on
 * OS-side PID identity, never on pixels).
 *
 * NOT RUN in the landing session alongside other e2e specs in parallel
 * (shared ~/Library/Application Support/Electron dir) — run it targeted, or
 * let the orchestrator run the full suite sequentially post-merge.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execSync } from 'child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')
// Unpackaged e2e runs are is.dev → session meta lives under .machina-dev.
// Literal, not TE_DIR: this mirrors main's own derivation at
// src/main/services/session-paths.ts:23 (`is.dev ? '.machina-dev' : '.machina'`);
// the shared TE_DIR constant is built on `import.meta.env` (Vite-only,
// src/shared/constants.ts:5) and cannot load in the Playwright node process —
// the same sanctioned-local-literal pattern as harness-gallery.spec.ts:26 and
// harness-lint.spec.ts:27.
const SESSION_META_DIR = path.join(homedir(), '.machina-dev', 'terminal-sessions')

async function launchWithWorkspace(
  workspacePath: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Let the initial boot settle before seeding (see agent-projection.spec.ts:
  // checkSavedVault's null-write races the config seed below otherwise).
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

  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

const SHELL_COMM_RE = /^-?(zsh|bash|fish|sh|dash|ksh|tcsh)$/

/**
 * PIDs of the PTY shell(s) whose cwd is `workspace` (copy of the
 * agent-projection helper: the spawner launches the shell with empty argv, so
 * only lsof-by-cwd can see it; children reparent and are not shells).
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

/** The sessionId whose PTY meta records `workspace` as its cwd. */
function findSessionIdFor(workspace: string): string | null {
  const target = realpathSync(workspace)
  let entries: string[] = []
  try {
    entries = readdirSync(SESSION_META_DIR)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const meta = JSON.parse(readFileSync(path.join(SESSION_META_DIR, entry), 'utf-8')) as {
        cwd?: string
      }
      if (meta.cwd === target || meta.cwd === workspace) return entry.slice(0, -'.json'.length)
    } catch {
      // Partially written or stale meta — skip.
    }
  }
  return null
}

/** xterm buffer text of the single mounted terminal webview (guest hook). */
function readTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const wv = document.querySelector('webview') as
      | (HTMLElement & { executeJavaScript?: (code: string) => Promise<string> })
      | null
    if (!wv?.executeJavaScript) return ''
    return wv.executeJavaScript('window.__terminalText ? window.__terminalText() : ""')
  })
}

/** Write raw bytes to the PTY through the guest's own bridge. */
function writeToPty(page: Page, sessionId: string, data: string): Promise<void> {
  return page.evaluate(
    ({ sid, bytes }) => {
      const wv = document.querySelector('webview') as
        | (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> })
        | null
      if (!wv?.executeJavaScript) throw new Error('no terminal webview mounted')
      const code = `window.terminalApi.write({ sessionId: ${JSON.stringify(
        sid
      )}, data: ${JSON.stringify(bytes)} })`
      return wv.executeJavaScript(code).then(() => undefined)
    },
    { sid: sessionId, bytes: data }
  )
}

/** Unique sorted tick numbers found on their own lines. */
function tickNumbers(text: string): number[] {
  const seen = new Set<number>()
  for (const m of text.matchAll(/^tick (\d+)$/gm)) seen.add(Number(m[1]))
  return [...seen].sort((a, b) => a - b)
}

/**
 * The continuity assertion: within the surface's replayed-plus-live text, the
 * unique tick numbers form one gapless run that reaches back to (or past) the
 * last tick seen on the previous surface. Duplicates are tolerated (reconnect
 * replay is at-least-once: ring-buffer snapshot + queued-chunk flush can
 * overlap) — LOST ticks are the failure this probe exists to catch.
 */
function expectConsecutive(ticks: number[], atLeastBack: number): void {
  expect(ticks.length).toBeGreaterThan(0)
  for (let i = 1; i < ticks.length; i += 1) {
    expect(ticks[i] - ticks[i - 1]).toBe(1)
  }
  expect(ticks[0]).toBeLessThanOrEqual(atLeastBack)
}

test.describe.serial('Tick-counter migration continuity (built app)', () => {
  test('strip→canvas→strip keeps consecutive ticks, one webview, one shell PID, live PTY', async () => {
    test.setTimeout(180_000)
    const root = mkdtempSync(path.join(tmpdir(), 'te-tick-'))
    cpSync(TEST_VAULT, root, { recursive: true })
    let sessionId: string | null = null

    const { app, page } = await launchWithWorkspace(root)
    try {
      // ── 1. A thread to own the strip (created via IPC, then selected) ──
      await page.evaluate(async (ws) => {
        const w = window as unknown as {
          api: {
            thread: {
              create: (v: string, agent: string, model: string, title?: string) => Promise<unknown>
            }
          }
        }
        await w.api.thread.create(ws, 'machina-native', 'claude-sonnet-4-6', 'tick probe')
        location.reload()
      }, root)
      await page.locator('[data-testid="approvals-tray-button"]').waitFor({
        state: 'visible',
        timeout: 15_000
      })
      await page.getByText('tick probe').first().click()

      // ── 2. Ctrl+` spawns a strip terminal at the workspace root ────────
      await page.keyboard.press('Control+Backquote')
      await page.locator('[data-testid="terminal-strip"]').waitFor({ timeout: 10_000 })
      await expect(page.locator('webview')).toHaveCount(1, { timeout: 10_000 })
      await expect
        .poll(async () => (await readTerminalText(page)).length, { timeout: 20_000 })
        .toBeGreaterThan(0)

      await expect
        .poll(() => (sessionId = findSessionIdFor(root)), { timeout: 15_000 })
        .not.toBeNull()
      const sid = sessionId as unknown as string
      // The meta file is written synchronously at PTY create, but the spawned
      // shell can take a beat to appear in the process table — poll, don't
      // snapshot.
      let pidsAtStart: number[] = []
      await expect
        .poll(() => (pidsAtStart = shellPidsFor(root)).length, { timeout: 10_000 })
        .toBeGreaterThan(0)

      // ── 3. Start the tick loop and let it run ──────────────────────────
      await writeToPty(page, sid, 'i=0; while true; do echo tick $i; i=$((i+1)); sleep 0.2; done\r')
      await expect
        .poll(async () => tickNumbers(await readTerminalText(page)).length, { timeout: 20_000 })
        .toBeGreaterThan(3)
      const lastTickOnStrip = tickNumbers(await readTerminalText(page)).at(-1) as number

      // ── 4. Migrate strip→canvas via the real UI affordance ─────────────
      await page.locator('[data-testid^="terminal-strip-tab-"]').first().click({ button: 'right' })
      await page.locator('[data-testid="terminal-strip-menu"]').waitFor({ timeout: 5_000 })
      await page.getByText('Move to canvas').click()

      // Single-projection invariant at webview granularity: the strip webview
      // unmounts and exactly one canvas card webview replaces it.
      await expect(page.locator('webview')).toHaveCount(1, { timeout: 10_000 })
      const canvasSrc = await page.locator('webview').getAttribute('src')
      expect(canvasSrc).toContain(`sessionId=${sid}`)

      // Continuity on the canvas: replayed scrollback reaches back to the
      // last strip tick, the run is gapless, and NEW ticks keep arriving.
      await expect
        .poll(async () => tickNumbers(await readTerminalText(page)).at(-1) ?? -1, {
          timeout: 20_000
        })
        .toBeGreaterThan(lastTickOnStrip + 2)
      const canvasTicks = tickNumbers(await readTerminalText(page))
      expectConsecutive(canvasTicks, lastTickOnStrip)
      // Same PTY OS-side: migration spawned no new shell.
      expect(shellPidsFor(root).sort()).toEqual(pidsAtStart.sort())
      const lastTickOnCanvas = canvasTicks.at(-1) as number

      // ── 5. Migrate canvas→strip via the card's Move-to-dock action ─────
      await page.locator('[data-testid="terminal-move-to-dock"]').click()
      await expect(page.locator('webview')).toHaveCount(1, { timeout: 10_000 })
      const stripSrc = await page.locator('webview').getAttribute('src')
      expect(stripSrc).toContain(`sessionId=${sid}`)

      await expect
        .poll(async () => tickNumbers(await readTerminalText(page)).at(-1) ?? -1, {
          timeout: 20_000
        })
        .toBeGreaterThan(lastTickOnCanvas + 2)
      expectConsecutive(tickNumbers(await readTerminalText(page)), lastTickOnCanvas)
      expect(shellPidsFor(root).sort()).toEqual(pidsAtStart.sort())

      // ── 6. The SAME PTY is still live and interactive: Ctrl+C then echo ─
      await writeToPty(page, sid, '\x03')
      await writeToPty(page, sid, 'echo MACHINA_TICK_DONE_ok\r')
      await expect
        .poll(async () => readTerminalText(page), { timeout: 15_000 })
        .toContain('MACHINA_TICK_DONE_ok')
    } finally {
      // Stop the PTY (kills the tick loop) before tearing the app down.
      if (sessionId) {
        await page
          .evaluate((sid) => {
            const w = window as unknown as {
              api: { terminal: { kill: (id: string) => Promise<unknown> } }
            }
            return w.api.terminal.kill(sid).then(() => undefined)
          }, sessionId)
          .catch(() => {})
        rmSync(path.join(SESSION_META_DIR, `${sessionId}.json`), { force: true })
      }
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
