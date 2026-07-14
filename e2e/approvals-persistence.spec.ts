/**
 * Built-app approval-queue restart-persistence probe (workstation Phase 3
 * step 1, contracts §4 v1.3.0).
 *
 * Exit evidence for the step's e2e half — the safety-invariant gate's
 * restart-rollback leg: on a throwaway repo, a real agent turn produces a
 * queued write (one `pc_<turnId>` item); the app is CLOSED and RELAUNCHED;
 * the item rehydrates from the userData disk mirror (approval-queue.json),
 * passes the fresh-diff re-validation (nothing drifted while the app was
 * closed), and is still resolvable — approving it commits with
 * Machina-Agent / Machina-Session trailers, so restart never opens a
 * rollback-coverage gap.
 *
 * Requires the `claude` binary installed AND authed, same as
 * agent-breaker.spec.ts — the queued write is synthesized by asking claude
 * to run one explicit one-line bash command (nothing about the model's
 * reply is load-bearing beyond "the file gets written exactly once"). The
 * single-command prompt is deliberate: any later write in the same turn
 * would recompute the item's diff, and the probe samples the disk mirror
 * only after it matches the live item — a multi-write prompt would race
 * that sample.
 *
 * Executed green in the step-1 landing gate (full `npm run test:e2e` on a
 * fresh build, 2026-07-14). Uses the boot-settle guard pattern from
 * watcher-health.spec.ts.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'child_process'
import { readFileSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')

/** Root-relative path the agent turn writes; also the queue-item path. */
const PROBE_FILE = 'probe-write.txt'
const PROBE_PAYLOAD = 'agent-payload'

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

/** Throwaway repo with an initial commit and local identity. */
function initThrowawayRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'te-approvals-persist-'))
  git(dir, 'init', '--quiet')
  git(dir, 'config', 'user.email', 'probe@example.com')
  git(dir, 'config', 'user.name', 'Probe')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(path.join(dir, 'README.md'), '# throwaway\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '--quiet', '--no-verify', '-m', 'initial')
  return dir
}

async function launchWithWorkspace(
  workspacePath: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Boot-settle guard (see watcher-health.spec.ts): wait for the first boot
  // to resolve (app shell OR FirstRunScreen) before seeding lastWorkspacePath,
  // or the app's own null-write for a stale stored path clobbers the seed.
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

/**
 * Relaunch without re-seeding: lastWorkspacePath persisted under userData
 * from the first run, so the app boots straight into the workspace — the
 * restart path a real user takes, which is exactly what rehydrate serves.
 */
async function relaunch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 30_000
  })
  return { app, page }
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

/** The slice of PendingChange the probe reads over approvals:list. */
interface PendingChangeShape {
  id: string
  kind: string
  threadId: string
  agentId: string
  paths: string[]
  diff: string
  capturedRoot?: string | null
}

async function listApprovals(page: Page): Promise<PendingChangeShape[]> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        api: { approvals: { list: () => Promise<PendingChangeShape[]> } }
      }
    ).api
    return api.approvals.list()
  })
}

interface ResolveResultShape {
  ok: boolean
  sha?: string
  reason?: string
}

