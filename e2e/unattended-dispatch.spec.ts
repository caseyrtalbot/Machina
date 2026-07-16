/**
 * Built-app unattended-turn substrate probes (workstation Phase 3 step 4,
 * contracts §4 v1.3.3).
 *
 * Probe A (unattended + exactly-once): a turn dispatched via the dev-gated
 * 'cli-thread:test-dispatch' channel with the window BLURRED must land the
 * full transcript on disk — main appends the user message before validation
 * and the bridge's assistant final at turn end — with EXACTLY one user and
 * one assistant sentinel (the renderer IS subscribed here, so the single
 * count is simultaneously the no-renderer-persistence proof and the
 * no-double-append regression gate), and the agent's write must land as a
 * pc_<turnId> approval-queue item (windows/budgets/breaker/approvals engage
 * automatically via turnStarted — the test channel cannot bypass them).
 *
 * Probe B (renderer-path regression guard, the Phase-1 step-6 lesson): a
 * normal renderer-sent 'cli-thread:input' turn still displays in the thread
 * panel and persists exactly once, in the post-cutover d4 bridge-final shape
 * (canonical `cli_command` toolCall; `metadata` is intentionally NOT
 * asserted — thread-md never encodes it to disk), plus a second pc_ item.
 * Pins that the injected main-side readiness wait and the thread:save
 * meta-merge did not regress the attended path.
 *
 * Requires the `claude` binary installed AND authed (same inherited hard
 * dependency as approvals-persistence.spec.ts). Serial suite only — shared
 * Electron userData. MACHINA_E2E=1 is spread over process.env at launch
 * (dropping the inherited env would lose PATH/HOME and claude discovery).
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
// Workspace-scoped TE_DIR is baked '.machina' in the built bundle — a local
// literal is sanctioned in e2e specs (harness-gallery.spec.ts precedent).
const TE_DIR = '.machina'

const PROBE_FILE_A = 'probe-write.txt'
const PROBE_PAYLOAD_A = 'agent-payload'
const PROBE_FILE_B = 'probe-write-2.txt'
const PROBE_PAYLOAD_B = 'agent-payload-2'

const ASSISTANT_SENTINEL = '<!-- te:msg role=assistant'
const USER_SENTINEL = '<!-- te:msg role=user'

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

/** Throwaway repo with an initial commit and local identity. */
function initThrowawayRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'te-unattended-'))
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
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    // Spread process.env or the app loses PATH/HOME (and claude discovery);
    // MACHINA_E2E=1 arms the dev-gated test-dispatch channel + preload gate.
    env: { ...process.env, MACHINA_E2E: '1' } as Record<string, string>
  })
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

  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

/** Create a CLI thread over IPC; returns its id. */
async function createThread(page: Page, ws: string, title: string): Promise<string> {
  return page.evaluate(
    async ({ ws, title }) => {
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
        }
      }
      const t = await w.api.thread.create(ws, 'cli-claude', 'default', title)
      return t.id
    },
    { ws, title }
  )
}

