/**
 * Built-app MCP gate-confirm convergence probe (workstation Phase 3 step 2,
 * contracts §4 v1.3.1).
 *
 * Exit evidence for the step's e2e half: an external MCP client calls
 * vault.write_file against the app's localhost Streamable HTTP endpoint; the
 * confirm surfaces as an approvals-tray GATE-CONFIRM ROW (the converged
 * surface — no Electron dialog steals the flow), and, left unanswered, it
 * FAILS CLOSED at the 30s queue timeout (OQ-B, decided): the tool call
 * returns a denial, the row disappears, and no file is written.
 *
 * Uses the boot-settle guard pattern from watcher-health.spec.ts and the
 * SDK's own Streamable HTTP client (the same client class the unit suite
 * drives in-memory).
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')

// One real 30s fail-closed wait plus launch/boot budget.
test.setTimeout(120_000)

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'te-mcp-gate-'))
  writeFileSync(path.join(dir, 'hello.md'), '# hello\n')
  return dir
}

async function launchWithWorkspace(
  workspacePath: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Boot-settle guard (watcher-health.spec.ts): let the first boot resolve
  // before seeding lastWorkspacePath, or the app's own null-write for a
  // stale stored path clobbers the seed.
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

/** Poll the renderer bridge until the MCP endpoint reports a URL. */
async function mcpUrl(page: Page): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const status = await page.evaluate(() => {
      const api = (
        window as unknown as {
          api: { mcp: { status: () => Promise<{ running: boolean; url: string | null }> } }
        }
      ).api
      return api.mcp.status()
    })
    if (status.running && status.url !== null) return status.url
    await page.waitForTimeout(500)
  }
  throw new Error('MCP endpoint never came up')
}

test('an MCP write confirm appears as a tray gate-confirm row and fails closed at 30s', async () => {
  const workspace = makeWorkspace()
  let app: ElectronApplication | null = null
  let client: Client | null = null
  try {
    const launched = await launchWithWorkspace(workspace)
    app = launched.app
    const page = launched.page

    const url = await mcpUrl(page)
    client = new Client({ name: 'gate-probe', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(url)))

    // Fire the gated write WITHOUT awaiting it — it blocks on the confirm.
    // vault.write_file requires an EXISTING file and takes an absolute path
    // (its pre-gate mtime capture stats it before the confirm).
    const targetFile = path.join(workspace, 'hello.md')
    const pendingCall = client.callTool(
      { name: 'vault.write_file', arguments: { path: targetFile, content: 'from mcp' } },
      undefined,
      { timeout: 60_000 } // outlive the 30s queue timeout; the queue decides, not the client
    )
    // A rejected call must never become an unhandled rejection while we assert UI state.
    const settled = pendingCall.catch((err) => ({ mcpClientError: String(err) }))

    // The confirm converges onto the tray: badge appears, and the row is a
    // gate-confirm ROW inside the popover — not a modal (no dialog exists to
    // steal focus; the row carries the write-confirm label).
    await page
      .locator('[data-testid="approvals-tray-badge"]')
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('[data-testid="approvals-tray-button"]').click()
    await page
      .locator('[data-testid="approval-gate-confirm"]')
      .waitFor({ state: 'visible', timeout: 5_000 })
    const row = page.locator('[data-testid="approval-item"]').first()
    await expect(row).toContainText('vault.write_file')
    await expect(row).toContainText('hello.md')

    // Left unanswered: fail-closed at the 30s queue timeout (OQ-B).
    const result = (await settled) as {
      isError?: boolean
      content?: Array<{ type: string; text: string }>
      mcpClientError?: string
    }
    if (result.mcpClientError !== undefined) {
      throw new Error(`MCP call failed client-side: ${result.mcpClientError}`)
    }
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain('Denied: Approval queue timeout (30000ms)')

    // The row is REMOVED (a stale confirm must not catch a late click) and
    // the write never happened — the file keeps its pre-call content.
    await page
      .locator('[data-testid="approval-gate-confirm"]')
      .waitFor({ state: 'hidden', timeout: 5_000 })
    expect(readFileSync(targetFile, 'utf-8')).toBe('# hello\n')
  } finally {
    await client?.close().catch(() => undefined)
    await app?.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})