/** Disk-mirror items (id + diff only); unreadable/partial file ⇒ empty. */
function mirrorItems(mirrorPath: string): Array<{ id: string; diff: string }> {
  try {
    const parsed = JSON.parse(readFileSync(mirrorPath, 'utf-8')) as {
      version?: number
      items?: Array<{ id: string; diff: string }>
    }
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

test.describe.serial('Approval-queue restart persistence (built app)', () => {
  test('a queued agent write survives close+relaunch and resolves into a trailered commit', async () => {
    test.setTimeout(300_000)
    const repo = initThrowawayRepo()

    // Snapshot carried across the restart boundary (set in phase 1).
    let captured: PendingChangeShape | undefined
    let threadId = ''

    // -- Phase 1: produce the queued write, wait for the disk mirror --
    {
      const { app, page } = await launchWithWorkspace(repo)
      let closed = false
      try {
        const userData = await app.evaluate(({ app: electronApp }) =>
          electronApp.getPath('userData')
        )
        const mirrorPath = path.join(userData, 'approval-queue.json')

        // One explicit single-file write, turn-attributed by the real
        // spawner/watcher machinery (same synthesis as agent-breaker.spec.ts).
        threadId = await startTurn(
          page,
          repo,
          'persistence probe',
          `Run exactly this bash command and nothing else: echo ${PROBE_PAYLOAD} > ${PROBE_FILE}`
        )

        // The turn's item lands in the queue keyed pc_<turnId>.
        await expect
          .poll(
            async () => {
              const items = await listApprovals(page)
              return items.some((i) => i.kind === 'cli-change' && i.paths.includes(PROBE_FILE))
            },
            { timeout: 120_000 }
          )
          .toBe(true)

        const live = (await listApprovals(page)).find(
          (i) => i.kind === 'cli-change' && i.paths.includes(PROBE_FILE)
        )
        if (live === undefined) throw new Error('queue item vanished between polls')
        expect(live.id).toMatch(/^pc_/)
        expect(live.threadId).toBe(threadId)
        // The review artifact covers the created file (no-index synthesis).
        expect(live.diff).toContain(PROBE_FILE)
        // capturedRoot is populated with the canonical workspace root
        // (WorkspaceService realpaths; mkdtemp returns the /var symlink alias).
        expect([repo, realpathSync(repo)]).toContain(live.capturedRoot)

        // The persist chain is async — hold the close until the disk mirror
        // carries the item with the SAME diff snapshot as the live queue, so
        // relaunch re-validation compares like with like. Re-reads the live
        // item each poll in case a late same-turn write recomputed the diff.
        await expect
          .poll(
            async () => {
              const current = (await listApprovals(page)).find((i) => i.id === live.id)
              if (current === undefined) return 'item-vanished'
              captured = current
              const mirrored = mirrorItems(mirrorPath).find((m) => m.id === current.id)
              return mirrored !== undefined && mirrored.diff === current.diff ? 'synced' : 'pending'
            },
            { timeout: 60_000 }
          )
          .toBe('synced')

        closed = true
        await app.close()
      } finally {
        if (!closed) await app.close()
      }
    }

    if (captured === undefined) throw new Error('phase 1 did not capture the queue item')
    const item = captured

    // -- Phase 2: relaunch, assert rehydration, resolve, verify trailers --
    const { app, page } = await relaunch()
    try {
      // Rehydrated from the mirror (one-shot at the first workspace bind) and
      // immediately visible over the same approvals:list surface.
      await expect
        .poll(async () => (await listApprovals(page)).some((i) => i.id === item.id), {
          timeout: 30_000
        })
        .toBe(true)

      const restored = (await listApprovals(page)).find((i) => i.id === item.id)
      if (restored === undefined) throw new Error('rehydrated item vanished between polls')
      expect(restored.kind).toBe('cli-change')
      expect(restored.paths).toEqual(item.paths)
      expect(restored.diff).toBe(item.diff)
      expect(restored.capturedRoot).toBe(item.capturedRoot)

      // Resolvable in its captured root: approve commits the write.
      const result = await page.evaluate(
        (id) =>
          (
            window as unknown as {
              api: {
                approvals: {
                  resolve: (
                    id: string,
                    approve: boolean,
                    message?: string
                  ) => Promise<{ ok: boolean; sha?: string; reason?: string }>
                }
              }
            }
          ).api.approvals.resolve(id, true),
        item.id
      )
      const resolved: ResolveResultShape = result
      expect(resolved.ok).toBe(true)

      // The item leaves the queue…
      await expect
        .poll(async () => (await listApprovals(page)).some((i) => i.id === item.id), {
          timeout: 15_000
        })
        .toBe(false)

      // …and the commit carries the attribution trailers (rollback coverage:
      // this restart-crossing write is enumerable by revertAgent like any other).
      expect(git(repo, 'log', '-1', '--format=%(trailers:key=Machina-Agent,valueonly)')).toBe(
        item.agentId
      )
      expect(git(repo, 'log', '-1', '--format=%(trailers:key=Machina-Session,valueonly)')).toBe(
        item.threadId
      )
      const committedFiles = git(repo, 'show', '--name-only', '--format=', 'HEAD')
        .split('\n')
        .filter((line) => line.length > 0)
      expect(committedFiles).toContain(PROBE_FILE)
      expect(git(repo, 'show', `HEAD:${PROBE_FILE}`)).toBe(PROBE_PAYLOAD)
    } finally {
      await app.close()
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