/** The slice of PendingChange the probes read over approvals:list. */
interface PendingChangeShape {
  id: string
  kind: string
  threadId: string
  paths: string[]
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

function threadFilePath(ws: string, threadId: string): string {
  return path.join(ws, TE_DIR, 'threads', `${threadId}.md`)
}

function readThreadFile(ws: string, threadId: string): string {
  try {
    return readFileSync(threadFilePath(ws, threadId), 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Count REAL sentinels: thread-md escapes any literal `<!-- te…:` inside a
 * message body with a backslash on encode, so a zero-backslash match can
 * only be a sentinel this file's writer emitted.
 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * First content line of the LAST assistant message's body — the display
 * fragment probe B looks for in the thread panel. Body starts after the
 * sentinel's `## Machina` heading and runs to the next sentinel/fence.
 * Markdown formatting chars are stripped: the panel renders markdown, so
 * raw backticks/emphasis marks never appear in the DOM's text content.
 */
function lastAssistantBodyFragment(md: string): string {
  const start = md.lastIndexOf(ASSISTANT_SENTINEL)
  if (start === -1) return ''
  const afterHeading = md.indexOf('## Machina', start)
  if (afterHeading === -1) return ''
  const body = md.slice(afterHeading + '## Machina'.length)
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('<!--') || trimmed.startsWith('```')) break
    const plain = trimmed.replace(/[`*_#]/g, '').trim()
    if (plain.length >= 3) return plain
  }
  return ''
}

test.describe.serial('Unattended turn substrate (built app, Phase 3 step 4)', () => {
  let repo = ''
  let app: ElectronApplication | undefined
  let page: Page
  let threadIdA = ''

  test.afterAll(async () => {
    if (app !== undefined) await app.close()
    if (repo !== '') rmSync(repo, { recursive: true, force: true })
  })

  test('probe A: a blurred-window test-dispatch turn persists exactly once on disk and queues pc_ approval', async () => {
    test.setTimeout(300_000)
    repo = initThrowawayRepo()
    const launched = await launchWithWorkspace(repo)
    app = launched.app
    page = launched.page

    const threadId = await createThread(page, repo, 'unattended probe')
    threadIdA = threadId

    // Load the IPC-created thread into the renderer store and ACTIVATE it
    // before dispatching: an unknown threadId hits thread-store's `if (!t)`
    // guards and its saves are skipped, which would make the exactly-once
    // assertion below vacuous. With the thread active, the streaming
    // subscriber and its meta-merge saves genuinely run against this turn.
    await page.evaluate(() => location.reload())
    await page.locator('[data-testid="approvals-tray-button"]').waitFor({
      state: 'visible',
      timeout: 15_000
    })
    await page.getByText('unattended probe').first().click()

    // Blur the window: the turn must not depend on renderer focus or any
    // renderer participation.
    const focused = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      win.blur()
      return win.isFocused()
    })
    expect(focused).toBe(false)

    // Dispatch via the dev-gated test channel — the same dispatchAgentTurn
    // seam the step-5 scheduler will call (spawn-on-demand + main readiness
    // wait + validation + main-side persistence).
    const result = await page.evaluate(
      ({ threadId, ws, text }) => {
        const w = window as unknown as {
          api: {
            test?: {
              dispatch: (req: {
                threadId: string
                identity: string
                text: string
                cwd: string
              }) => Promise<{ ok: boolean }>
            }
          }
        }
        if (!w.api.test) throw new Error('window.api.test missing — MACHINA_E2E gate not armed')
        return w.api.test.dispatch({ threadId, identity: 'cli-claude', text, cwd: ws })
      },
      {
        threadId,
        ws: repo,
        text: `Run exactly this bash command and nothing else: echo ${PROBE_PAYLOAD_A} > ${PROBE_FILE_A}`
      }
    )
    expect(result).toEqual({ ok: true })

    // The user message is durable before the send — visible on disk already.
    expect(countOccurrences(readThreadFile(repo, threadId), USER_SENTINEL)).toBe(1)

    // Transcript-on-disk: main persists the bridge's assistant final with no
    // renderer participation (window blurred the whole time).
    await expect
      .poll(() => countOccurrences(readThreadFile(repo, threadId), ASSISTANT_SENTINEL), {
        timeout: 180_000
      })
      .toBeGreaterThan(0)

    // The agent's write landed in the approval queue as a pc_<turnId> item —
    // the trust boundary engaged, not bypassed, on the unattended path.
    await expect
      .poll(
        async () => {
          const items = await listApprovals(page)
          return items.some((i) => i.kind === 'cli-change' && i.paths.includes(PROBE_FILE_A))
        },
        { timeout: 120_000 }
      )
      .toBe(true)
    const item = (await listApprovals(page)).find(
      (i) => i.kind === 'cli-change' && i.paths.includes(PROBE_FILE_A)
    )
    if (item === undefined) throw new Error('queue item vanished between polls')
    expect(item.id).toMatch(/^pc_/)
    expect(item.threadId).toBe(threadId)

    // EXACTLY-ONCE, sampled after the turn fully settled (queue item landed):
    // one user + one assistant sentinel while a renderer IS subscribed — the
    // no-double-append gate the persistence cutover invites.
    const md = readThreadFile(repo, threadId)
    expect(countOccurrences(md, ASSISTANT_SENTINEL)).toBe(1)
    expect(countOccurrences(md, USER_SENTINEL)).toBe(1)
  })

  test('probe B: a normal renderer-sent turn still displays and persists identically (Phase-1 step-6 guard)', async () => {
    test.setTimeout(300_000)
    if (app === undefined) throw new Error('probe A did not launch the app')

    const threadId = await createThread(page, repo, 'renderer probe')

    // The thread was created via IPC, so reload to let the renderer list it,
    // then activate it — display assertions need the panel open.
    await page.evaluate(() => location.reload())
    await page.locator('[data-testid="approvals-tray-button"]').waitFor({
      state: 'visible',
      timeout: 15_000
    })
    await page.getByText('renderer probe').first().click()

    // Normal renderer path: the same 'cli-thread:input' channel the thread
    // input bar drives.
    const result = await page.evaluate(
      ({ threadId, ws, text }) => {
        const w = window as unknown as {
          api: {
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
        return w.api.cliThread.input({ threadId, identity: 'cli-claude', text, cwd: ws })
      },
      {
        threadId,
        ws: repo,
        text: `Run exactly this bash command and nothing else: echo ${PROBE_PAYLOAD_B} > ${PROBE_FILE_B}`
      }
    )
    expect(result).toEqual({ ok: true })

    // The reply reaches disk (main-persisted, exactly once)…
    await expect
      .poll(() => countOccurrences(readThreadFile(repo, threadId), ASSISTANT_SENTINEL), {
        timeout: 180_000
      })
      .toBe(1)
    const md = readThreadFile(repo, threadId)
    expect(countOccurrences(md, USER_SENTINEL)).toBe(1)

    // …in the post-cutover d4 bridge-final shape: the canonical cli_command
    // toolCall (id `cli_<sessionId>_<blockId>`) is the persisted d4 marker —
    // thread-md never encodes `metadata`, so sessionId/startedAt/endedAt are
    // asserted at the unit level (bridge T8), not on disk.
    expect(md).toContain('"tool": "cli_command"')
    expect(md).toContain('"id": "cli_')

    // …and the SAME reply text the disk carries is displayed in the thread
    // panel (renderer path not regressed by the readiness wait / meta-merge:
    // reply visible, not lost).
    const fragment = lastAssistantBodyFragment(md)
    expect(fragment.length).toBeGreaterThan(0)
    await expect(page.locator('.thread-prose').filter({ hasText: fragment }).first()).toBeVisible({
      timeout: 30_000
    })

    // Second pc_ item for the second turn's write.
    await expect
      .poll(
        async () => {
          const items = await listApprovals(page)
          return items.some((i) => i.kind === 'cli-change' && i.paths.includes(PROBE_FILE_B))
        },
        { timeout: 120_000 }
      )
      .toBe(true)
    const item = (await listApprovals(page)).find(
      (i) => i.kind === 'cli-change' && i.paths.includes(PROBE_FILE_B)
    )
    if (item === undefined) throw new Error('queue item vanished between polls')
    expect(item.id).toMatch(/^pc_/)
    expect(item.threadId).toBe(threadId)

    // Exactly-once re-checked at the turn's TRUE settle point (the pc_ item
    // landed): the earlier count poll passes on its first ==1 sample, so a
    // late renderer duplicate landing after that sample would be missed.
    const mdSettled = readThreadFile(repo, threadId)
    expect(countOccurrences(mdSettled, ASSISTANT_SENTINEL)).toBe(1)
    expect(countOccurrences(mdSettled, USER_SENTINEL)).toBe(1)

    // Probe A's transcript is still exactly-once after a second full turn ran
    // in the same workspace (no late renderer whole-save clobbered it).
    const mdA = readThreadFile(repo, threadIdA)
    expect(countOccurrences(mdA, ASSISTANT_SENTINEL)).toBe(1)
    expect(countOccurrences(mdA, USER_SENTINEL)).toBe(1)
  })
})
