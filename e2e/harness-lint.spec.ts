/**
 * Built-app harness-linter probe (workstation Phase 2 step 7, contracts
 * v1.2.4) — the PLAN exit-bar case: hand-edit scope.json on disk to strip
 * HARNESS_PROTECTED_GLOBS ⇒ `harness:lint` returns the violation AND the
 * command palette shows the harness flagged (greyed with reason) with run
 * disabled — not vanished.
 *
 * Written by the step-7 session but NOT executed there (parallel sessions
 * collide on the shared ~/Library/Application Support/Electron dir); the
 * orchestrator runs it sequentially post-merge via `npm run test:e2e`.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')

// The packaged/built app runs with TE_DIR = '.machina' (dev uses .machina-dev).
const HARNESS_DIR = path.join('.machina', 'agents', 'test-fixer')

interface DiagnosticShape {
  severity: string
  code: string
  message: string
  file: string
}

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
  // for the app shell to be mounted post-reload before evaluate-based calls.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })
  return { app, page }
}

test.describe.serial('Harness linter (built app)', () => {
  test('stripped scope.json ⇒ harness:lint violation + palette flags the harness with run disabled', async () => {
    // A throwaway copy of the fixture vault — the probe hand-tampers files.
    const root = mkdtempSync(path.join(tmpdir(), 'te-harness-lint-'))
    cpSync(TEST_VAULT, root, { recursive: true })

    const { app, page } = await launchWithWorkspace(root)
    try {
      // Create the harness through the real channel.
      const created = await page.evaluate(() => {
        const api = (
          window as unknown as {
            api: {
              harness: {
                create: (request: {
                  template: string
                  slug: string
                }) => Promise<{ ok: boolean; error?: string }>
              }
            }
          }
        ).api
        return api.harness.create({ template: 'test-fixer', slug: 'test-fixer' })
      })
      expect(created, created.error).toEqual(expect.objectContaining({ ok: true }))

      // A fresh harness lints clean.
      const cleanDiags = await lintViaApi(page)
      expect(cleanDiags).toEqual([])

      // THE EXIT-BAR TAMPER: strip every protected glob from scope.json on
      // disk — exactly what create-time validation can never see again.
      const scopePath = path.join(root, HARNESS_DIR, 'scope.json')
      const scope = JSON.parse(readFileSync(scopePath, 'utf8'))
      scope.forbiddenGlobs = (scope.forbiddenGlobs as string[]).filter(
        (g) => !/agents\/\*\/(verify\.sh|rules\.md)$/.test(g)
      )
      writeFileSync(scopePath, JSON.stringify(scope, null, 2))

      // harness:lint returns the violation.
      const diags = await lintViaApi(page)
      const violation = diags.find((d) => d.code === 'scope-protected-globs')
      expect(violation).toBeDefined()
      expect(violation!.severity).toBe('error')
      expect(violation!.file).toBe('scope.json')
      expect(violation!.message).toContain('missing protected forbiddenGlobs')

      // harness:list carries the same diagnostics on the summary.
      const summaries = await page.evaluate(() => {
        const api = (
          window as unknown as {
            api: {
              harness: {
                list: () => Promise<Array<{ slug: string; diagnostics: DiagnosticShape[] }>>
              }
            }
          }
        ).api
        return api.harness.list()
      })
      const summary = summaries.find((s) => s.slug === 'test-fixer')
      expect(summary).toBeDefined()
      expect(summary!.diagnostics.some((d) => d.code === 'scope-protected-globs')).toBe(true)

      // The palette shows the harness FLAGGED — greyed with the reason and
      // run disabled — not vanished.
      await page.keyboard.press('ControlOrMeta+k')
      const paletteInput = page.getByPlaceholder(/Find anything/)
      await expect(paletteInput).toBeVisible()
      await paletteInput.fill('run harness')

      const item = page.getByRole('option', { name: /Run harness: test-fixer/ })
      await expect(item).toBeVisible()
      await expect(item).toHaveAttribute('aria-disabled', 'true')
      await expect(item).toContainText('broken harness')
      await expect(item).toContainText('missing protected forbiddenGlobs')

      // Run disabled: activating the item does nothing — the palette does
      // not even close (a working run item closes it before starting). Force
      // the click: the option is aria-disabled, which Playwright's actionability
      // treats as disabled (a plain click would wait for it to enable and time
      // out). We WANT to dispatch onto the disabled item and prove it is inert.
      await item.click({ force: true })
      await expect(paletteInput).toBeVisible()
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

async function lintViaApi(page: Page): Promise<DiagnosticShape[]> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        api: { harness: { lint: (slug: string) => Promise<DiagnosticShape[]> } }
      }
    ).api
    return api.harness.lint('test-fixer')
  })
}
